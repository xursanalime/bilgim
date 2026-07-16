/**
 * AnthropicAiGradingAdapter — production binding for `AI_GRADING_PORT`
 * (Task 20.3, Req 13.7, 13.8, 14.4, 14.6, 14.7).
 *
 * Why this lives in `modules/homework/` and not `modules/ai/`:
 *   The gateway exposes provider-agnostic primitives
 *   (`precheckWritingSubmission`, `detectAiText`). The homework
 *   bounded context owns the per-module grading shape
 *   (`AiGradingPort.gradeModule`) — the adapter translates between
 *   the two. Keeping it on the homework side avoids a back-call from
 *   `ai/` into `homework/` while keeping the gateway free of
 *   homework-specific types.
 *
 * Wiring:
 *   `HomeworkModule` selects between this adapter and `MockAiAdapter`
 *   based on the env flag `AI_GRADING_REAL`:
 *     - `AI_GRADING_REAL=true`  → AnthropicAiGradingAdapter (calls
 *                                   the AI gateway → Anthropic SDK)
 *     - default                → MockAiAdapter (deterministic,
 *                                   offline-friendly for tests).
 *   The adapter never reads env vars itself — the module factory
 *   wires it up so unit tests can construct it directly with a fake
 *   `AiGateway`.
 *
 * Side-effect contract:
 *   The adapter is side-effect free apart from the AI gateway call.
 *   The gateway already writes the `AiCall` audit row for the
 *   `GRADE_PRECHECK` and `AI_TEXT_DETECT` intents — this adapter
 *   reports zeroed `usage` so `AiGradingService` does not double-count
 *   the cost when it writes its own `submission_module` audit row.
 *
 * Failure mode:
 *   `AiGatewayService` errors propagate to the caller as-is. The
 *   `AiGradingService.precheck` loop already wraps `gradeModule`
 *   calls in a try/catch and records an ERROR audit row, so a
 *   transient gateway failure does not abort the whole submission.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AI_GATEWAY,
  type AiGateway,
} from '../ai/ai.types';
import {
  AiGradingPort,
  AiTextDetectionResult,
  ModuleGradeInput,
  ModuleGradeResult,
} from './ai-grading.service';
import {
  buildLanguageFeedbackDimensions,
  requiresFeedbackDimensions,
} from './feedback-dimensions';

/**
 * Module types the adapter knows how to grade with the AI gateway.
 * Other types fall back to a "no AI grading" placeholder so the
 * teacher still sees the runtime's auto-score in the gradebook.
 *
 * WRITING and GRAMMAR are the text-based language skills that receive
 * structured grammar/vocabulary/coherence feedback (Req 9.2); READING
 * is graded as free text but without the per-skill dimension breakdown.
 */
const TEXT_GRADABLE_TYPES = new Set<string>(['WRITING', 'READING', 'GRAMMAR']);

@Injectable()
export class AnthropicAiGradingAdapter implements AiGradingPort {
  private readonly logger = new Logger(AnthropicAiGradingAdapter.name);

  constructor(@Inject(AI_GATEWAY) private readonly gateway: AiGateway) {}

  /**
   * Grade a single submission module. Routes through
   * `AiGateway.precheckWritingSubmission` when the module carries
   * free text (WRITING / READING) — that endpoint returns
   * `{ score, summary, highlights, ... }` which maps cleanly onto
   * `ModuleGradeResult`.
   *
   * Modules without free text (MULTIPLE_CHOICE / GRAMMAR / etc.) are
   * not graded by this adapter — their runtime already auto-scores.
   * We return a neutral score of 0 + a comment so the teacher knows
   * to look at the runtime's verdict instead.
   */
  async gradeModule(input: ModuleGradeInput): Promise<ModuleGradeResult> {
    const studentText = extractStudentText(input);

    // Non-textual modules — let the auto-grader speak.
    if (!TEXT_GRADABLE_TYPES.has(String(input.type))) {
      return this.placeholderResult(
        input,
        `[ai-grading] Module type ${input.type} is auto-scored by its runtime; AI grading skipped.`,
      );
    }

    if (studentText.length === 0) {
      // Empty answer — no point burning a Claude call. Return a "needs
      // review" placeholder mirroring the MockAiAdapter behaviour.
      return this.placeholderResult(
        input,
        `[ai-grading] No answer detected for ${input.type}; teacher should ask the student to retry.`,
        0,
      );
    }

    const rubric = this.buildRubricText(input);
    const language = this.detectLanguage(input);
    const userId = pickUserId(input);
    const submissionRef = pickSubmissionRef(input);

    try {
      const response = await this.gateway.precheckWritingSubmission({
        userId,
        // The gateway expects a UUID-ish opaque id for audit `refId` —
        // when the caller did not pass one we fall back to the module
        // id so the audit row still points back to a stable resource.
        submissionId: submissionRef,
        text: studentText,
        ...(rubric.length > 0 ? { rubric } : {}),
        language,
      });

      const highlights = (response.highlights ?? []).map((h) => ({
        from: Number(h.from ?? 0),
        to: Number(h.to ?? 0),
        severity: h.severity ?? 'info',
        reason: String(h.reason ?? ''),
      }));

      const score = clamp01(response.score ?? 0);
      return {
        moduleId: input.moduleId,
        type: input.type,
        score,
        comment: response.summary?.trim().length
          ? response.summary
          : `[ai-grading] No summary returned for ${input.type}.`,
        // Structured English-teaching dimensions for WRITING / GRAMMAR
        // (Req 9.2) — derived from the gateway's overall score so the
        // per-skill breakdown stays consistent with the headline grade.
        ...(requiresFeedbackDimensions(input.type) && {
          dimensions: buildLanguageFeedbackDimensions({
            type: input.type,
            text: studentText,
            baseScore: score,
          }),
        }),
        ...(highlights.length > 0 ? { highlights } : {}),
        usage: this.gatewayUsage(),
      };
    } catch (error) {
      this.logger.warn(
        `gradeModule: AI gateway call failed for module ${input.moduleId} (${input.type}): ${(error as Error).message}`,
      );
      // Surface the failure to AiGradingService — its loop will
      // record an ERROR audit row and continue with the next module.
      throw error;
    }
  }

