/**
 * MockMediaProtectionProvider — a DEVELOPMENT-ONLY adapter.
 *
 * ⚠️ NOT FOR PRODUCTION. This adapter performs NO real entitlement check, NO
 * real DRM, and returns deterministic FAKE tickets + FAKE license bytes. It
 * exists so the protected player + `useProtectedMedia` hook (tasks 1.3/1.4)
 * can be built and tested before a real DRM provider is wired (Open
 * Question 1). Every response is clearly flagged as a dev fallback (the
 * watermark tag is prefixed `dev-fallback:` and the manifest/license refs
 * carry `?devFallback=1`), mirroring the backend dev-fallback marker so it can
 * never be mistaken for production-grade protection.
 */

import type {
  LicenseRequest,
  MediaProtectionProvider,
  ProtectedPlaybackRequest,
  ProtectedPlaybackTicket,
  KeySystem,
} from './types';
import { KEY_SYSTEMS } from './types';

/**
 * Marker stamped onto every dev-fallback response so neither the client nor a
 * log reader mistakes the mock for production-grade protection. Mirrors the
 * backend `DEV_FALLBACK_MARKER` (`apps/api/.../protection.types.ts`).
 */
export const DEV_FALLBACK_MARKER = 'dev-fallback';

/** Default TTL for a mock ticket (seconds) — short, like the real backend. */
const DEFAULT_MOCK_TTL_SECONDS = 120;

/** Options for {@link MockMediaProtectionProvider}. */
export interface MockMediaProtectionProviderOptions {
  /**
   * Ticket lifetime in seconds. Defaults to {@link DEFAULT_MOCK_TTL_SECONDS}.
   * Kept short so expiry / re-auth flows can be exercised in tests.
   */
  ttlSeconds?: number;
  /**
   * Whether the mock reports Download_Permission as enabled. Defaults to
   * `false`, matching the server-side "disabled by default" rule (Req 2.1).
   */
  downloadAllowed?: boolean;
  /**
   * Clock injection for deterministic tests. Defaults to `() => Date.now()`.
   */
  now?: () => number;
}

/**
 * Build the per-key-system License_Proxy endpoint map, mirroring the backend
 * (`/media/assets/:id/license/:keySystem`) but routed through the web BFF
 * (`/api/media/...`, owned by task 1.2) and flagged as a dev fallback.
 */
function buildMockLicenseEndpoints(assetId: string): Record<KeySystem, string> {
  const encoded = encodeURIComponent(assetId);
  return KEY_SYSTEMS.reduce(
    (acc, keySystem) => {
      acc[keySystem] = `/api/media/assets/${encoded}/license/${keySystem}?${DEV_FALLBACK_MARKER}=1`;
      return acc;
    },
    {} as Record<KeySystem, string>,
  );
}

/**
 * Deterministic, dev-only {@link MediaProtectionProvider}. Returns a
 * well-formed fake ticket (short, future expiry; fake manifest reference
 * pointing at the existing media proxy; a masked watermark label) and fake
 * license bytes — all explicitly flagged as non-production.
 */
export class MockMediaProtectionProvider implements MediaProtectionProvider {
  private readonly ttlSeconds: number;
  private readonly downloadAllowed: boolean;
  private readonly now: () => number;

  constructor(options: MockMediaProtectionProviderOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_MOCK_TTL_SECONDS;
    this.downloadAllowed = options.downloadAllowed ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Resolve a deterministic fake ticket. Does NOT contact any server and does
   * NOT verify entitlement — DEV ONLY.
   */
  async getPlaybackTicket(
    req: ProtectedPlaybackRequest,
  ): Promise<ProtectedPlaybackTicket> {
    const encoded = encodeURIComponent(req.assetId);
    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.ttlSeconds * 1000;

    // Fake manifest reference points at the EXISTING web media proxy so the
    // player can be wired before a real provider exists. Flagged dev-fallback.
    const lessonQuery =
      req.lessonId !== undefined
        ? `&lessonId=${encodeURIComponent(req.lessonId)}`
        : '';
    const manifestRef = `/api/media/proxy?assetId=${encoded}${lessonQuery}&${DEV_FALLBACK_MARKER}=1`;

    return {
      ticket: `${DEV_FALLBACK_MARKER}.${encoded}.${issuedAtMs}`,
      manifestRef,
      licenseEndpoints: buildMockLicenseEndpoints(req.assetId),
      watermark: {
        label: `DEV • viewer@bilgim.dev • ${req.assetId}`,
        tag: `${DEV_FALLBACK_MARKER}:${encoded}`,
      },
      downloadAllowed: this.downloadAllowed,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Return deterministic fake license bytes. The payload is a UTF-8 marker so
   * it is obviously a dev fallback and never a real CDM license. DEV ONLY.
   */
  async requestLicense(input: LicenseRequest): Promise<ArrayBuffer> {
    const marker = `${DEV_FALLBACK_MARKER}:license:${input.keySystem}:${input.assetId}`;
    // Encode without `TextEncoder` so the mock is environment-agnostic (the
    // marker is ASCII-only). Avoids depending on Web/Node text APIs that may
    // be absent in some test environments.
    const bytes = new Uint8Array(marker.length);
    for (let i = 0; i < marker.length; i += 1) {
      bytes[i] = marker.charCodeAt(i) & 0xff;
    }
    return bytes.buffer;
  }
}
