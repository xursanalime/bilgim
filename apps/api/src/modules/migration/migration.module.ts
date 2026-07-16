import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import {
  MigrationRepository,
  PrismaMigrationRepository,
} from './migration.repository';
import { MigrationService } from './migration.service';

/**
 * MigrationModule — wires the one-time, idempotent Migration_Process (Req 16).
 *
 * Owns its own PrismaClient instance (same pattern as Placement/Leveling). The
 * {@link MigrationRepository} abstract port is bound to the Prisma-backed
 * implementation here; unit tests bypass Nest entirely and inject an in-memory
 * fake into {@link MigrationService} directly.
 *
 * Wiring: intentionally NOT registered in `app.module.ts`. It is run on demand
 * by `apps/api/scripts/run-refocus-migration.ts` (and can later back a guarded
 * admin trigger) rather than at application boot.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    MigrationService,
    { provide: MigrationRepository, useClass: PrismaMigrationRepository },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [MigrationService],
})
export class MigrationModule {}
