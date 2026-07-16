/**
 * Client-side content-protection contract (`lib/media/protection`).
 *
 * These types are the FRONTEND port the protected player + `useProtectedMedia`
 * hook depend on (frontend-redesign design §3.2). They deliberately MIRROR the
 * already-built backend `PlaybackTicket` contract issued by
 * `apps/api` `PlaybackTicketService` and exposed via:
 *
 *   - `GET  /api/v1/media/assets/:id/playback-ticket?lessonId=` → ticket
 *   - `POST /api/v1/media/assets/:id/license/:keySystem`        → EME license
 *   - `GET  /api/v1/media/assets/:id/stream`                    → gated bytes
 *
 * SECURITY NOTES (Req 1.1, 1.2, 3.1):
 *   - The viewer identity / watermark is resolved SERVER-SIDE from the
 *     authenticated session and is never trusted from the client. The client
 *     only sends `assetId` (+ optional `lessonId`) — see {@link ProtectedPlaybackRequest}.
 *   - The ticket never carries a permanent, directly addressable storage URL;
 *     `manifestRef` is a short-lived, proxied reference and `licenseEndpoints`
 *     are broker paths (vendor keys/URLs stay server-side).
 */

/**
 * EME / CDM key systems brokered by the License_Proxy. Mirrors the backend
 * `DrmKeySystem` union (`apps/api/.../protection/protection.types.ts`).
 */
export type KeySystem = 'widevine' | 'fairplay' | 'playready';

/**
 * The full, ordered set of {@link KeySystem} values. Use this (rather than a
 * hand-written literal list) when iterating over every brokered key system so
 * the set stays in sync with {@link KeySystem}.
 */
export const KEY_SYSTEMS: readonly KeySystem[] = [
  'widevine',
  'fairplay',
  'playready',
] as const;

/**
 * Request to mint a Playback_Ticket. The client sends ONLY the asset (and an
 * optional lesson context). Viewer identity, entitlement, watermark identity,
 * and Download_Permission are all resolved server-side from the authenticated
 * session — never trusted from this payload (Req 1.2, 3.3).
 */
export interface ProtectedPlaybackRequest {
  /** The protected media asset to play. */
  assetId: string;
  /** Optional lesson the playback happens under (forwarded as `?lessonId=`). */
  lessonId?: string;
}

/**
 * Per-viewer forensic watermark descriptor carried by the ticket (Req 3.1).
 * `label` is the PII-masked, server-rendered overlay text; `tag` is the opaque
 * forensic binding marker (no PII) used for leak tracing.
 */
export interface PlaybackWatermark {
  /** Server-rendered, PII-masked overlay label (e.g. masked email / id). */
  label: string;
  /** Opaque per-viewer forensic binding tag (no PII). */
  tag: string;
}

/**
 * The client-facing Playback_Ticket. MIRRORS the backend `PlaybackTicket`
 * shape exactly so the typed API/BFF response maps 1:1:
 *
 * ```jsonc
 * {
 *   "ticket": "<opaque signed token>",
 *   "manifestRef": "<short-lived proxied manifest reference>",
 *   "licenseEndpoints": { "widevine": "/...", "fairplay": "/...", "playready": "/..." },
 *   "watermark": { "label": "j••@mail.com", "tag": "<opaque>" },
 *   "downloadAllowed": false,
 *   "expiresAt": "2026-01-01T00:02:00.000Z"
 * }
 * ```
 */
export interface ProtectedPlaybackTicket {
  /** Signed, opaque token the client passes back to the License_Proxy. */
  ticket: string;
  /**
   * Short-lived, proxied/signed manifest reference (DRM HLS/DASH). NEVER a
   * permanent, directly addressable storage URL (Req 1.4).
   */
  manifestRef: string;
  /** API/BFF-relative License_Proxy path per key system (Req 2.2). */
  licenseEndpoints: Record<KeySystem, string>;
  /** Per-viewer forensic watermark (server-derived) (Req 3.1). */
  watermark: PlaybackWatermark;
  /** Server-authoritative Download_Permission mirror; display-only on client. */
  downloadAllowed: boolean;
  /** ISO-8601 expiry; the client re-requests a ticket before this (Req 1.2). */
  expiresAt: string;
}

/**
 * Input to {@link MediaProtectionProvider.requestLicense}. Carries the opaque
 * EME license challenge produced by the browser CDM, to be brokered through
 * our API (`POST /media/assets/:assetId/license/:keySystem`). The vendor
 * license URL / keys never reach the client (Req 2.2).
 */
export interface LicenseRequest {
  /** The asset the EME session is decrypting. */
  assetId: string;
  /** Which CDM produced the {@link LicenseRequest.challenge}. */
  keySystem: KeySystem;
  /** Opaque license challenge bytes from the CDM (`event.message`). */
  challenge: ArrayBuffer;
  /**
   * The ticket token from {@link ProtectedPlaybackTicket.ticket}. The
   * License_Proxy re-verifies it (entitlement + expiry) before brokering.
   */
  ticket: string;
}

/**
 * MediaProtectionProvider — the vendor-agnostic CLIENT port the protected
 * player + `useProtectedMedia` hook depend on (design §3.2). One adapter is
 * implemented per environment:
 *
 *   - {@link MockMediaProtectionProvider} — DEV-only, deterministic fakes.
 *   - (future) a real adapter that calls the web BFF (`app/api/media/*`,
 *     owned by task 1.2), which in turn brokers to the Bilgim API.
 *
 * Keeping all protection concerns behind this interface lets the player be
 * built and tested before a real DRM provider is wired (Open Question 1).
 */
export interface MediaProtectionProvider {
  /**
   * Fetch a short-lived Playback_Ticket for an entitled viewer. Rejects when
   * the viewer lacks an APPROVED enrollment (no ticket is issued — Req 1.3).
   */
  getPlaybackTicket(req: ProtectedPlaybackRequest): Promise<ProtectedPlaybackTicket>;
  /**
   * Broker an EME license challenge and resolve the opaque license bytes the
   * CDM needs to decrypt (Req 1.1). The response is the raw license blob.
   */
  requestLicense(input: LicenseRequest): Promise<ArrayBuffer>;
}
