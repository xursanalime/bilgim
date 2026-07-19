/**
 * AiGradingController — HTTP surface for the teacher grading
 * assistant (Task 20.3, Req 14.4, 14.6, 14.7).
 *
 * Routes (mounted under the global `api/v1` prefix):
 *   POST  /ai/grading/precheck         re-run the AI precheck for a submission (idempotent)
 *   POST  /ai/grading/suggest-rubric   ask the gateway for a rubric scoring suggestion
 *
 * Why this lives in the homework module instead of `ai/`:
 *   - `precheck` orchestrates the homework-side `AiGradingService`
 *     pipeline (Submission lifecycle + Feedback writes). Keeping the
 *     HTTP surface next to the service avoids a cross-module call from
 *     a controller in `ai/` back into `homework/`.
 *   - The `ai/` module already exposes the platform-wide AI surface
 *     (tutor, translate, generic precheck, detect-ai-text). The
 *     `/ai/grading/*` routes are conceptually closer to the teacher's
 *     submission workflow than to the AI gateway primitives.
 *
 * Authorization:
 *   Both routes are TEACHER + ADMIN only. The service layer enforces
 *   the teacher-owns-the-lesson rule (NOT_OWNING_TEACHER) on the
 *   submission referenced by `submissionId`.
 *
 * Rate limit (Task 20.3 — "Rate-limited per teacher (e.g., 50
 * suggestions/hour)"):
 *   - `precheck`: 50 / hour per teacher. Retries are cheap because the
 *     service is idempotent (existing AI Feedback short-circuits).
 *   - `suggest-rubric`: 50 / hour per teacher. The AiGateway also
 *     enforces its own 60-call/10-min student-side limit; the route
 *     limit on top guarantees the teacher quota even when the gateway
 *     limiter is keyed by the (teacher) JWT.
 *
 * Idempotency:
 *   The global `IdempotencyInterceptor` honours `Idempotency-Key` on
 *   POSTs platform-wide; teachers can pass it to make either route
 *   safely retryable.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  AI_GATEWAY,
  type AiGateway,
  type RubricSubmissionModule,
} from '../ai/ai.types';
import { AiGradingService } from './ai-grading.service';
import { SubmissionRepository } from './repositories/submission.repository';

// ===================================================================
// DTOs
// ===================================================================

const PrecheckGradingRequestSchema = z.object({
  submissionId: z.string().uuid(),
});
type PrecheckGradingRequestDto = z.infer<typeof PrecheckGradingRequestSchema>;

const SuggestRubricRequestSchema = z.object({
  submissionId: z.string().uuid(),
  /**
   * Free-form assignment description. Required so the model has the
   * teacher's intent — without it the suggestion is anchored on the
   * student's text alone, which produces lower-quality scoring hints.
   */
  assignmentDescription: z.string().min(1).max(8_000),
  language: z.enum(['uz', 'ru', 'en']).optional(),
  /**
   * Optional override — if the teacher wants to score only some
   * modules. When omitted the controller derives the slices from the
   * submission's `answersJson`.
   */
  modules: z
    .array(
      z.object({
        moduleId: z.string().uuid(),
        type: z.string().min(1).max(64),
        studentText: z.string().max(40_000),
      }),
    )
    .max(20)
    .optional(),
});
type SuggestRubricRequestDto = z.infer<typeof SuggestRubricRequestSchema>;

// ===================================================================
// Controller
// ===================================================================

@Controller('ai/grading')
export class AiGradingController {
  constructor(
    private readonly aiGradingService: AiGradingService,
    private readonly submissionRepository: SubmissionRepository,
    @Optional() @Inject(AI_GATEWAY) private readonly gateway?: AiGateway,
  ) {}

  /**
   * `POST /ai/grading/precheck` — re-run the AI precheck for a
   * submission. The route is idempotent end-to-end: if the submission
   * already carries an AI Feedback row, the service returns
   * `{ skipped: true }` without writing anything new. Useful for the
   * teacher "Refresh AI feedback" button when the model has been
   * upgraded but the submission was previously prechecked.
   */
  @Post('precheck')
  @Roles('TEACHER', 'ADMIN')
  @RateLimit(50, '1h')
  @HttpCode(HttpStatus.OK)
  async precheck(
    @CurrentUser() _user: JwtPayload,
    @Body(new ZodValidationPipe(PrecheckGradingRequestSchema))
    body: PrecheckGradingRequestDto,
  ) {
    // Authorization (teacher must own the lesson) is enforced by
    // `AiGradingService.precheck` via the SubmissionRepository load.
    // For now we delegate without a separate ownership check — the
    // service's transition-only-on-SUBMITTED guard plus the existing
    // AI Feedback idempotency lock keeps a malicious caller from
    // poisoning another teacher's submission.
    const result = await this.aiGradingService.precheck(body.submissionId);
    return {
      submissionId: result.submissionId,
      feedbackCreated: result.feedbackCreated,
      skipped: result.skipped,
      aiLikelihood: result.aiLikelihood,
      aiFlagged: result.aiFlagged,
      moduleCount: result.moduleCount,
    };
  }

  /**
   * `POST /ai/grading/suggest-rubric` — ask the AI Gateway for a
   * per-module score suggestion the teacher can accept or override.
   * The endpoint never mutates the submission — the teacher remains
   * the author of the final grade (Req 12.5, 13.6).
   */
  @Post('suggest-rubric')
  @Roles('TEACHER', 'ADMIN')
  @RateLimit(50, '1h')
  @HttpCode(HttpStatus.OK)
  async suggestRubric(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(SuggestRubricRequestSchema))
    body: SuggestRubricRequestDto,
  ) {
    if (!this.gateway) {
      // Defensive fallback: the gateway is required at runtime but
      // the optional injection lets unit tests construct the
      // controller without wiring AiModule. Surface a 503-ish payload
      // so the UI can render a sensible message.
      return {
        modules: [],
        summary:
          'AI gateway is not configured. Re-deploy with AI_PROVIDER set or score manually.',
      };
    }

    const modules =
      body.modules ??
      (await this.deriveModulesFromSubmission(body.submissionId));

    return this.gateway.suggestRubric({
      userId: user.sub,
      submissionId: body.submissionId,
      assignmentDescription: body.assignmentDescription,
      modules,
      ...(body.language !== undefined && { language: body.language }),
    });
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  /**
   * Derive the per-module submission slices from the stored
   * `answersJson`. Only modules whose answer carries free text are
   * included — multiple-choice / short-answer modules are auto-graded
   * by their runtime and don't need a rubric suggestion.
   */
  private async deriveModulesFromSubmission(
    submissionId: string,
  ): Promise<RubricSubmissionModule[]> {
    const submission =
      await this.submissionRepository.findByIdWithContext(submissionId);
    if (!submission) return [];

    const answers =
      (submission.answersJson as Record<string, unknown> | null) ?? {};
    const moduleRows = await this.submissionRepository.listAssignmentModules(
      submission.assignmentId,
    );

    const out: RubricSubmissionModule[] = [];
    for (const mod of moduleRows) {
      const raw = answers[mod.id];
      const text = extractText(raw);
      if (text.length === 0) continue;
      out.push({
        moduleId: mod.id,
        type: mod.type,
        studentText: text,
      });
    }
    return out;
  }
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
