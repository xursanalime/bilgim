/**
 * AiGradingService — orchestrates the AI grading precheck for a single
 * Submission (Task 18.2 + 20.3, Req 12.3, 12.4, 13.7, 13.8, 19.4, 14.4,
 * 14.6, 14.7).
 *
 * Two adapter ports:
 *   - `AiGradingPort` (DI token `AI_GRADING_PORT`): per-module grading
 *     (`gradeModule`). Bound to the deterministic `MockAiAdapter` until
 *     a Claude-backed grader ships; the AI Gateway has no `gradeModule`
 *     surface today (it only exposes `precheckWritingSubmission` for
 *     a single-text submission).
 *   - `AiGateway` (DI token `AI_GATEWAY`, optional): the central gateway
 *     for AI-text detection (`detectAiText`). Wired in Task 20.3 so
 *     the homework precheck flows through the same rate-limit + audit
 *     pipeline as the rest of the platform. When the gateway is not
 *     wired (older tests) the service falls back to
 *     `AiGradingPort.detectAiText` so the contract stays observable.
 *
 * Side-effect contract:
 *   1. `precheck(submissionId)` is idempotent — a re-delivered BullMQ job
 *      for the same submission MUST NOT produce a second AI Feedback
 *      row. We enforce this with a "find existing AI feedback first,
 *      skip if present" guard inside the same transaction that flips
 *      the submission status.
 *   2. The service writes one `Feedback` row with `authorType = 'AI'`
 *      and `isFinal = false` (per Task 20.3 — drafts only, teacher
 *      finalizes), payload `{ moduleResults, overallSuggestion,
 *      aiLikelihood, idempotencyTag }`.
 *   3. It updates `Submission.aiLikelihood` and `Submission.aiFlagged`
 *      based on the AI text-detection signal returned by the gateway
 *      (Task 20.3 — threshold 0.7).
 *   4. It transitions the submission `SUBMITTED → IN_REVIEW` so the
 *      teacher knows the precheck is complete (Req 12.4).
 *   5. It records one `AiCall` row per actual model invocation
 *      (Req 13.4 / 19.x). The mock adapter returns deterministic
 *      placeholder usage stats so the audit trail is preserved even
 *      before the real client lands. When `AiGateway` is wired, its
 *      audit pipeline writes its own `AiCall` row for the
 *      `AI_TEXT_DETECT` call — we still record the per-module
 *      `GRADE_PRECHECK` rows from the adapter side.
 *   6. Auto-rejection is FORBIDDEN (Task 20.3) — `aiFlagged` is purely
 *      informational. The submission stays in `IN_REVIEW` regardless of
 *      the flag value, awaiting teacher review.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiIntent,
  HomeworkModuleType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { AI_GATEWAY, AiGateway } from '../ai/ai.types';
import {
  buildLanguageFeedbackDimensions,
  LanguageFeedbackDimensions,
  requiresFeedbackDimensions,
} from './feedback-dimensions';
import { SubmissionRepository } from './repositories/submission.repository';
import { HomeworkModuleRuntimeRegistry } from './runtimes/registry';
import { AiPromptInputs } from './runtimes/types';

// ===================================================================
// Public types
// ===================================================================

/**
 * Threshold above which `Submission.aiFlagged` flips to true (Task 20.3).
 *
 * The platform exposes two thresholds in `apps/api/src/modules/ai/ai.constants.ts`
 * (0.85 task-brief default, 0.75 design.md Req 13.8). Task 20.3 explicitly
 * specifies 0.7 for the new `/ai/detect-ai-text` endpoint and the grading
 * pipeline. This module uses the lower 0.7 value so the teacher sees flags
 * sooner — false positives are cheap (the teacher decides), false
 * negatives leak AI-written work into the gradebook.
 */
export const AI_LIKELIHOOD_FLAG_THRESHOLD = 0.7;

/** Deterministic tag we put inside the Feedback payload so the
 *  idempotency guard works even if a future migration reuses the row.
 */
export const AI_FEEDBACK_AUTHOR_TYPE = 'AI';

