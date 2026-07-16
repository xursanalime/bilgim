import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../../infra/prisma';
import { LevelingController } from './leveling.controller';
import { LevelingService } from './leveling.service';
import { ProficiencyController } from './proficiency.controller';
import { LevelingRepository } from './repositories/leveling.repository';

/**
 * LevelingModule — owns CEFR level + Exam_Track assignment on Course/Group,
 * level inheritance/override resolution, and the publish-without-level guard
 * (Req 3.1 – 3.5).
 *
 * Exports `LevelingService` so other modules (notably the catalog publish
 * path) can call `assertCoursePublishable(courseId)` before publishing. The
 * pure `assertCourseHasCefrLevel` / `computeEffectiveLevel` helpers are also
 * exported from `leveling.service` for dependency-free reuse (Discovery,
 * Req 3.6).
 *
 * Owns its own PrismaClient instance, matching the CatalogModule pattern.
 * The orchestrator wires this module into `AppModule`.
 */
@Module({
  imports: [ConfigModule],
  controllers: [LevelingController, ProficiencyController],
  providers: [
    LevelingService,
    LevelingRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [LevelingService, LevelingRepository],
})
export class LevelingModule {}
