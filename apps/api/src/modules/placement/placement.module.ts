import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { LevelingModule } from '../leveling/leveling.module';
import { PlacementController } from './placement.controller';
import { PlacementService } from './placement.service';
import { PlacementRepository } from './repositories/placement.repository';

/**
 * PlacementModule — Placement_Module (Phase 3).
 *
 * Task 3.1 scope: start a placement assessment (READING/GRAMMAR/VOCABULARY
 * items) and persist answers incrementally for resumption (Req 5.1, 5.4).
 *
 * Task 3.2 scope: submit + score → compute CEFR, set learner proficiency, and
 * emit a placement-result notification (Req 5.2, 5.3, 5.5, 15.1). For this it:
 *   - imports `LevelingModule` to reuse `LevelingService.recordProficiencyChange`
 *     (no proficiency-write logic is duplicated here), and
 *   - injects the global `OutboxService` (from the `@Global() OutboxModule`
 *     already wired in `AppModule`) to emit the `placement.result` event.
 *
 * Owns its own PrismaClient instance (same pattern as Enrollment/Billing).
 *
 * Wiring: this module is intentionally NOT registered in `app.module.ts` by
 * this task — the orchestrator imports `PlacementModule` from this package's
 * `index.ts`.
 */
@Module({
  imports: [ConfigModule, LevelingModule],
  controllers: [PlacementController],
  providers: [
    PlacementService,
    PlacementRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [PlacementService, PlacementRepository],
})
export class PlacementModule {}
