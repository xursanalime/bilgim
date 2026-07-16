import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { MediaAccessService } from '../media/media-access.service';
import { MediaAssetRepository } from '../media/repositories/media-asset.repository';
import { DevFallbackProtectionProvider } from './adapters/dev-fallback-protection.adapter';
import {
  LicenseProxyController,
  PLAYBACK_TICKET_VERIFIER,
} from './license-proxy.controller';
import { PlaybackTicketController } from './playback-ticket.controller';
import { PlaybackTicketService } from './playback-ticket.service';
import { PlaybackSessionRetentionTask } from './playback-session-retention.task';
import { PlaybackSessionRepository } from './repositories/playback-session.repository';
import {
  PROTECTION_PROVIDER,
  ProtectionProvider,
  isDevFallbackProviderFlag,
} from './protection.types';
import { WatermarkIdentityService } from './watermark-identity.service';

/**
 * Reads the `DRM_PROVIDER` flag defensively.
 *
 * `DRM_PROVIDER` is NOT yet part of `env.schema.ts` (Task 1.3 owns adding
 * the secure config), so the validated `ConfigService` cache may not
 * carry it. We therefore check `ConfigService.get` first (it falls back
 * to `process.env` for unvalidated keys) and then `process.env` directly,
 * defaulting to the dev fallback when unset.
 */
function readDrmProviderFlag(config: ConfigService): string | undefined {
  return config.get<string>('DRM_PROVIDER') ?? process.env.DRM_PROVIDER;
}

/**
 * ProtectionModule — owns the vendor-agnostic `ProtectionProvider` port
 * binding for the content-protection backend (Task 1.2, Req 2.1, 7.2).
 *
 * Provider selection (`useFactory` on `PROTECTION_PROVIDER`):
 *   - Default / `DRM_PROVIDER` unset / `dev` / `dev-fallback` / `none` →
 *     `DevFallbackProtectionProvider`, the clearly-flagged development
 *     fallback that wraps the existing media proxy and refuses to issue
 *     DRM licenses (Req 7.2).
 *   - Any other (real vendor) value → fails fast: the real adapters
 *     (`VdoCipher | Gumlet | Mux`) and their secure config land in
 *     Task 1.3. We throw at bootstrap rather than silently falling back to
 *     the dev proxy, so a half-configured production deployment cannot
 *     serve unprotected content while believing a provider is active
 *     (Req 7.3 — fail closed).
 *
 * Imports `ConfigModule` so the factory can read configuration. The
 * dev-fallback adapter is registered as a concrete provider so the
 * factory can resolve it, and `PROTECTION_PROVIDER` is exported for the
 * playback-ticket / license-proxy services landing in later tasks.
 *
 * Task 2.2 additions: the `WatermarkIdentityService` (derives the
 * per-viewer forensic watermark identity from the authenticated session)
 * and its `PlaybackSessionRepository` (persists the viewer↔session↔asset
 * mapping). The module owns its own `PrismaClient` (matching the
 * Media/Auth/Catalog pattern). `WatermarkIdentityService` is exported so
 * the `PlaybackTicketService` (Task 2.1) can consume it.
 *
 * Task 2.1 additions: the `PlaybackTicketService` + `PlaybackTicketController`
 * (`GET /media/assets/:id/playback-ticket`). The service reuses the media
 * module's `MediaAccessService` (the APPROVED-entitlement check) and
 * `MediaAssetRepository` (asset lookup) — registered here against this
 * module's own `PrismaClient` rather than importing the heavy `MediaModule`
 * (which would pull in the R2 + transcoding/BullMQ wiring). `MediaAccessService`
 * is imported, never edited. `PlaybackTicketService` is exported so the
 * `License_Proxy` (Task 2.3) can consume `verifyTicket`. The `controllers`
 * array is kept additive so the forthcoming `LicenseProxyController` can be
 * appended without restructuring.
 */
@Module({
  imports: [ConfigModule],
  controllers: [PlaybackTicketController, LicenseProxyController],
  providers: [
    DevFallbackProtectionProvider,
    WatermarkIdentityService,
    PlaybackSessionRepository,
    PlaybackSessionRetentionTask,
    MediaAccessService,
    MediaAssetRepository,
    PlaybackTicketService,
    // License_Proxy (Task 2.3) depends on the ticket verifier via a token
    // so it stays decoupled from the concrete service. Bind it to the
    // PlaybackTicketService whose `verifyTicket` recovers the signed claims.
    { provide: PLAYBACK_TICKET_VERIFIER, useExisting: PlaybackTicketService },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
    {
      provide: PROTECTION_PROVIDER,
      inject: [ConfigService, DevFallbackProtectionProvider],
      useFactory: (
        config: ConfigService,
        devFallback: DevFallbackProtectionProvider,
      ): ProtectionProvider => {
        const logger = new Logger('ProtectionModule');
        const flag = readDrmProviderFlag(config);

        if (isDevFallbackProviderFlag(flag)) {
          logger.warn(
            'PROTECTION_PROVIDER bound to the DEVELOPMENT fallback ' +
              '(DRM_PROVIDER unset or set to a dev value). This is NOT ' +
              'production-grade content protection — configure a real ' +
              'DRM_Provider via Task 1.3 before going to production.',
          );
          return devFallback;
        }

        // A real provider was named but no adapter is wired yet (Task 1.3).
        // Fail closed rather than degrade to the unprotected dev proxy.
        throw new Error(
          `DRM_PROVIDER="${flag}" has no protection adapter wired yet. ` +
            'Real DRM_Provider adapters (VdoCipher | Gumlet | Mux) and ' +
            'their secure config are added in Task 1.3. Unset DRM_PROVIDER ' +
            'to use the clearly-flagged development fallback.',
        );
      },
    },
  ],
  exports: [
    PROTECTION_PROVIDER,
    WatermarkIdentityService,
    PlaybackSessionRepository,
    PlaybackTicketService,
  ],
})
export class ProtectionModule {}
