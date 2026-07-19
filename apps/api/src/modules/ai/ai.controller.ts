/**
 * AiController — HTTP surface for the AI Gateway (design.md "AI Gateway"
 * table).
 *
 * Routes (mounted under the global `api/v1` prefix):
 *   POST  /ai/tutor              tutor mode (STUDENT)
 *   POST  /ai/translate-word     reading helper (STUDENT)
 *   POST  /ai/translate-sentence reading helper (STUDENT)
 *   POST  /ai/grade/precheck     teacher trigger when not auto-run
 *   GET   /ai/usage              cost report (TEACHER, ADMIN)
 *
 * Authorization:
 *   - tutor / translate-* are STUDENT-scoped; ADMIN may call them for
 *     debugging.
 *   - grade/precheck is TEACHER + ADMIN.
 *   - usage is TEACHER (their own cost) + ADMIN.
 *
 * The controller stays thin — every business rule (rate limit, audit,
 * fallback, policy) lives in `AiGatewayService`. The controller's only
 * job is parsing the body, surfacing the typed result, and wiring the
 * `userId` from the JWT.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Optional, Post, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { AI_LIKELIHOOD_FLAG_THRESHOLD } from './ai.constants';
import { AI_GATEWAY } from './ai.types';
import type { AiGateway } from './ai.types';
import {
  AiUsageQueryDto,
  AiUsageQuerySchema,
  DetectAiTextRequestDto,
  DetectAiTextRequestSchema,
  PrecheckRequestDto,
  PrecheckRequestSchema,
  TranslateSentenceRequestDto,
  TranslateSentenceRequestSchema,
  TranslateWordRequestDto,
  TranslateWordRequestSchema,
  TutorRequestDto,
  TutorRequestSchema,
} from './dto';

@Controller('ai')
export class AiController {
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    @Optional() private readonly prisma?: PrismaClient,
  ) {}

  /**
   * `POST /ai/tutor` — tutor mode. The 60-call/10-minute quota
   * (Req 13.5) is enforced inside `AiGatewayService` against the JWT
   * `sub` claim, so we layer the @RateLimit decorator on the
   * controller as a coarse "1 call/sec/user" smoothing limit on top
   * of that.
   *
   * NOTE: The dedicated tutor-mode endpoints
   * (`/ai/tutor/explain`, `/translate`, `/example`) live on
   * `TutorController` (Task 20.2). This route is preserved for
   * back-compat — it exposes the legacy `intent` field instead of
   * dedicated routes.
   */
  @Post('tutor')
  @Roles('STUDENT', 'ADMIN')
  @RateLimit(60, '10m')
  @HttpCode(HttpStatus.OK)
  async tutor(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TutorRequestSchema)) body: TutorRequestDto,
  ) {
    return this.gateway.tutor({
      userId: user.sub,
      intent: body.intent,
      question: body.question,
      ...(body.contextText !== undefined && { contextText: body.contextText }),
      locale: body.locale,
      ...(body.submissionId !== undefined && { submissionId: body.submissionId }),
    });
  }

  @Post('translate-word')
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @RateLimit(120, '10m')
  @HttpCode(HttpStatus.OK)
  async translateWord(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TranslateWordRequestSchema))
    body: TranslateWordRequestDto,
  ) {
    return this.gateway.translateWord({
      userId: user.sub,
      word: body.word,
      contextSentence: body.contextSentence,
      locale: body.locale,
    });
  }

  @Post('translate-sentence')
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @RateLimit(120, '10m')
  @HttpCode(HttpStatus.OK)
  async translateSentence(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TranslateSentenceRequestSchema))
    body: TranslateSentenceRequestDto,
  ) {
    return this.gateway.translateSentence({
      userId: user.sub,
      sentence: body.sentence,
      locale: body.locale,
    });
  }

  @Post('grade/precheck')
  @Roles('TEACHER', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async precheck(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(PrecheckRequestSchema))
    body: PrecheckRequestDto,
  ) {
    return this.gateway.precheckWritingSubmission({
      userId: user.sub,
      submissionId: body.submissionId,
      text: body.text,
      ...(body.rubric !== undefined && { rubric: body.rubric }),
      ...(body.language !== undefined && { language: body.language }),
    });
  }

  /**
   * `POST /ai/detect-ai-text` (Task 20.3, Req 13.7, 13.8).
   *
   * Accessible to any authenticated role — STUDENT clients hit it from
   * the Reading widget for self-checks; TEACHER + ADMIN call it during
   * grading. The endpoint is a thin pass-through to
   * `AiGatewayService.detectAiText` which already enforces:
   *   - Per-user rate limit (60 calls / 10 min, Req 13.5)
   *   - AiCall audit row (Req 13.4)
   *   - Cost tracking
   *
   * Response shape mirrors the task spec:
   *   `{ likelihood: float (0..1), flagged: boolean }`
   * `flagged = likelihood >= AI_LIKELIHOOD_FLAG_THRESHOLD` (0.7).
   *
   * The endpoint never mutates a Submission row — flagging happens
   * inside `AiGradingService.precheck` when the call is made on behalf
   * of a graded submission. This route is the read-only "is this AI?"
   * surface used by the UI (and indirectly by the grading pipeline).
   */
  @Post('detect-ai-text')
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @RateLimit(60, '10m')
  @HttpCode(HttpStatus.OK)
  async detectAiText(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(DetectAiTextRequestSchema))
    body: DetectAiTextRequestDto,
  ) {
    const result = await this.gateway.detectAiText({
      userId: user.sub,
      text: body.text,
    });
    const flagged = result.likelihood >= AI_LIKELIHOOD_FLAG_THRESHOLD;
    return {
      likelihood: result.likelihood,
      flagged,
      signals: result.signals,
    };
  }

  /**
   * POST /ai/chat — General AI assistant for students and teachers.
   * Supports multi-turn conversation via `history` array.
   */
  @Post('chat')
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @RateLimit(60, '10m')
  @HttpCode(HttpStatus.OK)
  async chat(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      message: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      locale?: 'uz' | 'ru' | 'en';
      context?: string;
    },
  ) {
    return this.gateway.chat({
      userId: user.sub,
      role: user.role as 'STUDENT' | 'TEACHER' | 'ADMIN',
      message: body.message,
      history: body.history ?? [],
      locale: body.locale ?? 'uz',
      context: body.context,
    });
  }

  /**
   * POST /ai/generate-test — Generate quiz questions from lesson content.
   * Teacher provides content text, AI generates structured questions.
   */
  @Post('generate-test')
  @Roles('TEACHER', 'ADMIN')
  @RateLimit(20, '1h')
  @HttpCode(HttpStatus.OK)
  async generateTest(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      content: string;
      questionCount?: number;
      types?: Array<'mcq' | 'true_false' | 'short'>;
      difficulty?: 'easy' | 'medium' | 'hard';
      locale?: 'uz' | 'ru' | 'en';
      topic?: string;
    },
  ) {
    return this.gateway.generateTest({
      userId: user.sub,
      content: body.content,
      questionCount: body.questionCount ?? 5,
      types: body.types ?? ['mcq', 'true_false'],
      difficulty: body.difficulty ?? 'medium',
      locale: body.locale ?? 'uz',
      topic: body.topic,
    });
  }

  /**
   * `GET /ai/usage` — cost roll-up. TEACHER can see only their own
   * spend; ADMIN can pass `?userId=` to inspect anybody. Read-only,
   * served from the same Prisma client the gateway uses.
   */
  @Get('usage')
  @Roles('TEACHER', 'ADMIN')
  async usage(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(AiUsageQuerySchema)) query: AiUsageQueryDto,
  ) {
    if (!this.prisma) {
      return {
        totals: { calls: 0, costUsd: 0 },
        byIntent: [],
      };
    }
    const targetUserId =
      user.role === 'ADMIN' ? (query.userId ?? null) : user.sub;
    const whereClauses: Prisma.AiCallWhereInput = {
      ...(targetUserId ? { userId: targetUserId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [aggregate, byIntent] = await Promise.all([
      this.prisma.aiCall.aggregate({
        where: whereClauses,
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true, latencyMs: true },
      }),
      this.prisma.aiCall.groupBy({
        by: ['intent'],
        where: whereClauses,
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      }),
    ]);

    return {
      totals: {
        calls: aggregate._count._all,
        costUsd: Number(aggregate._sum.costUsd ?? 0),
        inputTokens: aggregate._sum.inputTokens ?? 0,
        outputTokens: aggregate._sum.outputTokens ?? 0,
        avgLatencyMs:
          aggregate._count._all > 0
            ? Math.round(
                (aggregate._sum.latencyMs ?? 0) / aggregate._count._all,
              )
            : 0,
      },
      byIntent: byIntent.map((row) => ({
        intent: row.intent,
        calls: row._count._all,
        costUsd: Number(row._sum.costUsd ?? 0),
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
      })),
    };
  }
}
