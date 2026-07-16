import { BadRequestException } from '@nestjs/common';
import { HomeworkModuleType, Prisma, SubmissionStatus } from '@prisma/client';
import { Job } from 'bullmq';
import * as fc from 'fast-check';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { MediaService, type UploadInitiated } from '../media/media.service';
import {
  SpeakingScoringContext,
  SpeakingSubmissionRepository,
} from './repositories/speaking-submission.repository';
import { SpeakingScoringService } from './speaking-scoring.service';
import {
  SPEAKING_AI_DRAFT_AUTHOR_TYPE,
  SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
  SPEAKING_SCORING_FAILED_TOPIC,
  type SpeakingScoreResult,
  type SpeakingScoringJob,
  type SpeakingScoringPort,
} from './speaking-scoring.types';
import { SpeakingActor, SpeakingService } from './speaking.service';
import { SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES } from './speaking.types';
import { SpeakingScoringProcessor } from './workers/speaking-scoring.processor';

/**
 * Property 4 — Speaking audio integrity + always score-or-flag.
 * (Task 4.4 from .kiro/specs/english-only-platform-refocus/tasks.md)
 *
 * Two sub-properties drawn verbatim from design.md → "Property 4:
 * Speaking audio integrity":
 *
 *   P4a — Audio integrity (Req 7.1, 7.7):
 *     A SPEAKING/PRONUNCIATION submission accepts ONLY audio content
 *     types on the Media_Module allowlist. A disallowed content type is
 *     rejected before any MediaAsset is created or storage is touched.
 *         submitAudio(ct) succeeds  ⇔  ct ∈ allowlist
 *
 *   P4b — Always score-or-flag (Req 7.5):
 *     Any audio submission that enters scoring ALWAYS reaches a terminal
 *     state that is EXACTLY ONE of
 *        (a) an AI score   → an AI_DRAFT Feedback row + status IN_REVIEW, or
 *        (b) a manual-review flag → an AI_SCORING_FAILED Feedback row
 *            + an instructor notification.
 *     It is NEVER left silently stuck with neither, and NEVER carries
 *     both. Re-delivery of the terminal job (BullMQ at-least-once) never
 *     produces a second draft, a second flag, or a second notification.
 *
 * Validates: Requirements 7.1, 7.5, 7.7
 *
 * Approach: drive the REAL `SpeakingService`, `SpeakingScoringService`
 * and `SpeakingScoringProcessor` over in-memory fakes that mirror the
 * production Prisma repository + transactional-outbox semantics. For
 * P4b we faithfully replay the BullMQ retry loop (attempts + at-least-
 * once redelivery) against arbitrary provider outcomes (succeeds on
 * the k-th attempt, or fails forever) so the invariant is checked over
 * every interleaving the worker can actually see.
 */

const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';
const ASSIGNMENT_ID = '22222222-2222-2222-2222-222222222222';
const MODULE_ID = '33333333-3333-3333-3333-333333333333';
const GROUP_ID = '44444444-4444-4444-4444-444444444444';
const ENROLLMENT_ID = '55555555-5555-5555-5555-555555555555';
const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const TEACHER_ID = '88888888-8888-8888-8888-888888888888';
const ASSET_ID = '77777777-7777-7777-7777-777777777777';

// ============================================================================
// P4a — Audio integrity (allowlist accept/reject) — Req 7.1, 7.7
// ============================================================================

/**
 * Content types that are NOT on the AUDIO allowlist. Deliberately a mix
 * of other media kinds, sibling audio codecs the allowlist excludes, and
 * generic catch-alls a malicious client might try to smuggle through.
 */
const DISALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'audio/aac',
  'audio/flac',
  'audio/x-wav',
  'application/octet-stream',
] as const;

function buildModuleContext(
  overrides: Partial<{ moduleType: HomeworkModuleType; isPublished: boolean }> = {},
) {
  return {
    moduleId: MODULE_ID,
    moduleType: (overrides.moduleType ?? 'SPEAKING') as HomeworkModuleType,
    assignmentId: ASSIGNMENT_ID,
    isPublished: overrides.isPublished ?? true,
    lessonId: 'lesson-1',
    groupId: GROUP_ID,
    teacherId: TEACHER_ID,
  };
}

function buildUpload(): UploadInitiated {
  return {
    assetId: ASSET_ID,
    uploadId: 'r2-upload-id',
    key: `media/${STUDENT_ID}/audio/2025/01/abc-answer.webm`,
    partUrls: [{ partNumber: 1, url: 'https://r2.example/part-1' }] as never,
    expiresInSeconds: 900,
    partSizeBytes: 8 * 1024 * 1024,
  };
}

