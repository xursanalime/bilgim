import { createHmac, randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaybackSession } from '@prisma/client';

import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import { DrmKeySystem } from './protection.types';

/**
 * The slice of the AUTHENTICATED session the watermark identity is
 * derived from (Req 3.1). Sourced from the verified `JwtPayload`
 * (`sub` → {@link userId}, `email`) plus the APPROVED enrollment resolved
 * server-side — NEVER from request body / query / headers.
 */
export interface AuthenticatedViewer {
  /** Authenticated user id (JwtPayload `sub`). */
  userId: string;
  /** Authenticated user email (JwtPayload `email`). */
  email: string;
  /** APPROVED enrollment id, resolved server-side by the entitlement check. */
  enrollmentId?: string | undefined;
}

/**
 * The derived, server-authoritative watermark identity for one playback
 * session. Contains both:
 *   - {@link label}: the PII-masked, human-readable overlay text rendered
 *     by the client (Req 3.3); and
 *   - {@link tag}: a stable, opaque binding tag passed to the
 *     `ProtectionProvider` (license / forensic watermark binding) and
 *     stored as the `PlaybackSession.viewerTag` forensic marker.
 */
export interface WatermarkIdentity {
  /** Playback session id — the `{sessionId}` marker (PlaybackSession.id). */
  sessionId: string;
  /** Human-readable overlay label (PII-masked) per `WATERMARK_FORMAT`. */
  label: string;
  /** Stable opaque per-viewer binding tag (forensic marker, no PII). */
  tag: string;
  /** Masked email used in the label (e.g. `a***@example.com`). */
  maskedEmail: string;
  /** Authenticated viewer user id (kept for binding/trace context). */
  userId: string;
  /** APPROVED enrollment id when present. */
  enrollmentId?: string | undefined;
}

/**
 * Inputs to {@link WatermarkIdentityService.deriveIdentity}. The viewer is
 * always the authenticated session; `sessionId` is generated when omitted.
 */
export interface DeriveWatermarkInput {
  viewer: AuthenticatedViewer;
  /** Reuse an existing session id; a fresh uuid is minted when omitted. */
  sessionId?: string | undefined;
}

/**
 * Inputs to {@link WatermarkIdentityService.bindSession}: derive identity
 * AND persist the `PlaybackSession` mapping. Ticket expiry + request
 * context (ip/userAgent/keySystem) are owned by the caller
 * (PlaybackTicketService, Task 2.1).
 */
export interface BindWatermarkSessionInput extends DeriveWatermarkInput {
  assetId: string;
  lessonId?: string | undefined;
  /** Ticket / session expiry timestamp. */
  expiresAt: Date;
  drmKeySystem?: DrmKeySystem | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/** Result of {@link WatermarkIdentityService.bindSession}. */
export interface BoundWatermarkSession {
  identity: WatermarkIdentity;
  session: PlaybackSession;
}

/** Default template when `WATERMARK_FORMAT` is unset (matches env schema). */
const DEFAULT_WATERMARK_FORMAT = '{maskedEmail} • {sessionId}';

/**
 * Fallback HMAC key for the binding tag when no dedicated secret is
 * configured. Only used in dev / test — the tag is an opaque,
 * non-reversible marker, not an auth credential, but we still salt it so
 * tags are unpredictable and never leak the raw email.
 */
const DEV_TAG_KEY = 'bilgim-dev-watermark-tag-key';

/**
 * WatermarkIdentityService — derives a per-viewer forensic watermark
 * identity from the AUTHENTICATED session and persists the
 * viewer↔session↔asset mapping (content-protection-backend, Req 3.1,
 * 3.2, 3.4, 6.1; design Property 4 — "watermark bound to session
 * server-side").
 *
 * Security invariants:
 *   - Identity is derived ONLY from {@link AuthenticatedViewer} (the
 *     verified JWT session + server-resolved enrollment). The service has
 *     no parameter that accepts a client-supplied label/tag, so a viewer
 *     can never spoof or choose their own watermark (Req 3.1).
 *   - The visible {@link WatermarkIdentity.label} is PII-masked
 *     (`a***@domain`) yet the persisted `PlaybackSession` row keeps the
 *     un-masked `viewerUserId`/`enrollmentId` so an admin can trace a
 *     leak back to a learner (Req 6.1, 6.4).
 *   - The binding {@link WatermarkIdentity.tag} is a deterministic HMAC of
 *     the (userId, enrollmentId, sessionId) triple: identical for the same
 *     session, opaque, and carrying no recoverable PII.
 *   - Works the same for recorded lessons and live-session recordings —
 *     the input is just an asset id (Req 3.4).
 */
@Injectable()
export class WatermarkIdentityService {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: PlaybackSessionRepository,
  ) {}

