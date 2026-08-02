import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { HCaptchaService } from '../brute-force/hcaptcha.service';
import { BotDetectionService } from './bot-detection.service';
import { REQUIRE_BOT_CHECK_KEY } from './require-bot-check.decorator';
import type { BotDetectionRequest } from './types';

/**
 * `BotDetectionGuard` — Task 27.4 (Req 27.6).
 *
 * Wires `BotDetectionService` into the NestJS request pipeline.
 * Applied to handlers via the `@RequireBotCheck()` decorator (login,
 * register, password reset, payment) — leaving every other route
 * untouched so we don't pay the evaluation cost on hot read paths.
 *
 * On every guarded request:
 *
 *   1. Resolve the `BotEvaluation` via `BotDetectionService.evaluate`.
 *   2. `BLOCK` → throw `403 BOT_DETECTED`.
 *   3. `CHALLENGE` → look for an hCaptcha solution on the request:
 *        - `req.body.hCaptchaToken`
 *        - `X-HCaptcha-Token` header
 *      A valid solution lets the request proceed unblocked. A missing
 *      / failed solution throws `403 CAPTCHA_REQUIRED` (the
 *      `HCaptchaService.assertValid` envelope) and stamps
 *      `req.captchaRequired = true` so client code can render the
 *      challenge.
 *   4. `ALLOW` → pass straight through.
 *
 * The guard composes with `HCaptchaService` (Task 27.2). When
 * `HCaptchaService` is in dev-mode bypass (no `HCAPTCHA_SECRET`), a
 * CHALLENGE decision short-circuits to ALLOW — exactly the same
 * fail-open posture the brute-force flow uses.
 */
@Injectable()
export class BotDetectionGuard implements CanActivate {
  private readonly logger = new Logger(BotDetectionGuard.name);

  /** Header that may carry an hCaptcha solution out-of-band. */
  static readonly CAPTCHA_TOKEN_HEADER = 'x-hcaptcha-token';

  /** Error code surfaced to the client on a hard block. */
  static readonly BLOCK_ERROR_CODE = 'BOT_DETECTED';

  constructor(
    private readonly botDetection: BotDetectionService,
    @Optional() private readonly reflector?: Reflector,
    @Optional() private readonly hCaptcha?: HCaptchaService,
    @Optional() configService?: ConfigService,
  ) {
    const raw = configService?.get<boolean | string>('BOT_DETECTION_ENABLED');
    if (raw === undefined) {
      this.enabled = true;
    } else if (typeof raw === 'boolean') {
      this.enabled = raw;
    } else {
      this.enabled = String(raw).toLowerCase() !== 'false';
    }
    if (!this.enabled) {
      this.logger.warn(
        'BotDetectionGuard: BOT_DETECTION_ENABLED=false — every request will be allowed regardless of @RequireBotCheck()',
      );
    }
  }

  /**
   * Cached at construction time so the kill-switch is observable in
   * a single boot log line. `true` when the guard should evaluate
   * requests, `false` when it short-circuits to ALLOW.
   */
  private readonly enabled: boolean;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    // Kill-switch: an operator can disable the entire bot-detection
    // pipeline without redeploying — useful when a tuning regression
    // is producing false positives on production traffic.
    if (!this.enabled) return true;

    // Opt-in per-route — when the decorator is absent we let the
    // request through unchecked.
    if (!this.isGuarded(context)) return true;

    const request = context.switchToHttp().getRequest<BotDetectionRequest>();
    const evaluation = await this.botDetection.evaluate(request);

    if (evaluation.decision === 'BLOCK') {
      this.logger.warn({
        event: 'bot_detection.blocked',
        message: 'Request blocked by bot detector',
        score: evaluation.score,
        signals: evaluation.signals,
        method: request.method ?? 'GET',
        path: sanitisePath(request),
      });
      request.botBlockedReason = evaluation.signals.join(',');
      throw new HttpException(
        {
          code: BotDetectionGuard.BLOCK_ERROR_CODE,
          message: 'Request blocked — automated traffic detected',
          details: {
            score: evaluation.score,
            signals: evaluation.signals,
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (evaluation.decision === 'CHALLENGE') {
      // Surface the requirement so client UIs / downstream guards
      // can react (e.g. render the hCaptcha widget).
      request.captchaRequired = true;

      // When hCaptcha is wired AND the secret is set, demand a valid
      // solution before letting the request continue. When the secret
      // isn't set we fall through (dev-mode bypass) — matches the
      // posture of `BruteForceService` + `HCaptchaService`.
      if (this.hCaptcha && this.hCaptcha.isEnabled()) {
        const token = this.extractCaptchaToken(request);
        const ip = extractClientIp(request);
        await this.hCaptcha.assertValid(token, ip);
      } else if (this.hCaptcha) {
        // Dev-mode bypass — log once at warn so this is never silent.
        this.logger.warn({
          event: 'bot_detection.challenge.dev_bypass',
          message: 'CHALLENGE decision bypassed: HCAPTCHA_SECRET unset',
          score: evaluation.score,
          signals: evaluation.signals,
        });
      } else {
        // No HCaptchaService wired at all — log and let through. The
        // service is registered alongside this guard so this branch
        // is normally unreachable in production.
        this.logger.warn({
          event: 'bot_detection.challenge.no_captcha',
          message:
            'CHALLENGE decision but HCaptchaService is not available',
          score: evaluation.score,
          signals: evaluation.signals,
        });
      }
    }

    return true;
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * `true` when the route opts-in via `@RequireBotCheck()`. Falls
   * back to a global "opt-in only" stance when no Reflector is
   * available (e.g. in the unit tests that construct the guard
   * directly with `null`).
   */
  private isGuarded(context: ExecutionContext): boolean {
    if (!this.reflector) return false;
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(REQUIRE_BOT_CHECK_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }

  private extractCaptchaToken(
    request: BotDetectionRequest,
  ): string | undefined {
    const headerToken = pickString(
      request.headers?.[BotDetectionGuard.CAPTCHA_TOKEN_HEADER],
    );
    if (headerToken) return headerToken;

    const body = request.body;
    if (body && typeof body === 'object') {
      const fromBody = (body as Record<string, unknown>)['hCaptchaToken'];
      if (typeof fromBody === 'string' && fromBody.trim()) {
        return fromBody.trim();
      }
    }
    return undefined;
  }
}

// =====================================================================
// Module-private helpers
// =====================================================================

function pickString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = String(value[0]).trim();
    return first.length > 0 ? first : undefined;
  }
  return undefined;
}

function extractClientIp(request: BotDetectionRequest): string {
  // `request.ip` first — the spoofable `x-forwarded-for` header is a
  // fallback only. See `waf.middleware.ts` for the full rationale.
  const direct =
    request.ip ??
    request.connection?.remoteAddress ??
    request.socket?.remoteAddress;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return 'unknown';
}

function sanitisePath(request: BotDetectionRequest): string {
  const raw = request.originalUrl ?? request.url ?? request.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
