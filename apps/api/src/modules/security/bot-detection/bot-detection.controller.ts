import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
} from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { BehavioralService } from './behavioral.service';
import { FingerprintService } from './fingerprint.service';
import {
  BehaviorReportSchema,
  type BehaviorReportDto,
  FingerprintReportSchema,
  type FingerprintReportDto,
} from './dto';
import type { BotDetectionRequest } from './types';

/**
 * `BotDetectionController` — Task 27.4 (Req 27.6).
 *
 * Two collector endpoints used by the browser to feed the
 * bot-detection pipeline. Both are public (anonymous traffic must be
 * able to report a fingerprint before login) but bounded by the
 * platform-wide rate limiter and the global WAF — there's no path to
 * inflate Redis storage from these routes.
 *
 *   - `POST /api/v1/security/behavior/report` — accepts the
 *     per-session behavioural summary (mouse moves, keystrokes,
 *     dwell time, form completion latency). Returns the heuristic
 *     score so the client can react locally (e.g. show a captcha
 *     proactively when the score is high).
 *
 *   - `POST /api/v1/security/fingerprint/report` — accepts a device
 *     fingerprint payload. Returns the resulting anomaly snapshot
 *     so we can surface it on the trust-center / device-management
 *     UI in a future pass.
 *
 * The endpoints intentionally don't expose state mutation knobs:
 * they only let the client *report* signals, never *clear* them.
 */
@Controller('security')
export class BotDetectionController {
  constructor(
    private readonly behavioral: BehavioralService,
    private readonly fingerprints: FingerprintService,
  ) {}

  /**
   * Report a behavioural summary for the current session.
   * The endpoint is public — the bot detector needs signals before
   * the user authenticates.
   */
  @Public()
  @Post('behavior/report')
  @HttpCode(HttpStatus.OK)
  async reportBehavior(
    @Body(new ZodValidationPipe(BehaviorReportSchema))
    dto: BehaviorReportDto,
  ): Promise<{ ok: true; score: number; reasons: string[] }> {
    const { score, reasons } = await this.behavioral.report({
      sessionId: dto.sessionId,
      mouseMovements: dto.mouseMovements,
      keystrokes: dto.keystrokes,
      dwellTime: dto.dwellTime,
      formCompletionMs: dto.formCompletionMs,
      ...(dto.formId !== undefined ? { formId: dto.formId } : {}),
    });
    return { ok: true, score, reasons };
  }

  /**
   * Report a device fingerprint for the current session. Returns the
   * fingerprint hash and the current cardinality snapshot so callers
   * can react locally if the fingerprint is already flagged.
   */
  @Public()
  @Post('fingerprint/report')
  @HttpCode(HttpStatus.OK)
  async reportFingerprint(
    @Req() request: BotDetectionRequest,
    @Ip() requestIp: string,
    @Body(new ZodValidationPipe(FingerprintReportSchema))
    dto: FingerprintReportDto,
  ): Promise<{
    ok: true;
    fingerprintHash: string;
    distinctIdentities: number;
    distinctIps: number;
    suspicious: boolean;
  }> {
    const userId = (request.user?.sub ?? request.user?.id ?? null) || null;
    const ip = (requestIp ?? '').trim() || null;
    const result = await this.fingerprints.record(dto, { userId, ip });
    return {
      ok: true,
      fingerprintHash: result.fingerprintHash,
      distinctIdentities: result.distinctIdentities,
      distinctIps: result.distinctIps,
      suspicious: result.suspicious,
    };
  }
}
