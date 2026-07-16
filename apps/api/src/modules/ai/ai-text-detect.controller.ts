/**
 * AiTextDetectController — `POST /v1/ai/text-detect` (Task 20.3,
 * Req 13.7, 13.8).
 *
 * Surface area:
 *   POST /ai/text-detect — TEACHER + ADMIN only. Accepts a free-form
 *     text body (and optional language hint) and returns
 *     `{ likelihood, signals }`. The classifier output is computed by
 *     the AI gateway and cached for 24h by `AiTextDetectService` keyed
 *     on `sha256(text)`.
 *
 * Why a dedicated controller rather than reusing
 * `AiController.detectAiText`:
 *   - Task 20.3 calls for a TEACHER/ADMIN-only "is this AI?" endpoint
 *     that returns `{ likelihood, signals }`. The legacy
 *     `POST /v1/ai/detect-ai-text` route on `AiController` is
 *     STUDENT + TEACHER + ADMIN (it doubles as the student-side
 *     self-check) and returns `{ likelihood, flagged, signals }`. We
 *     keep both endpoints around so existing UI code keeps working;
 *     this controller adds the new role-restricted alias the spec
 *     calls out.
 *   - Routing through `AiTextDetectService` instead of the gateway
 *     directly gives us the 24h sha256 cache for free — every caller
 *     of the new endpoint shares the cache pool with the homework
 *     submit path and the legacy route.
 *
 * Authorization:
 *   Strictly TEACHER + ADMIN. Students hit
 *   `POST /v1/ai/detect-ai-text` (legacy route on AiController)
 *   instead. The auth-completeness invariant (Req 17.x) requires the
 *   role list to be exhaustive — we leave STUDENT off intentionally.
 *
 * Rate limit:
 *   60 calls / 10 min per teacher (matches the gateway-side
 *   per-user limit so the route doesn't become a back-channel that
 *   bypasses the global AI quota).
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { AiTextDetectService } from './ai-text-detect.service';

/**
 * Request body for `POST /v1/ai/text-detect`.
 *
 * `language` is accepted but currently advisory — the gateway prompt
 * template does not yet branch on locale. We capture it in the DTO so
 * future template upgrades can route a Russian essay to a
 * Russian-tuned classifier without breaking the public schema.
 */
export const TextDetectRequestSchema = z.object({
  text: z.string().min(1).max(40_000),
  language: z.enum(['uz', 'ru', 'en']).optional(),
});
export type TextDetectRequestDto = z.infer<typeof TextDetectRequestSchema>;

@Controller('ai/text-detect')
export class AiTextDetectController {
  constructor(private readonly service: AiTextDetectService) {}

  /**
   * `POST /v1/ai/text-detect` — classify a text body as AI- or
   * human-authored.
   *
   * Response shape (Task 20.3):
   *   `{ likelihood: 0..1, signals: string[] }`
   *
   * `flagged` is intentionally not returned — the threshold is policy
   * (Req 13.8 caps it at 0.75 for grading; the platform default is
   * 0.7 elsewhere). Callers that need a binary verdict apply their own
   * threshold against `likelihood`.
   */
  @Post()
  @Roles('TEACHER', 'ADMIN')
  @RateLimit(60, '10m')
  @HttpCode(HttpStatus.OK)
  async detect(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(TextDetectRequestSchema))
    body: TextDetectRequestDto,
  ): Promise<{ likelihood: number; signals: string[] }> {
    const result = await this.service.detect({
      userId: user.sub,
      text: body.text,
    });
    return {
      likelihood: result.likelihood,
      signals: result.signals,
    };
  }
}
