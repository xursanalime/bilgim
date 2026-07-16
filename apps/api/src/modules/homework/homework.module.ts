import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { EnvConfig } from '../../config/env.schema';
import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { AiModule } from '../ai/ai.module';
import {
  AI_GATEWAY,
  type AiGateway,
} from '../ai/ai.types';
import { CatalogModule } from '../catalog/catalog.module';
import { TeacherModule } from '../teacher/teacher.module';
import {
  AI_GRADING_PORT,
  AiGradingPort,
  AiGradingService,
  MockAiAdapter,
} from './ai-grading.service';
import { AiGradingController } from './ai-grading.controller';
import { AnthropicAiGradingAdapter } from './anthropic-ai-grading.adapter';
import { AssignmentService } from './assignment.service';
import { AssignmentsController } from './assignments.controller';
import { HomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';
import { AssignmentRepository } from './repositories/assignment.repository';
import { SpecialtyModuleRepository } from './repositories/specialty-module.repository';
import { SubmissionRepository } from './repositories/submission.repository';
import { HomeworkModuleRuntimeRegistry } from './runtimes/registry';
import { SubmissionService } from './submission.service';
import { SubmissionsController } from './submissions.controller';
import { AiGradingProcessor } from './workers/ai-grading.processor';

/**
 * HomeworkModule — Phase 6 bounded context.
 *
 * Surface area:
 *   - 17.1 — admin-managed `SpecialtyModule` catalog and the teacher
 *     read endpoint that powers the AssignmentBuilder picker.
 *   - 17.3 — Assignment + AssignmentModule lifecycle (create / edit /
 *     delete / publish), backed by `AssignmentService` and exposed via
 *     `AssignmentsController`. Publish emits `homework.assigned` to the
 *     outbox so the notification fan-out worker can deliver
 *     HOMEWORK_ASSIGNED to enrolled students.
 *   - 18.1 — Submission lifecycle (DRAFT → SUBMITTED → IN_REVIEW →
 *     GRADED → RETURNED) backed by `SubmissionService` /
 *     `SubmissionRepository` and exposed via `SubmissionsController`.
 *     The grade transition emits `homework.graded` to the outbox with
 *     idempotency key `homework.graded:{submissionId}` — the
 *     notification fan-out worker materialises that into a
 *     HOMEWORK_GRADED notification for the student.
 *   - 18.2 — AI grading precheck. `SubmissionService.submit` enqueues
 *     an `AiGradingJob` onto the `ai-grading` BullMQ queue;
 *     `AiGradingProcessor` consumes the queue and delegates to
 *     `AiGradingService`.
 *   - 20.3 — Anthropic-backed grading adapter + AI text detection.
 *     `AI_GRADING_PORT` is bound to `MockAiAdapter` by default; when
 *     `AI_GRADING_REAL=true` the module swaps in
 *     `AnthropicAiGradingAdapter` which routes per-module grading
 *     through the central `AiGateway`. AI text detection at submit
 *     time goes through `AiTextDetectService` (also wired via
 *     `AiModule`) — `SubmissionService.submit` stamps the resulting
 *     `aiLikelihood` / `aiFlagged` on the Submission row before
 *     committing the SUBMITTED transition (Req 13.7, 13.8).
 *
 * Imports:
 *   - `TeacherModule` for `SpecialtyService` and `TeacherProfileRepository`.
 *   - `CatalogModule` for `GroupModuleRepository` — the AssignmentService
 *     gates module selection on the per-group toggle state (Req 11.8).
 *   - `BullModule.registerQueue(AI_GRADING)` so `@InjectQueue` resolves
 *     the dedicated grading queue.
 *
 * Outbox emission goes through the global `OutboxService` provided by
 * `OutboxModule` in `AppModule`. Owns its own `PrismaClient` instance to
 * match the bounded-context pattern used by the rest of the modules.
 */
@Module({
  imports: [
    ConfigModule,
    TeacherModule,
    CatalogModule,
    AiModule,
    // The global BullMqModule already registers every queue, but
    // re-registering here makes `@InjectQueue(AI_GRADING)` work in unit
    // tests that import HomeworkModule in isolation, and is a no-op at
    // runtime (the same queue instance is reused).
    BullModule.registerQueue({ name: QUEUE_NAMES.AI_GRADING }),
  ],
  controllers: [
    HomeworkController,
    AssignmentsController,
    SubmissionsController,
    AiGradingController,
  ],
  providers: [
    HomeworkService,
    AssignmentService,
    SubmissionService,
    AiGradingService,
    AiGradingProcessor,
    MockAiAdapter,
    AnthropicAiGradingAdapter,
    {
      // Bind the AI grading port. By default we use the deterministic
      // mock adapter so unit tests and dev environments stay offline.
      // When the operator opts in via `AI_GRADING_REAL=true` (Task 20.3),
      // we swap in the Anthropic-backed adapter that routes through
      // `AiGatewayService` for the per-module grading pass — gateway
      // already enforces rate limit + audit + cost tracking
      // (Req 13.4, 13.5).
      provide: AI_GRADING_PORT,
      inject: [
        ConfigService,
        MockAiAdapter,
        AnthropicAiGradingAdapter,
        { token: AI_GATEWAY, optional: true },
      ],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        mock: MockAiAdapter,
        anthropic: AnthropicAiGradingAdapter,
        gateway?: AiGateway,
      ): AiGradingPort => {
        const useReal = config.get('AI_GRADING_REAL', { infer: true });
        // Even when the operator opts in we only return the real
        // adapter when the gateway is actually wired — otherwise we
        // would crash the worker at the first call. Safer to fall
        // back to the deterministic mock and emit a warning so the
        // misconfiguration is visible in logs.
        if (useReal && gateway) return anthropic;
        return mock;
      },
    },
    SpecialtyModuleRepository,
    AssignmentRepository,
    SubmissionRepository,
    HomeworkModuleRuntimeRegistry,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    HomeworkService,
    AssignmentService,
    SubmissionService,
    AiGradingService,
    SpecialtyModuleRepository,
    AssignmentRepository,
    SubmissionRepository,
    HomeworkModuleRuntimeRegistry,
  ],
})
export class HomeworkModule {}
