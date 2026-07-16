import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Logger,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/tokens.service';
import { DrmKeySystem, PROTECTION_PROVIDER, ProtectionProvider } from './protection.types';

/**
 * DI token for the {@link PlaybackTicketVerifier} the License_Proxy depends
 * on (Task 2.1 owns the concrete `PlaybackTicketService`). Bound by the
 * orchestrator in `protection.module.ts`, e.g.
 *
 *   { provide: PLAYBACK_TICKET_VERIFIER, useExisting: PlaybackTicketService }
 *
 * We depend on a token + minimal interface (rather than importing the
 * concrete class) so this controller stays decoupled from the concurrently
 * authored `PlaybackTicketService` file and its internals.
 */
export const PLAYBACK_TICKET_VERIFIER = Symbol('PLAYBACK_TICKET_VERIFIER');

/**
 * The slice of the verified Playback_Ticket claims the License_Proxy
 * depends on. `PlaybackTicketService.verifyTicket` (Task 2.1) returns a
 * superset of this shape; fields are read defensively so a richer claim
 * object stays compatible.
 *
 * SECURITY: every value here originates from the SIGNED ticket the
 * `PlaybackTicketService` minted server-side from the authenticated
 * session — never from raw client input (Req 2.3, 3.1).
 */
export interface VerifiedPlaybackTicket {
  /** Asset the ticket authorizes playback for — must match `:id`. */
  assetId: string;
  /** Optional lesson context the ticket was issued for. */
  lessonId?: string | null;
  /** Authenticated viewer the ticket was issued to (preferred field). */
  viewerUserId?: string | null;
  /** Alternate viewer id field (JWT `sub`) for defensive reads. */
  sub?: string | null;
  /** Server-derived forensic watermark tag passed to the provider. */
  viewerTag: string;
  /** APPROVED enrollment id resolved at issuance, when present. */
  enrollmentId?: string | null;
  /** Canonical entitlement-approved flag (defense-in-depth recheck). */
  entitlementApproved?: boolean;
  /** Structured entitlement claim, read defensively. */
  entitlement?: { status?: string | null; approved?: boolean | null } | null;
  /** Flat entitlement status claim, read defensively. */
  entitlementStatus?: string | null;
  /** Ticket expiry (ms epoch | ISO string | Date), read defensively. */
  expiresAt?: number | string | Date | null;
  /** JWT-style expiry in seconds, read defensively. */
  exp?: number | null;
  [key: string]: unknown;
}

/**
 * Minimal contract the License_Proxy depends on. The concrete
 * `PlaybackTicketService` (Task 2.1) implements this with a
 * `verifyTicket(signedTicket)` that validates the signature AND rejects
 * expired/forged tickets (throwing). The controller still performs its own
 * defense-in-depth checks (asset match, viewer match, expiry, entitlement)
 * on top of the returned claims.
 */
export interface PlaybackTicketVerifier {
  verifyTicket(signedTicket: string): Promise<VerifiedPlaybackTicket>;
}

/** Key systems the License_Proxy brokers (Req 2.1). */
const SUPPORTED_KEY_SYSTEMS = ['widevine', 'fairplay', 'playready'] as const;
const keySystemSchema = z.enum(SUPPORTED_KEY_SYSTEMS);

/**
 * Request body schema. The EME challenge may arrive either as a raw
 * Buffer/string body or as `{ challenge, ticket? }`. The ticket may also
 * arrive via the `x-playback-ticket` header (preferred).
 */
const bodySchema = z
  .object({
    challenge: z.string().min(1).optional(),
    ticket: z.string().min(1).optional(),
  })
  .passthrough();

const PLAYBACK_TICKET_HEADER = 'x-playback-ticket';

/**
 * LicenseProxyController — brokers EME license challenges to the
 * `ProtectionProvider` for Widevine/FairPlay/PlayReady (Task 2.3,
 * Req 2.1–2.5; design Property 2 — "keys stay server-side").
 *
 * Flow for `POST /media/assets/:id/license/:keySystem`:
 *   1. Validate `:keySystem` ∈ {widevine, fairplay, playready} (else 400).
 *   2. Resolve + verify the signed Playback_Ticket (header or body). A
 *      missing/invalid/expired/forged ticket → 403, NO license (Req 2.4).
 *   3. Confirm the ticket authorizes THIS asset, belongs to the
 *      authenticated viewer, is unexpired, and carries an APPROVED
 *      entitlement (defense in depth) — else 403, NO license (Req 2.3,
 *      2.4).
 *   4. Broker the opaque EME challenge to
 *      `ProtectionProvider.issueLicense({ keySystem, challenge, viewerTag })`
 *      and return ONLY the opaque license bytes.
 *
 * SECURITY INVARIANT (Property 2 / Req 2.2): the response carries ONLY the
 * vendor's opaque license blob. DRM_Provider credentials, content keys, and
 * provider URLs are held server-side and never serialized to the client.
 * When no DRM_Provider is configured the dev fallback throws a flagged
 * `503 DRM_PROVIDER_NOT_CONFIGURED`, which is surfaced so protected
 * playback fails closed (Req 7.2, 7.3).
 */