describe('Property 4 — Speaking audio integrity + always score-or-flag [Validates: Requirements 7.1, 7.5, 7.7]', () => {
  const student: SpeakingActor = { userId: STUDENT_ID, role: 'STUDENT' };

  // --------------------------------------------------------------------------
  // P4a — only allowlisted audio content types are accepted (Req 7.1, 7.7)
  // --------------------------------------------------------------------------
  it('P4a: submitAudio accepts a content type iff it is on the Media_Module audio allowlist', async () => {
    const allowed = [...SPEAKING_AUDIO_ALLOWED_CONTENT_TYPES];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...allowed, ...DISALLOWED_CONTENT_TYPES),
        // SPEAKING and PRONUNCIATION are the two module types that take audio.
        fc.constantFrom<HomeworkModuleType>('SPEAKING', 'PRONUNCIATION'),
        async (contentType, moduleType) => {
          const media = {
            initiateUpload: jest.fn().mockResolvedValue(buildUpload()),
          };
          const updateAnswers = jest.fn().mockResolvedValue({ id: SUBMISSION_ID });
          const service = new SpeakingService(
            media as unknown as MediaService,
            {
              findModuleContext: jest
                .fn()
                .mockResolvedValue(buildModuleContext({ moduleType })),
              findApprovedEnrollment: jest
                .fn()
                .mockResolvedValue({ id: ENROLLMENT_ID }),
              getOrCreateDraftSubmission: jest
                .fn()
                .mockResolvedValue({ id: SUBMISSION_ID, answersJson: {} }),
              updateAnswers,
            } as unknown as SpeakingSubmissionRepository,
          );

          const dto = {
            fileName: 'answer.webm',
            contentType,
            sizeBytes: 1024 * 1024,
            partsCount: 1,
          };

          const result = await service
            .submitAudio(student, ASSIGNMENT_ID, MODULE_ID, dto)
            .then(
              (value) => ({ ok: true as const, value }),
              (error) => ({ ok: false as const, error }),
            );

          const isAllowlisted = allowed.includes(contentType);

          if (isAllowlisted) {
            // Accepted → an AUDIO MediaAsset is created and associated.
            expect(result.ok).toBe(true);
            expect(media.initiateUpload).toHaveBeenCalledTimes(1);
            expect(media.initiateUpload).toHaveBeenCalledWith(
              STUDENT_ID,
              expect.objectContaining({ kind: 'AUDIO', contentType }),
            );
            if (result.ok) {
              expect(result.value.assetId).toBe(ASSET_ID);
            }
          } else {
            // Rejected → BadRequest, and crucially NO MediaAsset / storage.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error).toBeInstanceOf(BadRequestException);
              expect(result.error.response?.code).toBe(
                'SPEAKING_AUDIO_CONTENT_TYPE_NOT_ALLOWED',
              );
            }
            expect(media.initiateUpload).not.toHaveBeenCalled();
            expect(updateAnswers).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // --------------------------------------------------------------------------
  // P4b — always score-or-flag, over the real BullMQ retry/redelivery loop
  //   Validates: Req 7.5
  // --------------------------------------------------------------------------
  it('P4b: any submission that enters scoring terminates with EXACTLY ONE of an AI score or a manual-review flag (idempotent under redelivery)', async () => {
    await fc.assert(
      fc.asyncProperty(
        scoringScenarioArb(),
        async (scenario) => {
          const world = newScoringWorld();
          const { processor, port } = buildScoringStack(world, scenario);

          // ---- Run #1: the worker drains the queue under the retry policy.
          await runWorkerToCompletion(processor, scenario.attempts);

          const hasDraft = world.feedbacks.some(
            (f) => f.authorType === SPEAKING_AI_DRAFT_AUTHOR_TYPE,
          );
          const hasFailureFlag = world.feedbacks.some(
            (f) => f.authorType === SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
          );

          // ----- Core invariant: ALWAYS score-or-flag, EXACTLY one. -----
          // Never silently stuck (neither marker present)…
          expect(hasDraft || hasFailureFlag).toBe(true);
          // …and never contradictory (both a score and a failure flag).
          expect(hasDraft && hasFailureFlag).toBe(false);

          if (hasDraft) {
            // (a) AI score path → IN_REVIEW with a numeric score stamped.
            expect(world.status).toBe('IN_REVIEW');
            expect(typeof world.score).toBe('number');
            // No spurious failure notification was emitted.
            expect(
              world.outboxKeys.has(
                `${SPEAKING_SCORING_FAILED_TOPIC}:${SUBMISSION_ID}`,
              ),
            ).toBe(false);
          } else {
            // (b) manual-review flag path → instructor notified exactly once.
            expect(
              world.outboxKeys.has(
                `${SPEAKING_SCORING_FAILED_TOPIC}:${SUBMISSION_ID}`,
              ),
            ).toBe(true);
          }

          // The terminal outcome must agree with the generated provider
          // behaviour: a provider that succeeds within the attempt budget
          // yields a score; one that never does yields the failure flag.
          const succeedsWithinBudget = scenario.kind === 'succeeds';
          expect(hasDraft).toBe(succeedsWithinBudget);
          expect(hasFailureFlag).toBe(!succeedsWithinBudget);

          // Snapshot terminal state for the redelivery comparison.
          const draftsAfterRun1 = world.feedbacks.filter(
            (f) => f.authorType === SPEAKING_AI_DRAFT_AUTHOR_TYPE,
          ).length;
          const flagsAfterRun1 = world.feedbacks.filter(
            (f) => f.authorType === SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
          ).length;
          const portCallsAfterRun1 = port.calls;
          const outboxSizeAfterRun1 = world.outboxKeys.size;

          // ---- Run #2: BullMQ is at-least-once — redeliver the job.
          await runWorkerToCompletion(processor, scenario.attempts);

          const draftsAfterRun2 = world.feedbacks.filter(
            (f) => f.authorType === SPEAKING_AI_DRAFT_AUTHOR_TYPE,
          ).length;
          const flagsAfterRun2 = world.feedbacks.filter(
            (f) => f.authorType === SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
          ).length;

          // Idempotency: never a SECOND draft, flag, or notification.
          expect(draftsAfterRun2).toBeLessThanOrEqual(1);
          expect(flagsAfterRun2).toBeLessThanOrEqual(1);
          expect(draftsAfterRun2 + flagsAfterRun2).toBe(1);
          expect(world.outboxKeys.size).toBe(outboxSizeAfterRun1);

          if (hasDraft) {
            // A landed draft is a hard idempotency stop — the provider is
            // never invoked again on redelivery.
            expect(draftsAfterRun2).toBe(draftsAfterRun1);
            expect(port.calls).toBe(portCallsAfterRun1);
          } else {
            // The failure marker stays singular and the notification is
            // not re-emitted, even though the worker re-ran to exhaustion.
            expect(flagsAfterRun2).toBe(flagsAfterRun1);
          }
        },
      ),
      { numRuns: 250 },
    );
  });
});

// ============================================================================
// P4b — in-memory scoring world + harness
// ============================================================================

/** Mirror of the persisted submission state the scoring flow mutates. */
interface ScoringWorld {
  status: SubmissionStatus;
  score: number | null;
  feedbacks: Array<{ authorType: string }>;
  outboxKeys: Set<string>;
  answersJson: Prisma.JsonValue;
  totalPoints: number;
}

function newScoringWorld(): ScoringWorld {
  return {
    status: 'SUBMITTED',
    score: null,
    feedbacks: [],
    outboxKeys: new Set<string>(),
    answersJson: {
      [MODULE_ID]: {
        kind: 'AUDIO',
        assetId: ASSET_ID,
        contentType: 'audio/webm',
        fileName: 'answer.webm',
        status: 'UPLOADING',
        registeredAt: new Date().toISOString(),
      },
    },
    totalPoints: 100,
  };
}

/** Provider behaviour for one lifecycle, with a per-call counter. */
interface DrivenPort extends SpeakingScoringPort {
  calls: number;
}

interface ScoringScenario {
  attempts: number;
  kind: 'succeeds' | 'fails';
  /**
   * Number of leading attempts that fail before the provider succeeds
   * (success scenarios only). Strictly less than `attempts` so the
   * provider always succeeds within the budget — modelling a transiently
   * flaky engine that recovers. `fails` scenarios never succeed.
   */
  failBeforeSuccess: number;
}

function scoringScenarioArb(): fc.Arbitrary<ScoringScenario> {
  return fc.integer({ min: 1, max: 4 }).chain((attempts) =>
    fc.oneof(
      // Provider succeeds on attempt `failBeforeSuccess` (0-indexed),
      // strictly within the attempt budget → the submission gets a score.
      fc
        .integer({ min: 0, max: attempts - 1 })
        .map((failBeforeSuccess) => ({
          attempts,
          kind: 'succeeds' as const,
          failBeforeSuccess,
        })),
      // Provider never succeeds → the budget is exhausted → failure flag.
      fc.constant({
        attempts,
        kind: 'fails' as const,
        failBeforeSuccess: Number.POSITIVE_INFINITY,
      }),
    ),
  );
}

function buildVerdict(): SpeakingScoreResult {
  return {
    overall: 0.8,
    pronunciation: { score: 0.85, comment: 'Clear articulation.' },
    fluency: { score: 0.75, comment: 'Mostly steady pacing.' },
    summary: 'Solid spoken answer.',
    provider: 'mock-speaking-v1',
    transcript: null,
  };
}

function buildDrivenPort(scenario: ScoringScenario): DrivenPort {
  const port: DrivenPort = {
    calls: 0,
    async scoreAudio() {
      const callIndex = port.calls;
      port.calls += 1;
      const shouldFail =
        scenario.kind === 'fails' || callIndex < scenario.failBeforeSuccess;
      if (shouldFail) {
        throw new Error(`provider failure on call ${callIndex}`);
      }
      return buildVerdict();
    },
  };
  return port;
}

/**
 * Build the real `SpeakingScoringService` + `SpeakingScoringProcessor`
 * over fakes that mirror the production Prisma repository and
 * transactional outbox. The repository fakes operate directly on
 * `world`, and `runInTransaction` runs the callback synchronously (the
 * production code re-checks idempotency guards inside the tx).
 */
function buildScoringStack(
  world: ScoringWorld,
  scenario: ScoringScenario,
): {
  service: SpeakingScoringService;
  processor: SpeakingScoringProcessor;
  port: DrivenPort;
} {
  const repo = {
    findScoringContext: jest.fn(
      async (): Promise<SpeakingScoringContext | null> => ({
        submissionId: SUBMISSION_ID,
        status: world.status,
        studentId: STUDENT_ID,
        assignmentId: ASSIGNMENT_ID,
        answersJson: world.answersJson,
        totalPoints: world.totalPoints,
        teacherId: TEACHER_ID,
        modules: [{ id: MODULE_ID, type: 'SPEAKING' as HomeworkModuleType }],
      }),
    ),
    findAiDraftFeedback: jest.fn(
      async (_submissionId: string, authorType: string) =>
        world.feedbacks.some((f) => f.authorType === authorType)
          ? { id: `fb-${authorType}` }
          : null,
    ),
    createFeedback: jest.fn(
      async (input: { authorType: string }) => {
        world.feedbacks.push({ authorType: input.authorType });
        return { id: `fb-${world.feedbacks.length}` } as never;
      },
    ),
    transitionToInReview: jest.fn(
      async (_submissionId: string, score: number | null) => {
        if (world.status !== 'SUBMITTED') return 0;
        world.status = 'IN_REVIEW';
        if (score !== null) world.score = score;
        return 1;
      },
    ),
    runInTransaction: jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    ),
  };

  const outbox = {
    create: jest.fn(
      async (_tx: unknown, input: { idempotencyKey: string }) => {
        if (world.outboxKeys.has(input.idempotencyKey)) return null;
        world.outboxKeys.add(input.idempotencyKey);
        return 'outbox-id';
      },
    ),
  };

  const port = buildDrivenPort(scenario);

  const service = new SpeakingScoringService(
    repo as unknown as SpeakingSubmissionRepository,
    port as unknown as SpeakingScoringPort,
    { add: jest.fn() } as never,
    outbox as unknown as OutboxService,
  );
  const processor = new SpeakingScoringProcessor(service);
  return { service, processor, port };
}

/** A BullMQ `Job` stub carrying the retry bookkeeping the processor reads. */
function makeJob(
  attemptsMade: number,
  attempts: number,
): Job<SpeakingScoringJob> {
  return {
    id: `job-${attemptsMade}`,
    data: { submissionId: SUBMISSION_ID, moduleId: MODULE_ID, assetId: ASSET_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<SpeakingScoringJob>;
}

/**
 * Faithfully replay the BullMQ at-least-once retry loop: deliver the job,
 * and on a thrown error re-deliver (incrementing `attemptsMade`) until the
 * attempt budget is exhausted. The processor itself marks the terminal
 * failure on the final attempt before re-throwing.
 */
async function runWorkerToCompletion(
  processor: SpeakingScoringProcessor,
  attempts: number,
): Promise<void> {
  for (let attemptsMade = 0; attemptsMade < attempts; attemptsMade += 1) {
    try {
      await processor.process(makeJob(attemptsMade, attempts));
      return; // returned normally → scored or idempotently skipped.
    } catch {
      // thrown → BullMQ retries until the budget is exhausted.
      if (attemptsMade + 1 >= attempts) return;
    }
  }
}
