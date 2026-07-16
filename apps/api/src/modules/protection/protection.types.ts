/**
 * Types, DI token, and the vendor-agnostic `ProtectionProvider` port for
 * the content-protection backend (Task 1.2, Req 2.1, 7.2).
 *
 * The managed multi-DRM + forensic-watermarking vendor (`DRM_Provider`)
 * is an OPEN QUESTION (requirements.md Open Question 1: VdoCipher vs
 * Gumlet vs Mux vs self-hosted). The API therefore depends only on this
 * thin `ProtectionProvider` abstraction; one adapter is implemented per
 * vendor (`VdoCipher | Gumlet | Mux | DevFallback`) and selected at
 * runtime by the `DRM_PROVIDER` env flag (the secure config for the real
 * providers lands in Task 1.3).
 *
 * SECURITY INVARIANT (Req 2.2, design Property 2 — "Keys stay
 * server-side"): no method on this port returns DRM_Provider
 * credentials, content keys, or raw decryptable media to the caller.
 *   - `getSignedManifest` returns only a short-lived, proxied manifest
 *     *reference* (never a permanent, directly addressable storage URL).
 *   - `issueLicense` returns an opaque license blob produced by the
 *     vendor's license server, brokered server-side — never the key.
 *   - `bindWatermark` returns an optional session tag, never identity
 *     secrets.
 */

/** EME / CDM key systems brokered by the License_Proxy (Req 2.1). */
export type DrmKeySystem = 'widevine' | 'fairplay' | 'playready';

/** Input to {@link ProtectionProvider.issueLicense}. */
export interface IssueLicenseInput {
  /** Which CDM the EME challenge came from. */
  keySystem: DrmKeySystem;
  /** Opaque license challenge produced by the client CDM. */
  challenge: Buffer;
  /**
   * Server-derived per-viewer watermark identity (Req 3.1). Derived from
   * the authenticated session by the caller, never from client input.
   */
  viewerTag: string;
}

/**
 * Vendor-agnostic protection port the API depends on.
 *
 * Adapters: `VdoCipher | Gumlet | Mux | DevFallback`. The shape is kept
 * EXACTLY as specified in design.md so a real vendor adapter can drop in
 * without touching callers.
 */
export interface ProtectionProvider {
  /**
   * Whether this binding is a real, production-grade DRM_Provider.
   *
   * The clearly-flagged development fallback returns `false`; every real
   * vendor adapter (`VdoCipher | Gumlet | Mux`, Task 1.3) MUST return
   * `true`. Callers that must fail closed in production (the
   * `PlaybackTicketService` — Req 7.3, design Property 5) read this flag
   * to refuse issuing a protected playback ticket when only the
   * non-production fallback is bound. It is a property (not a method) so a
   * static, vendor-fixed capability cannot accidentally vary per request.
   */
  readonly productionGrade: boolean;
  /**
   * Resolve a short-lived signed (proxied) manifest reference for an
   * asset. MUST NOT return a permanent, directly addressable media URL
   * (Req 1.4).
   */
  getSignedManifest(assetId: string, ttlSec: number): Promise<{ manifestUrl: string }>;
  /**
   * Broker an EME license challenge to the DRM_Provider and return the
   * opaque license blob. The vendor keys stay server-side (Req 2.2).
   */
  issueLicense(input: IssueLicenseInput): Promise<Buffer>;
  /**
   * Bind a forensic/session watermark identity to the asset playback
   * session where the vendor supports it (Req 3.2), returning an optional
   * provider session tag for tracing.
   */
  bindWatermark(assetId: string, viewerTag: string): Promise<{ sessionTag?: string }>;
}

/** Dependency-injection token for the bound {@link ProtectionProvider}. */
export const PROTECTION_PROVIDER = Symbol('PROTECTION_PROVIDER');

/**
 * Stable error code thrown by the development fallback (and any future
 * fail-closed path) when a real DRM license is requested but no
 * DRM_Provider is configured (Req 7.2, 7.3). Surfaced as a
 * `503 Service Unavailable` so the client fails closed rather than
 * receiving an unprotected stream.
 */
export const DRM_PROVIDER_NOT_CONFIGURED = 'DRM_PROVIDER_NOT_CONFIGURED';

/**
 * Stable error code thrown when a PROTECTED PLAYBACK ticket is requested
 * in production but no production-grade DRM_Provider is bound (only the
 * development fallback is active). Surfaced as a `503 Service
 * Unavailable` so the client fails closed — no unprotected manifest is
 * served in production (Req 7.3, design Property 5 "Fail closed in
 * production"). The accompanying message is actionable: it tells the
 * operator to configure a real `DRM_PROVIDER`.
 */
export const PROTECTION_PROVIDER_UNAVAILABLE = 'PROTECTION_PROVIDER_UNAVAILABLE';

/**
 * Marker embedded in dev-fallback responses so neither the client nor a
 * log reader can mistake the development proxy for production-grade
 * protection (Req 7.2, design Error Handling — "Dev fallback path is
 * explicitly flagged in logs/responses as non-production protection").
 *
 *  - appended to the manifest reference as `?devFallback=1`
 *  - prefixed onto the watermark `sessionTag` as `dev-fallback:<tag>`
 */
export const DEV_FALLBACK_MARKER = 'dev-fallback';

/**
 * Env-flag values that select the clearly-flagged development fallback
 * adapter. An unset / empty flag also defaults to the dev fallback
 * (Task 1.2 — the secure config + real adapters arrive in Task 1.3).
 */
export const DEV_FALLBACK_PROVIDER_FLAGS = ['', 'dev', 'dev-fallback', 'none'] as const;

/**
 * Normalize the raw `DRM_PROVIDER` flag and decide whether it selects the
 * development fallback. Read defensively because `DRM_PROVIDER` is not in
 * `env.schema.ts` yet (Task 1.3 owns adding it) — an absent flag is a
 * valid "use the dev fallback" signal.
 */
export function isDevFallbackProviderFlag(flag: string | undefined | null): boolean {
  const normalized = (flag ?? '').trim().toLowerCase();
  return (DEV_FALLBACK_PROVIDER_FLAGS as readonly string[]).includes(normalized);
}