/** Dependency-injection token for the underlying adapter. */
export const AI_GRADING_PORT = Symbol('AI_GRADING_PORT');

/**
 * Per-module input passed to the adapter. `answer` is the slice of
 * `Submission.answersJson` that corresponds to this module
 * (`answersJson[moduleId]`); the adapter is free to ignore it on
 * module types that don't carry textual answers (e.g. PROJECT_SUBMISSION).
 */
export interface ModuleGradeInput {
  moduleId: string;
  type: HomeworkModuleType;
  configJson: unknown;
  answer: unknown;
  /** Module weight (1..100) — the aggregator uses this to scale scores. */
  weight: number;
  /**
   * Pre-validated runtime prompt skeleton (Task 18.3) when a runtime is
   * registered for the module type. Adapters that want structured
   * rubric criteria + student text should prefer this over re-parsing
   * `configJson` / `answer` themselves. Absent when the module type
   * has no registered runtime (forward-compat opaque-JSON modules).
   */
  promptInputs?: AiPromptInputs;
}

/**
 * Per-module grading verdict produced by the adapter. `score` is in the
 * 0..1 range (the aggregator scales it to the assignment's totalPoints).
 */
export interface ModuleGradeResult {
  moduleId: string;
  type: HomeworkModuleType;
  /** 0..1 — adapter's confidence the answer is correct. */
  score: number;
  /** Free-form per-module feedback the teacher will see. */
  comment: string;
  /**
   * Structured English-teaching feedback dimensions (Req 9.2). Present
   * for text-based language skills that grade against grammar /
   * vocabulary / coherence — i.e. WRITING and GRAMMAR — and absent for
   * other module types (READING, opaque modules, ...). Typed so the
   * teacher UI can render the three dimensions deterministically.
   */
  dimensions?: LanguageFeedbackDimensions;
  /** Optional structured highlights (offset ranges) — UI may render. */
  highlights?: Array<{
    from: number;
    to: number;
    severity: 'info' | 'warning' | 'error';
    reason: string;
  }>;
  /** Adapter usage stats — used to write the `AiCall` audit row. */
  usage: AiUsage;
}

/** AI text-detection verdict for the WHOLE submission body. */
export interface AiTextDetectionResult {
  /** 0..1 — likelihood the text is AI-generated. */
  likelihood: number;
  /** Optional reasoning signals for the teacher UI. */
  signals: string[];
  usage: AiUsage;
}

/** Adapter usage stats — mirrors the columns on `AiCall`. */
export interface AiUsage {
  modelName: string;
  templateKey: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** `'OK'` for happy path, or an error code that maps to AiCall.status. */
  status: 'OK' | 'ERROR';
  errorMsg?: string;
}

/**
 * AiGradingPort — what every adapter must satisfy. Production code
 * binds this to an Anthropic-backed adapter; tests bind it to a fake.
 */
export interface AiGradingPort {
  gradeModule(input: ModuleGradeInput): Promise<ModuleGradeResult>;
  detectAiText(input: { text: string }): Promise<AiTextDetectionResult>;
}

/**
 * Aggregated precheck output — what the worker hands back so it can be
 * surfaced via job metrics / dashboards.
 */
export interface PrecheckResult {
  submissionId: string;
  /** `true` when this run actually wrote a new Feedback row. */
  feedbackCreated: boolean;
  /** `true` when the submission was already in IN_REVIEW (idempotent skip). */
  skipped: boolean;
  aiLikelihood: number;
  aiFlagged: boolean;
  moduleCount: number;
  aiCallsRecorded: number;
}

// ===================================================================
// MockAiAdapter — deterministic placeholder until Task 20.x.
// ===================================================================

/**
 * Production adapter used until the real Anthropic gateway lands in
 * Task 20.x. Returns deterministic per-module-type placeholder feedback
 * derived from the answer length and a stable text-detection score so
 * the audit trail (`AiCall` rows, `Feedback.payload`) is exercised end
 * to end without external network calls.
 *
 * IMPORTANT: do NOT extend this with hidden randomness — observability
 * tests and the idempotency assertion both rely on stable output.
 */
