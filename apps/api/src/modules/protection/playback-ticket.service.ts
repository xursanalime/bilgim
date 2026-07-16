import { createHmac, timingSafeEqual } from 'crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaAsset } from '@prisma/client';

import { JwtPayload } from '../auth/tokens.service';
import { MediaAccessService } from '../media/media-access.service';
import { MediaAssetRepository } from '../media/repositories/media-asset.repository';
import {
  DrmKeySystem,
  PROTECTION_PROVIDER,
  PROTECTION_PROVIDER_UNAVAILABLE,
  ProtectionProvider,
} from './protection.types';
import { WatermarkIdentityService } from './watermark-identity.service';

/**
 * The CDM key systems the License_Proxy brokers (Req 2.1). Used to build
 * the per-keySystem license endpoint map carried by the ticket.
 */
const DRM_KEY_SYSTEMS: readonly DrmKeySystem[] = [
  'widevine',
  'fairplay',
  'playready',
] as const;

/** Default ticket TTL (seconds) mirroring `env.schema.ts` (Req 1.1, 1.3). */
const DEFAULT_TICKET_TTL_SECONDS = 120;
/** Floor/ceiling so a misconfigured TTL can never mint a long-lived ticket. */
const MIN_TICKET_TTL_SECONDS = 30;
const MAX_TICKET_TTL_SECONDS = 10 * 60;

/**
 * Dev-only HMAC key used to sign tickets when neither
 * `PLAYBACK_TICKET_SIGNING_SECRET` nor `JWT_SECRET` is configured. Only
 * reached in unit tests / bare dev shells — production boots with a real
 * `JWT_SECRET` (env schema enforces ≥32 bytes) at minimum.
 */
const DEV_SIGNING_SECRET = 'bilgim-dev-playback-ticket-signing-secret';

/**
 * Inputs to {@link PlaybackTicketService.issueTicket}. The `viewer` is the
 * AUTHENTICATED session (the verified `JwtPayload`); `ip`/`userAgent` are
 * request context captured for forensic tracing (Req 6.1). No field
 * accepts a client-chosen watermark/identity (Property 4).
 */
