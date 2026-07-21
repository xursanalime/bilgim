import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { DiscoveryRepository } from './repositories/discovery.repository';

/**
 * DiscoveryModule — public, unauthenticated read surface for visitors
 * (Req 14.1 — 14.7).
 *
 * Owns its own PrismaClient (mirroring the convention used by the other
 * bounded-context modules). The intent is that this client points at a
 * read-replica DSN — wired here at boot via the `DATABASE_REPLICA_URL`
 * env var when present, so swapping in CQRS-lite is a one-line change.
 *
 * `CacheService` is provided globally by `CacheModule` (`@Global()`),
 * so we pull it in via constructor injection without re-importing it
 * here.
 */
@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    DiscoveryRepository,
    {
      provide: PrismaClient,
      useFactory: () => {
        const replicaUrl = process.env.DATABASE_REPLICA_URL;
        return createPrismaClient(
          replicaUrl ? { datasourceUrl: replicaUrl } : {},
        );
      },
    },
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