@Injectable()
export class MockAiAdapter implements AiGradingPort {
  private readonly logger = new Logger(MockAiAdapter.name);

  async gradeModule(input: ModuleGradeInput): Promise<ModuleGradeResult> {
    const text = this.extractText(input.answer);
    // A short heuristic: longer answers score slightly higher, capped at
    // 0.92 so the teacher always has room to disagree. Empty answers
    // float at 0.4 so the teacher sees a clear "needs review" signal.
    const length = text.length;
    const score = length === 0 ? 0.4 : Math.min(0.5 + length / 1000, 0.92);

    return {
      moduleId: input.moduleId,
      type: input.type,
      score,
      comment: this.placeholderCommentFor(input.type, length),
      // English-teaching feedback dimensions for the text-based language
      // skills (WRITING / GRAMMAR — Req 9.2). Other module types omit the
      // structured breakdown.
      ...(requiresFeedbackDimensions(input.type) && {
        dimensions: buildLanguageFeedbackDimensions({
          type: input.type,
          text,
          baseScore: score,
        }),
      }),
      ...(length > 0 && {
        highlights: [
          {
            from: 0,
            to: Math.min(length, 50),
            severity: 'info' as const,
            reason: 'Auto-generated placeholder highlight (mock adapter).',
          },
        ],
      }),
      usage: {
        modelName: 'mock-grading-v1',
        templateKey: `${input.type.toLowerCase()}.precheck.v1`,
        inputTokens: Math.max(1, Math.ceil(length / 4)),
        outputTokens: 64,
        costUsd: 0,
        latencyMs: 5,
        status: 'OK',
      },
    };
  }

  async detectAiText(input: {
    text: string;
  }): Promise<AiTextDetectionResult> {
    const text = input.text ?? '';
    // Stable, content-driven score so tests can assert exact thresholds
    // without flake. The bucketing matches the expected "low / medium /
    // high" classifier output.
    let likelihood = 0;
    if (text.length === 0) {
      likelihood = 0;
    } else if (text.length < 200) {
      likelihood = 0.2;
    } else if (text.length < 800) {
      likelihood = 0.5;
    } else {
      likelihood = 0.7;
    }

    return {
      likelihood,
      signals: [
        `length=${text.length}`,
        'mock-perplexity=neutral',
        'mock-classifier=neutral',
      ],
      usage: {
        modelName: 'mock-detector-v1',
        templateKey: 'ai_text_detect.v1',
        inputTokens: Math.max(1, Math.ceil(text.length / 4)),
        outputTokens: 32,
        costUsd: 0,
        latencyMs: 5,
        status: 'OK',
      },
    };
  }

  private extractText(answer: unknown): string {
    if (typeof answer === 'string') return answer;
    if (answer && typeof answer === 'object') {
      const maybeText = (answer as Record<string, unknown>)['text'];
      if (typeof maybeText === 'string') return maybeText;
      const maybeValue = (answer as Record<string, unknown>)['value'];
      if (typeof maybeValue === 'string') return maybeValue;
    }
    return '';
  }

  private placeholderCommentFor(
    type: HomeworkModuleType,
    length: number,
  ): string {
    if (length === 0) {
      return `[mock] No answer detected for ${type}; teacher should ask the student to retry.`;
    }
    return `[mock] Placeholder feedback for ${type} (${length} chars). Real model will replace this once Task 20.x lands.`;
  }
}

// ===================================================================
// AiGradingService — the public entry point used by the processor.
// ===================================================================

@Injectable()
export class AiGradingService {
  private readonly logger = new Logger(AiGradingService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly submissionRepository: SubmissionRepository,
    @Inject(AI_GRADING_PORT) private readonly adapter: AiGradingPort,
    @Optional() private readonly runtimeRegistry?: HomeworkModuleRuntimeRegistry,
    @Optional() @Inject(AI_GATEWAY) private readonly aiGateway?: AiGateway,
  ) {}

