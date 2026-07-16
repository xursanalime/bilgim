/**
 * TutorController — `/v1/ai/tutor/{explain,translate,example}` HTTP
 * surface for AI Tutor mode (Task 20.2, Req 13.1, 13.2, 13.3, 13.6).
 *
 * Why split from `AiController`:
 *   The legacy `POST /v1/ai/tutor` route is a back-compat surface for
 *   clients that pre-date the per-intent endpoints. The dedicated
 *   tutor-mode routes get their own controller so the policy guard,
 *   rate limits, and request shape live next to each other and the
 *   spec lookup is one file away. Keeping `AiController` for the
 *   non-tutor surfaces (translate-word, grade/precheck, usage) keeps
 *   each file's responsibility readable.
 *
 * Authorization:
 *   - All three routes are STUDENT + TEACHER. ADMIN is explicitly NOT
 *     in the role list — the auth-completeness invariant (Req 17.x)
 *     allows only roles a real user actually plays, and admins use
 *     `/ai/usage` for oversight rather than calling the tutor.
 *
 * Rate limits (per the task brief):
 *   - explain  → 30 calls / 1h per user
 *   - translate → 100 calls / 1h per user
 *   - example  → 30 calls / 1h per user
 *   The global `AI_RATE_LIMIT_*` quota (60 calls / 10m) still applies
 *   inside the gateway dispatcher, layered under these route-specific
 *   limits.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  TutorExampleRequestDto,
  TutorExampleRequestSchema,
  TutorExplainRequestDto,
  TutorExplainRequestSchema,
  TutorTranslateRequestDto,
  TutorTranslateRequestSchema,
} from './dto';
import {
  AiTutorPolicyGuard,
  type AiTutorPolicyContext,
} from './policy/ai-tutor.policy.guard';
import { TutorService } from './tutor.service';

@Controller('ai/tutor')
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  /**
   * `POST /v1/ai/tutor/explain` — Socratic tutor that explains
   * concepts. The `AiTutorPolicyGuard` strips any submission text the
   * client tried to embed in the prompt; the service's pre-flight
   * refusal blocks "give me the answer" prompts before they reach the
   * LLM.
   */
  @Post('explain')
  @Roles('STUDENT', 'TEACHER')
  @RateLimit(30, '1h')
  @UseGuards(AiTutorPolicyGuard)
  @HttpCode(HttpStatus.OK)
  async explain(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request & { aiTutorPolicy?: AiTutorPolicyContext },
    @Body(new ZodValidationPipe(TutorExplainRequestSchema))
    body: TutorExplainRequestDto,
  ) {
    return this.tutor.explain({
      userId: user.sub,
      question: body.question,
      ...(body.contextText !== undefined && { contextText: body.contextText }),
      locale: body.locale,
      ...(body.submissionId !== undefined && {
        submissionId: body.submissionId,
      }),
      ...(body.assignmentId !== undefined && {
        assignmentId: body.assignmentId,
      }),
      ...(body.conversationId !== undefined && {
        conversationId: body.conversationId,
      }),
      ...(request?.aiTutorPolicy?.submissionText
        ? { submissionText: request.aiTutorPolicy.submissionText }
        : {}),
    });
  }

  /**
   * `POST /v1/ai/tutor/translate` — translation helper between
   * uz / ru / en. The gateway caches successful responses in Redis
   * keyed on `(text, source, target)` for round-trip safety
   * (Property 15 hook for task 18.5).
   */
  @Post('translate')
  @Roles('STUDENT', 'TEACHER')
  @RateLimit(100, '1h')
  @UseGuards(AiTutorPolicyGuard)
  @HttpCode(HttpStatus.OK)
  async translate(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request & { aiTutorPolicy?: AiTutorPolicyContext },
    @Body(new ZodValidationPipe(TutorTranslateRequestSchema))
    body: TutorTranslateRequestDto,
  ) {
    return this.tutor.translate({
      userId: user.sub,
      text: body.text,
      sourceLocale: body.sourceLocale,
      targetLocale: body.targetLocale,
      ...(body.submissionId !== undefined && {
        submissionId: body.submissionId,
      }),
      ...(body.assignmentId !== undefined && {
        assignmentId: body.assignmentId,
      }),
      ...(request?.aiTutorPolicy?.submissionText
        ? { submissionText: request.aiTutorPolicy.submissionText }
        : {}),
    });
  }

  /**
   * `POST /v1/ai/tutor/example` — generate an analogous worked
   * example. The model is instructed to use a different topic /
   * different numbers than the student's active task; the
   * similarity post-filter rewrites the reply if it accidentally
   * drifts back onto the student's submission.
   */
  @Post('example')
  @Roles('STUDENT', 'TEACHER')
  @RateLimit(30, '1h')
  @UseGuards(AiTutorPolicyGuard)
  @HttpCode(HttpStatus.OK)
  async example(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request & { aiTutorPolicy?: AiTutorPolicyContext },
    @Body(new ZodValidationPipe(TutorExampleRequestSchema))
    body: TutorExampleRequestDto,
  ) {
    return this.tutor.example({
      userId: user.sub,
      topic: body.question,
      ...(body.contextText !== undefined && { contextText: body.contextText }),
      locale: body.locale,
      ...(body.submissionId !== undefined && {
        submissionId: body.submissionId,
      }),
      ...(body.assignmentId !== undefined && {
        assignmentId: body.assignmentId,
      }),
      ...(request?.aiTutorPolicy?.submissionText
        ? { submissionText: request.aiTutorPolicy.submissionText }
        : {}),
    });
  }
}