  /**
   * Derive the watermark identity (label + binding tag) for a session
   * from the authenticated viewer. Pure + deterministic for a fixed
   * `sessionId`; generates a fresh session id when none is supplied.
   */
  deriveIdentity(input: DeriveWatermarkInput): WatermarkIdentity {
    const { viewer } = input;
    const sessionId = input.sessionId ?? randomUUID();
    const maskedEmail = this.maskEmail(viewer.email);
    const tag = this.deriveTag(viewer, sessionId);
    const label = this.renderLabel({
      maskedEmail,
      sessionId,
      userId: viewer.userId,
      enrollmentId: viewer.enrollmentId,
    });

    return {
      sessionId,
      label,
      tag,
      maskedEmail,
      userId: viewer.userId,
      enrollmentId: viewer.enrollmentId,
    };
  }

  /**
   * Derive the identity AND persist the `PlaybackSession` mapping in one
   * step (Req 6.1, Property 4). Returns both the derived identity (for the
   * ticket payload / overlay) and the persisted row.
   */
  async bindSession(
    input: BindWatermarkSessionInput,
  ): Promise<BoundWatermarkSession> {
    const identity = this.deriveIdentity({
      viewer: input.viewer,
      sessionId: input.sessionId,
    });

    const session = await this.sessions.create({
      id: identity.sessionId,
      assetId: input.assetId,
      lessonId: input.lessonId,
      viewerUserId: input.viewer.userId,
      enrollmentId: input.viewer.enrollmentId,
      viewerTag: identity.tag,
      drmKeySystem: input.drmKeySystem,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt: input.expiresAt,
    });

    return { identity, session };
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Interpolate the configured `WATERMARK_FORMAT` template (Req 3.3, 7.4)
   * with the server-derived values. Unknown placeholders are left intact
   * so a typo in the template surfaces visibly rather than silently
   * dropping context.
   */
  private renderLabel(values: {
    maskedEmail: string;
    sessionId: string;
    userId: string;
    enrollmentId?: string | undefined;
  }): string {
    const template =
      this.config.get<string>('WATERMARK_FORMAT') ?? DEFAULT_WATERMARK_FORMAT;

    const replacements: Record<string, string> = {
      maskedEmail: values.maskedEmail,
      sessionId: values.sessionId,
      userId: values.userId,
      enrollmentId: values.enrollmentId ?? '',
    };

    return template.replace(/\{(\w+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(replacements, key)
        ? replacements[key]!
        : match,
    );
  }

  /**
   * Deterministic, opaque per-viewer binding tag. HMAC-SHA256 over the
   * (userId, enrollmentId, sessionId) triple keyed by a server secret, so
   * the same session always yields the same tag, the tag is unpredictable
   * to clients, and the raw email is never recoverable from it.
   */
  private deriveTag(viewer: AuthenticatedViewer, sessionId: string): string {
    const key =
      this.config.get<string>('PLAYBACK_TICKET_SIGNING_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      DEV_TAG_KEY;

    const material = `${viewer.userId}:${viewer.enrollmentId ?? ''}:${sessionId}`;
    return createHmac('sha256', key).update(material).digest('hex').slice(0, 32);
  }

  /**
   * Mask an email for the visible overlay: keep the first local-part
   * character + `***` and the full domain (e.g. `alice@example.com` →
   * `a***@example.com`, `a@b.co` → `a***@b.co`). Enough for an admin to
   * recognise the domain while hiding the local part; the un-masked
   * identity lives only in the persisted row.
   */
  private maskEmail(email: string): string {
    const value = (email ?? '').trim();
    const at = value.indexOf('@');
    if (at <= 0 || at === value.length - 1) {
      // No usable local part or domain — fail safe to a fully masked token.
      return '***';
    }
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${local[0]}***@${domain}`;
  }
}
