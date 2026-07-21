import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { AdminModule } from '../admin/admin.module';
import { ThreatProtectionController } from './threat-protection.controller';
import { ThreatProtectionGuard } from './threat-protection.guard';
import { ThreatProtectionService } from './threat-protection.service';

/**
 * ThreatProtectionModule — Phase 10, Task 27.1.
 *
 * Owns:
 *   - `ThreatProtectionService` — Redis-backed WAF + DDoS state
 *     (signature inspection, IP block list, per-IP counters).
 *   - `ThreatProtectionGuard` — global guard wired in `AppModule`
 *     via `APP_GUARD` so every controller route is inspected.
 *   - `ThreatProtectionController` — admin surface for
 *     `/admin/threat-protection/blocked-ips` + `/unblock`.
 *
 * Relies on `RedisModule` (global) for the underlying ioredis client.
 * The global PrismaClient binding is exported by `AppModule`; we
 * additionally expose a module-local instance so unit tests that
 * import this module in isolation can resolve the dependency.
 *
 * The guard is exported so that `AppModule` can bind it via
 * `APP_GUARD`. Exporting the service lets adjacent modules
 * (e.g. notifications, billing) reuse the blocklist API in the
 * future without wiring a second copy of the Redis state.
 */
@Module({
  imports: [ConfigModule, AdminModule],
  controllers: [ThreatProtectionController],
  providers: [
    ThreatProtectionService,
    ThreatProtectionGuard,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [ThreatProtectionService, ThreatProtectionGuard],
})
export class ThreatProtectionModule {}