  /**
   * Run the precheck pipeline for one submission. Idempotent — a
   * re-invocation for the same `submissionId` returns
   * `{ skipped: true }` without calling the adapter or writing a
   * second Feedback row.
   */
  async precheck(submissionId: string): Promise<PrecheckResult> {
    const submission =
      await this.prisma.submission.findUnique({
        where: { id: submissionId },
        include: {
          assignment: {
            include: {
              modules: { orderBy: { order: 'asc' } },
            },
          },
        },
      });

    if (!submission) {
      this.logger.warn(
        `precheck: submission ${submissionId} not found; skipping`,
      );
      return {
        submissionId,
        feedbackCreated: false,
        skipped: true,
        aiLikelihood: 0,
        aiFlagged: false,
        moduleCount: 0,
        aiCallsRecorded: 0,
      };
    }

    // Idempotency guard #1 — already prechecked once.
    const existing = await this.prisma.feedback.findFirst({
      where: { submissionId, authorType: AI_FEEDBACK_AUTHOR_TYPE },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `precheck: submission ${submissionId} already has AI feedback (${existing.id}); skipping`,
      );
      return {
        submissionId,
        feedbackCreated: false,
        skipped: true,
        aiLikelihood: submission.aiLikelihood ?? 0,
        aiFlagged: submission.aiFlagged,
        moduleCount: submission.assignment.modules.length,
        aiCallsRecorded: 0,
      };
    }

    // Idempotency guard #2 — only run on SUBMITTED rows. If the row
    // already moved to IN_REVIEW / GRADED / RETURNED a previous run
    // already finished. This belt-and-braces check matters because the
    // BullMQ retry policy can re-deliver a job after a partial-success
    // crash where Feedback was rolled back but the status stuck.
    if (submission.status !== 'SUBMITTED') {
      this.logger.debug(
        `precheck: submission ${submissionId} is in status ${submission.status}; skipping`,
      );
      return {
        submissionId,
        feedbackCreated: false,
        skipped: true,
        aiLikelihood: submission.aiLikelihood ?? 0,
        aiFlagged: submission.aiFlagged,
        moduleCount: submission.assignment.modules.length,
        aiCallsRecorded: 0,
      };
    }

    const answers =
      (submission.answersJson as Record<string, unknown> | null) ?? {};

    const moduleInputs: ModuleGradeInput[] = submission.assignment.modules.map(
      (m) => {
        const base: ModuleGradeInput = {
          moduleId: m.id,
          type: m.type,
          configJson: m.configJson,
          answer: answers[m.id] ?? null,
          weight: m.weight,
        };
        // Wire the runtime's AI prompt skeleton (Task 18.3) when one
        // is registered. The adapter is free to ignore it for module
        // types that don't carry textual answers, but for WRITING
        // (and future RPG-style modules) this is where rubric
        // criteria + student text reach the prompt template.
        const runtime = this.runtimeRegistry?.get(m.type);
        if (runtime) {
          try {
            const config = runtime.validateConfig(m.configJson);
            const answer = runtime.validateAnswer(
              config,
              answers[m.id] ?? null,
            );
            base.promptInputs = runtime.aiPromptInputs(config, answer);
          } catch (error) {
            // Non-fatal — the precheck still runs against raw configJson
            // and answer. We log so the audit trail captures the
            // mismatch but never block grading on a runtime hiccup.
            this.logger.debug(
              `precheck: runtime aiPromptInputs failed for module ${m.id} (${m.type}): ${(error as Error).message}`,
            );
          }
        }
        return base;
      },
    );

    // ------------------------------------------------------------------
    // 1. Per-module grading.
    // ------------------------------------------------------------------
    const moduleResults: ModuleGradeResult[] = [];
    const aiCallInputs: AiCallRow[] = [];

    for (const input of moduleInputs) {
      try {
        const result = await this.adapter.gradeModule(input);
        moduleResults.push(result);
        aiCallInputs.push(
          this.buildAiCallRow({
            userId: submission.studentId,
            intent: AiIntent.GRADE_PRECHECK,
            usage: result.usage,
            refType: 'submission_module',
            refId: input.moduleId,
          }),
        );
      } catch (error) {
        const message = (error as Error).message ?? 'unknown adapter error';
        this.logger.error(
          `precheck: gradeModule failed for module ${input.moduleId} (${input.type}): ${message}`,
        );
        // Record the failed call but continue — partial results are
        // still useful to the teacher.
        aiCallInputs.push(
          this.buildAiCallRow({
            userId: submission.studentId,
            intent: AiIntent.GRADE_PRECHECK,
            usage: {
              modelName: 'unknown',
              templateKey: `${input.type.toLowerCase()}.precheck.v1`,
              inputTokens: 0,
              outputTokens: 0,
              costUsd: 0,
              latencyMs: 0,
              status: 'ERROR',
              errorMsg: message,
            },
            refType: 'submission_module',
            refId: input.moduleId,
          }),
        );
      }
    }

    // ------------------------------------------------------------------
    // 2. AI text detection on the concatenated student text.
    //    Prefer the central `AiGateway` (Task 20.3) so the call flows
    //    through the platform-wide rate limit + audit pipeline. When
    //    the gateway is not wired (older unit tests injecting only the
    //    grading port), fall back to the adapter's own `detectAiText`.
    // ------------------------------------------------------------------
    const concatenatedText = this.concatenateText(answers);
    let detection: AiTextDetectionResult;
    try {
      if (this.aiGateway) {
        const gatewayResult = await this.aiGateway.detectAiText({
          userId: submission.studentId,
          text: concatenatedText,
        });
        detection = {
          likelihood: gatewayResult.likelihood,
          signals: gatewayResult.signals,
          // The gateway's audit pipeline already wrote the AiCall row
          // for this AI_TEXT_DETECT call — we mark the usage as
          // pre-recorded so we don't double-count by writing another
          // audit row from this service.
          usage: {
            modelName: 'ai-gateway',
            templateKey: 'ai_text_detect.v1',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            status: 'OK',
          },
        };
      } else {
        detection = await this.adapter.detectAiText({ text: concatenatedText });
        aiCallInputs.push(
          this.buildAiCallRow({
            userId: submission.studentId,
            intent: AiIntent.AI_TEXT_DETECT,
            usage: detection.usage,
            refType: 'submission',
            refId: submission.id,
          }),
        );
      }
    } catch (error) {
      const message = (error as Error).message ?? 'unknown detector error';
      this.logger.error(
        `precheck: detectAiText failed for submission ${submission.id}: ${message}`,
      );
      detection = {
        likelihood: 0,
        signals: ['detector-failed'],
        usage: {
          modelName: 'unknown',
          templateKey: 'ai_text_detect.v1',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          status: 'ERROR',
          errorMsg: message,
        },
      };
      // Always record the failure locally so the audit trail captures
      // the error even when the gateway is down.
      aiCallInputs.push(
        this.buildAiCallRow({
          userId: submission.studentId,
          intent: AiIntent.AI_TEXT_DETECT,
          usage: detection.usage,
          refType: 'submission',
          refId: submission.id,
        }),
      );
    }

    const aiLikelihood = clamp01(detection.likelihood);
    const aiFlagged = aiLikelihood >= AI_LIKELIHOOD_FLAG_THRESHOLD;

    // ------------------------------------------------------------------
    // 3. Aggregate + persist (single transaction).
    // ------------------------------------------------------------------
    const aggregate = this.aggregate(
      moduleResults,
      submission.assignment.totalPoints,
    );

    const payload: Prisma.InputJsonValue = {
      idempotencyTag: `ai-precheck:${submission.id}`,
      moduleResults: moduleResults.map((r) => ({
        moduleId: r.moduleId,
        type: r.type,
        score: r.score,
        comment: r.comment,
        ...(r.dimensions && { dimensions: r.dimensions }),
        ...(r.highlights && { highlights: r.highlights }),
      })),
      overallSuggestion: {
        suggestedScore: aggregate.suggestedScore,
        summary: aggregate.summary,
      },
      aiLikelihood,
      aiSignals: detection.signals,
    } as unknown as Prisma.InputJsonValue;

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction for race-safety. Two concurrent
      // workers picking up the same job both find no existing feedback,
      // both reach the transaction; only one wins because we re-query
      // and bail out if the other already wrote.
      const raceCheck = await tx.feedback.findFirst({
        where: { submissionId, authorType: AI_FEEDBACK_AUTHOR_TYPE },
        select: { id: true },
      });
      if (raceCheck) {
        return { feedbackCreated: false, skipped: true } as const;
      }

      await tx.feedback.create({
        data: {
          submissionId,
          authorType: AI_FEEDBACK_AUTHOR_TYPE,
          authorId: null,
          payload,
          isFinal: false,
        },
      });

      // Stamp aiFlagged + aiLikelihood and flip the lifecycle status.
      await tx.submission.updateMany({
        where: { id: submissionId, status: 'SUBMITTED' },
        data: {
          status: 'IN_REVIEW',
          aiLikelihood,
          aiFlagged,
        },
      });

      // Audit rows — one per actual model invocation. We write them
      // last so a transaction rollback also nukes the audit, keeping
      // the trail consistent with the side-effecting writes.
      if (aiCallInputs.length > 0) {
        await tx.aiCall.createMany({
          data: aiCallInputs,
        });
      }

      return { feedbackCreated: true, skipped: false } as const;
    });

    this.logger.log(
      `precheck: submission ${submissionId} → IN_REVIEW (modules=${moduleResults.length}, aiLikelihood=${aiLikelihood.toFixed(3)}, aiFlagged=${aiFlagged})`,
    );

    return {
      submissionId,
      feedbackCreated: result.feedbackCreated,
      skipped: result.skipped,
      aiLikelihood,
      aiFlagged,
      moduleCount: moduleResults.length,
      aiCallsRecorded: result.feedbackCreated ? aiCallInputs.length : 0,
    };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Combine per-module scores into an overall suggested score scaled to
   * `totalPoints`. Modules without a score (adapter failed) contribute
   * 0 — the teacher will see the gap in `moduleResults`.
   */
  private aggregate(
    moduleResults: ModuleGradeResult[],
    totalPoints: number,
  ): { suggestedScore: number; summary: string } {
    if (moduleResults.length === 0) {
      return {
        suggestedScore: 0,
        summary: 'No modules graded — adapter returned no results.',
      };
    }
    const weightedSum = moduleResults.reduce(
      (acc, r) => acc + clamp01(r.score),
      0,
    );
    const avg = weightedSum / moduleResults.length;
    const suggestedScore = Math.round(avg * totalPoints);
    const summary = `AI precheck across ${moduleResults.length} modules — suggested ${suggestedScore}/${totalPoints}. Teacher should review highlights before publishing the final grade.`;
    return { suggestedScore, summary };
  }

  private concatenateText(answers: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const value of Object.values(answers)) {
      if (typeof value === 'string') {
        parts.push(value);
      } else if (value && typeof value === 'object') {
        const text = (value as Record<string, unknown>)['text'];
        if (typeof text === 'string') parts.push(text);
        const v = (value as Record<string, unknown>)['value'];
        if (typeof v === 'string') parts.push(v);
      }
    }
    return parts.join('\n\n');
  }

  private buildAiCallRow(input: {
    userId: string;
    intent: AiIntent;
    usage: AiUsage;
    refType: string;
    refId: string;
  }): AiCallRow {
    return {
      userId: input.userId,
      intent: input.intent,
      templateKey: input.usage.templateKey,
      modelName: input.usage.modelName,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      costUsd: new Prisma.Decimal(input.usage.costUsd.toFixed(6)),
      latencyMs: input.usage.latencyMs,
      refType: input.refType,
      refId: input.refId,
      status: input.usage.status,
      errorMsg: input.usage.errorMsg ?? null,
    };
  }

  /**
   * Exposed for tests — surface the configured adapter so they can
   * assert the binding without poking at private fields.
   */
  getAdapter(): AiGradingPort {
    return this.adapter;
  }
}

// ===================================================================
// Internals
// ===================================================================

/** Shape of a row passed to `AiCall.createMany`. */
interface AiCallRow {
  userId: string;
  intent: AiIntent;
  templateKey: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: Prisma.Decimal;
  latencyMs: number;
  refType: string;
  refId: string;
  status: string;
  errorMsg: string | null;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