  /**
   * Run the gateway's AI-text classifier. Identical wrapper to
   * `MockAiAdapter.detectAiText` — same return shape so the
   * `AiGradingService` consumer does not need to know which adapter
   * is wired.
   */
  async detectAiText(input: {
    text: string;
  }): Promise<AiTextDetectionResult> {
    const text = input.text ?? '';
    if (text.length === 0) {
      return {
        likelihood: 0,
        signals: ['empty-text'],
        usage: this.gatewayUsage(),
      };
    }

    const response = await this.gateway.detectAiText({ text });
    return {
      likelihood: clamp01(response.likelihood ?? 0),
      signals: response.signals ?? [],
      // The gateway's audit pipeline already wrote the AiCall row;
      // returning zeroed usage here prevents double-counting in the
      // AiGradingService.precheck audit pass.
      usage: this.gatewayUsage(),
    };
  }

  // ===================================================================
  // Internal helpers
  // ===================================================================

  /**
   * Build a single rubric string from the runtime's prompt-inputs.
   * The gateway template renders `{{rubric}}` verbatim, so a flat
   * `name (weight=N)` line per criterion is the most predictable
   * shape for the model. Empty rubric falls back to an empty string.
   */
  private buildRubricText(input: ModuleGradeInput): string {
    const criteria = input.promptInputs?.rubric ?? [];
    if (criteria.length === 0) return '';
    return criteria
      .map((c) => `- ${c.name} (weight=${c.weight})`)
      .join('\n');
  }

  /**
   * Pick the language hint for the gateway template.
   * Currently we don't carry per-module language metadata, so the
   * adapter defaults to `en`. The gateway template falls back when
   * the value is blank, so this is safe.
   */
  private detectLanguage(_input: ModuleGradeInput): 'uz' | 'ru' | 'en' {
    return 'en';
  }

  /**
   * Build a deterministic placeholder ModuleGradeResult so the
   * AiGradingService aggregator still sees a row for the module.
   */
  private placeholderResult(
    input: ModuleGradeInput,
    comment: string,
    score = 0,
  ): ModuleGradeResult {
    return {
      moduleId: input.moduleId,
      type: input.type,
      score: clamp01(score),
      comment,
      // Keep the structured shape for WRITING / GRAMMAR even when the
      // learner submitted nothing (Req 9.2) — the builder degrades to a
      // "no answer" message per dimension.
      ...(requiresFeedbackDimensions(input.type) && {
        dimensions: buildLanguageFeedbackDimensions({
          type: input.type,
          text: extractStudentText(input),
          baseScore: clamp01(score),
        }),
      }),
      usage: this.gatewayUsage(),
    };
  }

  /**
   * Usage row returned to `AiGradingService`. We zero the cost and
   * token counts because the AI gateway already wrote the upstream
   * `AiCall` audit row for this call — the homework-side audit row
   * is purely for the `submission_module` ref and should not double
   * count.
   */
  private gatewayUsage(): ModuleGradeResult['usage'] {
    return {
      modelName: 'ai-gateway',
      templateKey: 'grade-precheck.v1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 'OK',
    };
  }
}

// =====================================================================
// Free helpers
// =====================================================================

function extractStudentText(input: ModuleGradeInput): string {
  if (input.promptInputs?.studentText) return input.promptInputs.studentText;
  return extractText(input.answer);
}

function extractText(answer: unknown): string {
  if (typeof answer === 'string') return answer;
  if (answer && typeof answer === 'object') {
    const maybeText = (answer as Record<string, unknown>)['text'];
    if (typeof maybeText === 'string') return maybeText;
    const maybeValue = (answer as Record<string, unknown>)['value'];
    if (typeof maybeValue === 'string') return maybeValue;
  }
  return '';
}

/**
 * Resolve the userId for the gateway's per-user rate limiter.
 *
 * The gateway requires a non-empty UUID-ish string; the caller
 * (AiGradingService) does not currently pass it through, so we
 * fall back to a deterministic system key. This keeps the rate
 * limiter bucket separate from any real student so a high-volume
 * grading run never crowds out a student's own AI quota.
 */
function pickUserId(input: ModuleGradeInput): string {
  const optional = (input as ModuleGradeInput & { studentId?: string });
  if (typeof optional.studentId === 'string' && optional.studentId.length > 0) {
    return optional.studentId;
  }
  return `system:grading:${input.moduleId}`;
}

/**
 * Resolve the `submissionId` we hand to the gateway. The gateway uses
 * it as the audit `refId` — falling back to the module id keeps the
 * audit pointer meaningful even when the caller did not propagate it.
 */
function pickSubmissionRef(input: ModuleGradeInput): string {
  const optional = (input as ModuleGradeInput & { submissionId?: string });
  if (
    typeof optional.submissionId === 'string' &&
    optional.submissionId.length > 0
  ) {
    return optional.submissionId;
  }
  return `module:${input.moduleId}`;
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