export interface IssueTicketInput {
  viewer: JwtPayload;
  assetId: string;
  lessonId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Signed claims embedded in the opaque ticket token. The License_Proxy
 * (Task 2.3) calls {@link PlaybackTicketService.verifyTicket} to recover
 * these and re-verify entitlement before brokering a DRM license.
 *
 * Timestamps are epoch milliseconds. No PII is embedded — the visible
 * label lives only in the client-facing {@link PlaybackTicket}, while the
 * opaque `viewerTag` is the forensic binding marker.
 */
export interface TicketClaims {
  /** Asset the ticket authorizes playback for. */
  assetId: string;
  /** Optional lesson context the ticket was issued under. */
  lessonId?: string;
  /** Playback session id (the persisted `PlaybackSession.id`). */
  sessionId: string;
  /** Authenticated viewer user id. */
  viewerUserId: string;
  /** Opaque per-viewer forensic binding tag (no PII). */
  viewerTag: string;
  /** APPROVED enrollment id when the viewer reached the asset via one. */
  enrollmentId?: string;
  /** Server-authoritative Download_Permission for the owning group. */
  downloadAllowed: boolean;
  /** Issued-at, epoch milliseconds. */
  issuedAt: number;
  /** Expiry, epoch milliseconds — after this the ticket is rejected. */
  expiresAt: number;
}

/**
 * The client-facing Playback_Ticket (Req 1.1). Carries everything the
 * player needs to start protected playback — and deliberately NOTHING
 * that is a permanent, directly addressable storage URL (Req 1.4):
 *
 *   - {@link manifestRef}: a short-lived, proxied/signed manifest
 *     reference resolved through the `ProtectionProvider` port.
 *   - {@link licenseEndpoints}: the API-relative License_Proxy path per
 *     keySystem (vendor license URLs/keys stay server-side, Req 2.2).
 *   - {@link watermark}: the PII-masked overlay label + opaque binding
 *     tag derived from the authenticated session (Req 3.1, 3.3).
 *   - {@link downloadAllowed}: server-authoritative Download_Permission.
 *   - {@link expiresAt}: ISO expiry the client uses to re-authorize.
 *   - {@link ticket}: the signed, opaque token the client passes back to
 *     the License_Proxy (consumed via {@link verifyTicket}).
 */
export interface PlaybackTicket {
  ticket: string;
  manifestRef: string;
  licenseEndpoints: Record<DrmKeySystem, string>;
  watermark: { label: string; tag: string };
  downloadAllowed: boolean;
  expiresAt: string;
}

/**
 * PlaybackTicketService — issues short-lived, signed Playback_Tickets to
 * entitled viewers and verifies them on the way back in
 * (content-protection-backend, Req 1.1–1.4, 3.1, 3.3; design Property 1
 * "No media URL without entitlement" + Property 4 "watermark bound to
 * session server-side").
 *
 * Security invariants:
 *   - ENTITLEMENT FIRST (Property 1): {@link issueTicket} resolves the
 *     APPROVED-entitlement check (reusing `MediaAccessService`) BEFORE any
 *     manifest reference, watermark, or ticket material is produced. A
 *     non-entitled caller gets a `403` and the method returns NOTHING —
 *     no manifest, no URL, no payload.
 *   - NO PERMANENT URL (Req 1.4): the only media reference in the ticket
 *     is the short-lived `manifestRef` from the `ProtectionProvider`
 *     port; the underlying storage URL is never exposed.
 *   - WATERMARK BOUND SERVER-SIDE (Property 4): the watermark identity is
 *     derived from the authenticated session and a `PlaybackSession` row
 *     is persisted, all via `WatermarkIdentityService`.
 *   - SIGNED + SHORT-LIVED (Req 1.1, 1.3): the ticket is HMAC-signed with
 *     `PLAYBACK_TICKET_SIGNING_SECRET` (dev fallback to `JWT_SECRET`) and
 *     carries a short, configurable expiry. {@link verifyTicket} rejects
 *     tampered or expired tokens.
 */
@Injectable()
export class PlaybackTicketService {
  private readonly logger = new Logger(PlaybackTicketService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly access: MediaAccessService,
    private readonly assets: MediaAssetRepository,
    private readonly watermark: WatermarkIdentityService,
    @Inject(PROTECTION_PROVIDER)
    private readonly provider: ProtectionProvider,
  ) {}

