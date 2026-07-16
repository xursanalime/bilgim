import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEV_FALLBACK_MARKER,
  DRM_PROVIDER_NOT_CONFIGURED,
  IssueLicenseInput,
  ProtectionProvider,
} from '../protection.types';

/**
 * Default TTL (seconds) clamp window for the dev-fallback proxied
 * manifest reference. Mirrors the spirit of the media module's signed-URL
 * caps: a 60s floor so a manifest is always fetchable, and a short 5-minute
 * ceiling because the dev fallback is NOT production protection and should
 * never hand out a long-lived reference.
 */
const DEV_FALLBACK_MIN_TTL_SECONDS = 60;
const DEV_FALLBACK_MAX_TTL_SECONDS = 5 * 60;

/**
 * DevFallbackProtectionProvider — the clearly-flagged DEVELOPMENT binding
 * of `PROTECTION_PROVIDER` (Task 1.2, Req 7.2).
 *
 * ⚠️ THIS IS NOT PRODUCTION-GRADE PROTECTION. ⚠️
 *
 * It wraps the *existing* media proxy (the HLS/asset playback route that
 * hides the underlying R2 storage URLs — `GET /media/assets/:id/url`)
 * rather than performing any real DRM. Concretely:
 *
 *   - `getSignedManifest` returns a short-lived *proxied* manifest
 *     reference that points back at the existing media playback proxy.
 *     The real entitlement check + R2 signing still happen there, so the
 *     direct storage URL is never exposed (Req 1.4). The reference is
 *     explicitly tagged `?devFallback=1` so it can never be mistaken for
 *     a production signed manifest (Req 7.2).
 *
 *   - `issueLicense` DOES NOT fake a DRM license. Real multi-DRM
 *     licensing requires a configured DRM_Provider (Open Question 1 /
 *     Task 1.3). It throws `DRM_PROVIDER_NOT_CONFIGURED` (503) so
 *     protected playback fails closed instead of pretending to be
 *     encrypted (Req 7.2, 7.3 — "no unprotected production fallback").
 *
 *   - `bindWatermark` cannot bind a forensic/session watermark without a
 *     provider, so it returns a clearly-marked `dev-fallback:<tag>`
 *     session tag (visible-overlay-only deterrence) and logs a warning.
 *
 * Every method that is reachable logs a WARN line so an operator running
 * against the fallback is never under the illusion that content is
 * actually protected.
 */
@Injectable()
export class DevFallbackProtectionProvider implements ProtectionProvider {
  private readonly logger = new Logger(DevFallbackProtectionProvider.name);

  /**
   * The development fallback is NEVER production-grade. Callers that must
   * fail closed in production (the `PlaybackTicketService` — Req 7.3,
   * design Property 5) read this to refuse issuing a protected playback
   * ticket while only this non-production proxy is bound.
   */
  readonly productionGrade = false;

  constructor(private readonly config: ConfigService) {}

  async getSignedManifest(
    assetId: string,
    ttlSec: number,
  ): Promise<{ manifestUrl: string }> {
    this.warnNonProduction('getSignedManifest');

    const ttl = this.clampTtl(ttlSec);
    const base = this.resolveApiBaseUrl();
    // Point back at the EXISTING media playback proxy. That route performs
    // the entitlement check + R2 signing and never exposes the raw storage
    // URL. The `devFallback` flag marks this as a non-production reference.
    const manifestUrl =
      `${base}/media/assets/${encodeURIComponent(assetId)}/url` +
      `?ttl=${ttl}&${DEV_FALLBACK_MARKER}=1`;

    return { manifestUrl };
  }

  async issueLicense(input: IssueLicenseInput): Promise<Buffer> {
    // NEVER fake a license. Real DRM requires a configured provider.
    this.logger.error(
      `[${DEV_FALLBACK_MARKER}] issueLicense refused for keySystem=` +
        `${input.keySystem}: no DRM_Provider configured. Real multi-DRM ` +
        `licensing requires a provider (Open Question 1 / Task 1.3); the ` +
        `development fallback will not issue keys. Failing closed.`,
    );
    throw new ServiceUnavailableException({
      code: DRM_PROVIDER_NOT_CONFIGURED,
      message:
        'No DRM provider configured. Protected playback requires a ' +
        'configured DRM_Provider; the development fallback does not issue ' +
        'DRM licenses. Configure a provider (Task 1.3) to enable encrypted ' +
        'playback.',
    });
  }

  async bindWatermark(
    assetId: string,
    viewerTag: string,
  ): Promise<{ sessionTag?: string }> {
    this.warnNonProduction('bindWatermark');
    // Without a provider we cannot bind a forensic watermark. Return a
    // clearly-marked session tag so callers/log readers know the binding
    // is dev-only (visible-overlay deterrence, not forensic).
    return { sessionTag: `${DEV_FALLBACK_MARKER}:${viewerTag}` };
  }

  /**
   * Emit a single, unmistakable WARN line every time the development
   * fallback is exercised (Req 7.2 — flagged in logs as non-production).
   */
  private warnNonProduction(method: string): void {
    this.logger.warn(
      `[${DEV_FALLBACK_MARKER}] ${method} is serving via the DEVELOPMENT ` +
        `protection fallback — this is NOT production-grade DRM/watermark ` +
        `protection. Configure a DRM_Provider (Task 1.3) before relying on ` +
        `content protection.`,
    );
  }

  /** Clamp the requested TTL into the dev-fallback's short window. */
  private clampTtl(ttlSec: number): number {
    const ttl = Number.isFinite(ttlSec) ? Math.floor(ttlSec) : 0;
    return Math.min(
      Math.max(DEV_FALLBACK_MIN_TTL_SECONDS, ttl),
      DEV_FALLBACK_MAX_TTL_SECONDS,
    );
  }

  /**
   * Resolve the API base URL used to build the proxied manifest
   * reference. Read defensively with a safe localhost default so the
   * fallback works in any environment.
   */
  private resolveApiBaseUrl(): string {
    const raw = this.config.get<string>('API_URL') ?? 'http://localhost:4000';
    return raw.replace(/\/+$/, '');
  }
}