@Controller('media/assets')
@UseGuards(JwtAuthGuard)
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class LicenseProxyController {
  private readonly logger = new Logger(LicenseProxyController.name);

  constructor(
    @Inject(PROTECTION_PROVIDER)
    private readonly provider: ProtectionProvider,
    @Inject(PLAYBACK_TICKET_VERIFIER)
    private readonly tickets: PlaybackTicketVerifier,
  ) {}

  @Post(':id/license/:keySystem')
  async issueLicense(
    @Param('id') assetId: string,
    @Param('keySystem') keySystemParam: string,
    @CurrentUser() user: JwtPayload | null,
    @Body() body: unknown,
    @Headers(PLAYBACK_TICKET_HEADER) ticketHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer> {
    if (!user?.sub) {
      // Auth guard should prevent this; fail closed regardless.
      throw new ForbiddenException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    // 1) Validate the key system (Req 2.1). Unsupported → 400.
    const keySystem = this.parseKeySystem(keySystemParam);

    // 2) Resolve the EME challenge + signed ticket from the request.
    const parsedBody = this.parseBody(body);
    const challenge = this.resolveChallenge(body, parsedBody);
    const signedTicket = this.resolveTicket(ticketHeader, parsedBody);

    // 3) Verify the ticket. Any failure → 403, NO license (Req 2.4).
    const claims = await this.verifyTicketOrDeny(signedTicket);

    // 4) Defense in depth on the verified claims (Req 2.3, 2.4).
    this.assertTicketMatchesAsset(claims, assetId);
    this.assertTicketBelongsToViewer(claims, user.sub);
    this.assertTicketUnexpired(claims);
    this.assertEntitlementApproved(claims);

    // 5) Broker to the provider. Keys stay server-side; only the opaque
    //    license blob is returned. A dev-fallback / unavailable provider
    //    throws (e.g. 503 DRM_PROVIDER_NOT_CONFIGURED) and we let that
    //    propagate so protected playback fails closed (Req 7.2, 7.3).
    const license = await this.provider.issueLicense({
      keySystem,
      challenge,
      viewerTag: claims.viewerTag,
    });

    this.writeOpaqueLicenseHeaders(res);
    return license;
  }

  // ------------------------------------------------------------------
  // Validation / parsing
  // ------------------------------------------------------------------

  private parseKeySystem(raw: string): DrmKeySystem {
    const result = keySystemSchema.safeParse((raw ?? '').toLowerCase());
    if (!result.success) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_KEY_SYSTEM',
        message: `Unsupported key system "${raw}". Supported: ${SUPPORTED_KEY_SYSTEMS.join(', ')}.`,
      });
    }
    return result.data;
  }

  private parseBody(body: unknown): z.infer<typeof bodySchema> | null {
    if (body == null || Buffer.isBuffer(body) || typeof body === 'string') {
      return null;
    }
    const result = bodySchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_LICENSE_REQUEST',
        message: 'Malformed license request body.',
      });
    }
    return result.data;
  }

  /**
   * Resolve the opaque EME challenge bytes. Accepts a raw Buffer body, a
   * base64 string body, or a `{ challenge }` JSON field (base64).
   */
  private resolveChallenge(
    rawBody: unknown,
    parsedBody: z.infer<typeof bodySchema> | null,
  ): Buffer {
    if (Buffer.isBuffer(rawBody)) {
      return this.requireNonEmpty(rawBody);
    }
    if (typeof rawBody === 'string') {
      return this.requireNonEmpty(this.decodeBase64(rawBody));
    }
    const challenge = parsedBody?.challenge;
    if (typeof challenge === 'string') {
      return this.requireNonEmpty(this.decodeBase64(challenge));
    }
    throw new BadRequestException({
      code: 'MISSING_CHALLENGE',
      message: 'A license challenge is required.',
    });
  }

  private decodeBase64(value: string): Buffer {
    try {
      return Buffer.from(value, 'base64');
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CHALLENGE',
        message: 'License challenge must be valid base64.',
      });
    }
  }

  private requireNonEmpty(buf: Buffer): Buffer {
    if (buf.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_CHALLENGE',
        message: 'A non-empty license challenge is required.',
      });
    }
    return buf;
  }

  /** The signed ticket from the header (preferred) or the body. */
  private resolveTicket(
    ticketHeader: string | undefined,
    parsedBody: z.infer<typeof bodySchema> | null,
  ): string {
    const candidate =
      (typeof ticketHeader === 'string' && ticketHeader.trim()) ||
      (typeof parsedBody?.ticket === 'string' && parsedBody.ticket.trim()) ||
      '';
    if (!candidate) {
      // No ticket → refuse the license (Req 2.4).
      throw new ForbiddenException({
        code: 'MISSING_PLAYBACK_TICKET',
        message: 'A valid playback ticket is required to obtain a license.',
      });
    }
    return candidate;
  }

  // ------------------------------------------------------------------
  // Ticket + entitlement checks (all failures → 403, NO license)
  // ------------------------------------------------------------------

  private async verifyTicketOrDeny(
    signedTicket: string,
  ): Promise<VerifiedPlaybackTicket> {
    try {
      const claims = await this.tickets.verifyTicket(signedTicket);
      if (!claims || typeof claims.viewerTag !== 'string' || !claims.viewerTag) {
        throw new Error('ticket missing viewerTag');
      }
      return claims;
    } catch (err) {
      // Never leak verifier internals; always fail closed with 403.
      this.logger.warn(
        `Playback ticket verification failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw new ForbiddenException({
        code: 'INVALID_PLAYBACK_TICKET',
        message: 'The playback ticket is invalid or expired.',
      });
    }
  }

  private assertTicketMatchesAsset(
    claims: VerifiedPlaybackTicket,
    assetId: string,
  ): void {
    if (claims.assetId !== assetId) {
      throw new ForbiddenException({
        code: 'TICKET_ASSET_MISMATCH',
        message: 'The playback ticket does not authorize this asset.',
      });
    }
  }

  private assertTicketBelongsToViewer(
    claims: VerifiedPlaybackTicket,
    userId: string,
  ): void {
    const ticketViewer = claims.viewerUserId ?? claims.sub ?? null;
    if (!ticketViewer || ticketViewer !== userId) {
      throw new ForbiddenException({
        code: 'TICKET_VIEWER_MISMATCH',
        message: 'The playback ticket was not issued to this viewer.',
      });
    }
  }

  private assertTicketUnexpired(claims: VerifiedPlaybackTicket): void {
    const expiryMs = this.resolveExpiryMs(claims);
    if (expiryMs !== null && expiryMs <= Date.now()) {
      throw new ForbiddenException({
        code: 'TICKET_EXPIRED',
        message: 'The playback ticket has expired; re-authorize playback.',
      });
    }
  }

  private resolveExpiryMs(claims: VerifiedPlaybackTicket): number | null {
    const { expiresAt, exp } = claims;
    if (expiresAt instanceof Date) {
      return expiresAt.getTime();
    }
    if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
      return expiresAt;
    }
    if (typeof expiresAt === 'string') {
      const parsed = Date.parse(expiresAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof exp === 'number' && Number.isFinite(exp)) {
      // JWT-style `exp` is in seconds.
      return exp * 1000;
    }
    return null;
  }

  /**
   * Defense-in-depth entitlement recheck (Req 2.3, 2.4). The ticket is only
   * minted for an APPROVED entitlement; here we reject if the verified
   * claims explicitly indicate the entitlement is NOT approved.
   */
  private assertEntitlementApproved(claims: VerifiedPlaybackTicket): void {
    if (this.isEntitlementExplicitlyNotApproved(claims)) {
      throw new ForbiddenException({
        code: 'ENTITLEMENT_NOT_APPROVED',
        message: 'No approved entitlement for this content.',
      });
    }
  }

  private isEntitlementExplicitlyNotApproved(
    claims: VerifiedPlaybackTicket,
  ): boolean {
    if (claims.entitlementApproved === false) return true;

    const ent = claims.entitlement;
    if (ent && typeof ent === 'object') {
      if (ent.approved === false) return true;
      if (typeof ent.status === 'string' && !this.isApprovedStatus(ent.status)) {
        return true;
      }
    }

    if (
      typeof claims.entitlementStatus === 'string' &&
      !this.isApprovedStatus(claims.entitlementStatus)
    ) {
      return true;
    }

    return false;
  }

  private isApprovedStatus(status: string): boolean {
    return status.trim().toUpperCase() === 'APPROVED';
  }

  // ------------------------------------------------------------------
  // Response
  // ------------------------------------------------------------------

  /**
   * Mark the response as opaque, non-cacheable binary. We deliberately set
   * NO body other than the license bytes returned by the handler, so no
   * provider URL/key/credential can ride along (Property 2 / Req 2.2).
   */
  private writeOpaqueLicenseHeaders(res: Response): void {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}
