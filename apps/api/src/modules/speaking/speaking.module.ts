import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { EnvConfig } from '../../config/env.schema';
import { createPrismaClient } from '../../infra/prisma';
import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { MediaModule } from '../media/media.module';
import { MockSpeakingScoringAdapter } from './adapters/mock-speaking-scoring.adapter';
import { TbdSpeakingScoringAdapter } from './adapters/tbd-speaking-scoring.adapter';
import { SpeakingSubmissionRepository } from './repositories/speaking-submission.repository';
import { SpeakingController } from './speaking.controller';
import { SpeakingScoringService } from './speaking-scoring.service';
import {
  SPEAKING_SCORING_PORT,
  type SpeakingScoringPort,
} from './speaking-scoring.types';
import { SpeakingService } from './speaking.service';
import { SpeakingScoringProcessor } from './workers/speaking-scoring.processor';

/**
 * SpeakingModule — Phase 4 bounded context (Task 4.1 + 4.2,
 * Req 7.1, 7.2, 7.3, 7.4, 7.6, 7.7).
 *
 * Task 4.1: accepts learner audio recordings for SPEAKING/PRONUNCIATION
 * assignment modules and stores them as AUDIO MediaAssets associated
 * with the learner's Submission.
 *
 * Task 4.2: AI scoring pipeline.
 *   - `SpeakingScoringService.enqueueScoring` pushes a `speaking.score`
 *     job onto the dedicated `speaking-scoring` BullMQ queue when a
 *     SPEAKING/PRONUNCIATION submission reaches SUBMITTED (Req 7.3).
 *   - `SpeakingScoringProcessor` consumes the queue and delegates to
 *     `SpeakingScoringService.score`, which produces a numeric score +
 *     structured pronunciation/fluency feedback persisted as an
 *     AI_DRAFT Feedback row, then transitions SUBMITTED → IN_REVIEW
 *     (Req 7.4).
 *   - `SpeakingScoringService.overrideScore` lets the owning instructor
 *     override the AI score + feedback before GRADED (Req 7.6).
 *
 * Scoring provider binding:
 *   `SPEAKING_SCORING_PORT` defaults to the deterministic, offline
 *   `MockSpeakingScoringAdapter`. The real transcription/scoring engine
 *   is an Open Question (6/7); when the operator opts in via
 *   `SPEAKING_SCORING_REAL=true` the module swaps in
 *   `TbdSpeakingScoringAdapter`, which refuses to fake a passing call
 *   until the provider is wired.
 *
 * Imports:
 *   - `MediaModule` — provides `MediaService`, reused to create the
 *     AUDIO MediaAsset via the existing R2 multipart upload lifecycle.
 *   - `BullModule.registerQueue(SPEAKING_SCORING)` so `@InjectQueue`
 *     resolves the dedicated scoring queue (the global BullMqModule
 *     already registers it at runtime; re-registering here makes
 *     isolated unit tests of the module work and is a no-op otherwise).
 */
@Module({
  imports: [
    ConfigModule,
    MediaModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.SPEAKING_SCORING }),
  ],
  controllers: [SpeakingController],
  providers: [
    SpeakingService,
    SpeakingScoringService,
    SpeakingScoringProcessor,
    SpeakingSubmissionRepository,
    MockSpeakingScoringAdapter,
    TbdSpeakingScoringAdapter,
    {
      // Bind the speaking-scoring provider. Default to the deterministic
      // mock so unit tests and dev environments stay offline. When the
      // operator opts in via `SPEAKING_SCORING_REAL=true`, swap in the
      // TBD adapter — it throws until the real provider (Open Question
      // 6/7) is implemented, so we never silently fake a score.
      provide: SPEAKING_SCORING_PORT,
      inject: [ConfigService, MockSpeakingScoringAdapter, TbdSpeakingScoringAdapter],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        mock: MockSpeakingScoringAdapter,
        tbd: TbdSpeakingScoringAdapter,
      ): SpeakingScoringPort => {
        const useReal = config.get('SPEAKING_SCORING_REAL', { infer: true });
        if (useReal === true) return tbd;
        return mock;
      },
    },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [SpeakingService, SpeakingScoringService],
})
export class SpeakingModule {}