  /**
   * Issue a Playback_Ticket for an entitled viewer.
   *
   * Throws `403 MEDIA_ACCESS_DENIED` (and returns no media payload) when
   * the viewer lacks an APPROVED Entitlement for the asset's group
   * (Req 1.2, Property 1). Throws `404 MEDIA_NOT_FOUND` for an unknown
   * asset.
   */
  async issueTicket(input: IssueTicketInput): Promise<PlaybackTicket> {
    const { viewer } = input;

    // ── (0) Resolve the asset. A missing asset is a 404, not a ticket. ──
    const asset = await this.loadAsset(input.assetId);

    // ── (1) ENTITLEMENT GATE (Property 1) ──────────────────────────────
    // Reuse the SAME APPROVED-entitlement predicate as playback / gated
    // streaming. This throws `403 MEDIA_ACCESS_DENIED` for a non-entitled
    // caller BEFORE any manifest reference / watermark / ticket material
    // is created. Nothing below runs — and nothing is returned — unless
    // the caller is entitled (Req 1.2).
    const grant = await this.access.resolvePlaybackAccess(
      { sub: viewer.sub, role: viewer.role },
      asset,
    );

    // ── (1.5) FAIL CLOSED IN PRODUCTION (Property 5, Req 7.3) ──────────
    // An entitled viewer is about to be handed a manifest reference. In
    // production we MUST NOT serve protected playback through anything
    // but a real, production-grade DRM_Provider. If only the development
    // fallback (or any non-production-grade provider) is bound, refuse
    // here — BEFORE any manifest reference / watermark / ticket material
    // is produced — with an actionable `503`. Nothing below runs, so no
    // unprotected manifest is ever served in production (no fallback).
    this.assertProductionGradeProtection(asset.id);

    // ── (2) Short-lived window (Req 1.1, 1.3). ─────────────────────────
    const ttlSec = this.resolveTtlSeconds();
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + ttlSec * 1000;
    const expiresAt = new Date(expiresAtMs);

    // ── (3) Derive watermark identity + persist PlaybackSession ────────
    //        (Property 4 — bound server-side from the authenticated
    //        session, never client input).
    const bound = await this.watermark.bindSession({
      viewer: {
        userId: viewer.sub,
        email: viewer.email,
        enrollmentId: grant.enrollmentId,
      },
      assetId: asset.id,
      lessonId: input.lessonId,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // ── (4) Short-lived signed manifest reference via the port ─────────
    //        (Req 1.1, 1.4 — never a permanent storage URL).
    const { manifestUrl } = await this.provider.getSignedManifest(
      asset.id,
      ttlSec,
    );

    // ── (5) Bind the forensic/session watermark at the provider where
    //        supported (Req 3.2). Best-effort: the persisted session row
    //        is the authoritative trace marker, so a provider that cannot
    //        bind must not fail ticket issuance for an entitled viewer.
    await this.bindProviderWatermark(asset.id, bound.identity.tag);

    // ── (6) Assemble + sign the ticket. ────────────────────────────────
    const claims: TicketClaims = {
      assetId: asset.id,
      sessionId: bound.identity.sessionId,
      viewerUserId: viewer.sub,
      viewerTag: bound.identity.tag,
      downloadAllowed: grant.downloadAllowed,
      issuedAt: issuedAtMs,
      expiresAt: expiresAtMs,
    };
    if (input.lessonId !== undefined) {
      claims.lessonId = input.lessonId;
    }
    if (grant.enrollmentId !== undefined) {
      claims.enrollmentId = grant.enrollmentId;
    }

    return {
      ticket: this.signClaims(claims),
      manifestRef: manifestUrl,
      licenseEndpoints: this.buildLicenseEndpoints(asset.id),
      watermark: {
        label: bound.identity.label,
        tag: bound.identity.tag,
      },
      downloadAllowed: grant.downloadAllowed,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Verify a signed ticket token and return its claims (consumed by the
   * License_Proxy, Task 2.3). Rejects:
   *   - a malformed token,
   *   - a tampered token (signature mismatch),
   *   - an expired token (`now > expiresAt`).
   *
   * Throws `403 PLAYBACK_TICKET_INVALID` / `PLAYBACK_TICKET_EXPIRED`.
   */
  verifyTicket(signed: string): TicketClaims {
    if (typeof signed !== 'string' || signed.length === 0) {
      this.rejectTicket('PLAYBACK_TICKET_INVALID', 'Missing playback ticket');
    }

    const dot = signed.indexOf('.');
    if (dot <= 0 || dot === signed.length - 1) {
      this.rejectTicket(
        'PLAYBACK_TICKET_INVALID',
        'Malformed playback ticket',
      );
    }

    const payloadB64 = signed.slice(0, dot);
    const providedSig = signed.slice(dot + 1);
    const expectedSig = this.sign(payloadB64);

    if (!this.constantTimeEquals(providedSig, expectedSig)) {
      this.rejectTicket(
        'PLAYBACK_TICKET_INVALID',
        'Playback ticket signature is invalid',
      );
    }

    const claims = this.decodeClaims(payloadB64);

    if (!Number.isFinite(claims.expiresAt) || Date.now() > claims.expiresAt) {
      this.rejectTicket(
        'PLAYBACK_TICKET_EXPIRED',
        'Playback ticket has expired; re-authorize',
      );
    }

    return claims;
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async loadAsset(assetId: string): Promise<MediaAsset> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }
    return asset;
  }

  /** Whether the API is running with `NODE_ENV=production`. */
  private isProduction(): boolean {
    // Prefer the validated ConfigService value; fall back to `process.env`
    // defensively (matches how `protection.module.ts` reads env flags).
    const nodeEnv =
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '';
    return nodeEnv.trim().toLowerCase() === 'production';
  }

  /**
   * Fail closed in production (design Property 5, Req 7.3): refuse to
   * issue a Playback_Ticket when a real DRM_Provider is unavailable and
   * only a non-production-grade provider (the development fallback) is
   * bound. In non-production (dev/test) the clearly-flagged fallback is
   * allowed so local workflows keep working — and the fallback itself
   * already flags every response/log as non-production protection
   * (Req 7.2). Throws `503 PROTECTION_PROVIDER_UNAVAILABLE` with an
   * actionable message; serves NO manifest reference.
   */
  private assertProductionGradeProtection(assetId: string): void {
    if (!this.isProduction() || this.provider.productionGrade) {
      return;
    }
    this.logger.error(
      `Refusing protected playback ticket for asset=${assetId}: ` +
        `NODE_ENV=production but no production-grade DRM_Provider is bound ` +
        `(the development fallback does not provide real protection). ` +
        `Failing closed — no unprotected manifest is served (Req 7.3).`,
    );
    throw new ServiceUnavailableException({
      code: PROTECTION_PROVIDER_UNAVAILABLE,
      message:
        'Protected playback is unavailable: no production-grade DRM ' +
        'provider is configured. Configure a real DRM_Provider ' +
        '(DRM_PROVIDER + vendor credentials) to enable encrypted ' +
        'playback. The development fallback is not served in production.',
    });
  }

  /**
   * License_Proxy path per keySystem (design: `POST
   * /media/assets/:id/license/:keySystem`). API-relative on purpose: the
   * client resolves it against the API base, and no vendor license URL /
   * key ever leaves the server (Req 2.2).
   */
  private buildLicenseEndpoints(assetId: string): Record<DrmKeySystem, string> {
    const encoded = encodeURIComponent(assetId);
    return DRM_KEY_SYSTEMS.reduce(
      (acc, keySystem) => {
        acc[keySystem] = `/media/assets/${encoded}/license/${keySystem}`;
        return acc;
      },
      {} as Record<DrmKeySystem, string>,
    );
  }

  /** Best-effort provider watermark binding (Req 3.2). Never throws. */
  private async bindProviderWatermark(
    assetId: string,
    viewerTag: string,
  ): Promise<void> {
    try {
      await this.provider.bindWatermark(assetId, viewerTag);
    } catch (err) {
      // The persisted PlaybackSession row is the authoritative forensic
      // marker; a provider that cannot bind must not deny an entitled
      // viewer their ticket. Log and continue.
      this.logger.warn(
        `Provider watermark binding failed for asset=${assetId}; ` +
          `continuing with the persisted PlaybackSession marker. ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Clamp the configured TTL into a short, sane window (Req 1.3, 7.4). */
  private resolveTtlSeconds(): number {
    const raw =
      this.config.get<number>('PLAYBACK_TICKET_TTL_SECONDS') ??
      DEFAULT_TICKET_TTL_SECONDS;
    const ttl = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_TICKET_TTL_SECONDS;
    return Math.min(
      Math.max(MIN_TICKET_TTL_SECONDS, ttl),
      MAX_TICKET_TTL_SECONDS,
    );
  }

  /** HMAC signing secret: dedicated key, dev fallback to `JWT_SECRET`. */
  private signingSecret(): string {
    return (
      this.config.get<string>('PLAYBACK_TICKET_SIGNING_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      DEV_SIGNING_SECRET
    );
  }

  private signClaims(claims: TicketClaims): string {
    const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString(
      'base64url',
    );
    return `${payloadB64}.${this.sign(payloadB64)}`;
  }

  private sign(payloadB64: string): string {
    return createHmac('sha256', this.signingSecret())
      .update(payloadB64)
      .digest('base64url');
  }

  private decodeClaims(payloadB64: string): TicketClaims {
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
      return JSON.parse(json) as TicketClaims;
    } catch {
      this.rejectTicket(
        'PLAYBACK_TICKET_INVALID',
        'Playback ticket payload is unreadable',
      );
    }
  }

  /** Length-safe, constant-time signature comparison. */
  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  private rejectTicket(code: string, message: string): never {
    throw new ForbiddenException({ code, message });
  }
}
