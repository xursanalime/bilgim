import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { HCaptchaService } from '../brute-force/hcaptcha.service';
import { BotDetectionService } from './bot-detection.service';
import { BotDetectionGuard } from './bot-detection.guard';
import { REQUIRE_BOT_CHECK_KEY } from './require-bot-check.decorator';
import type {
  BotDetectionRequest,
  BotEvaluation,
} from './types';

/**
 * Unit tests for `BotDetectionGuard` (Task 27.4, Req 27.6).
 *
 * Coverage:
 *   - Routes without `@RequireBotCheck()` pass straight through.
 *   - BLOCK decision throws `403 BOT_DETECTED`.
 *   - CHALLENGE + valid hCaptcha solution → request proceeds.
 *   - CHALLENGE + missing solution → `403 CAPTCHA_REQUIRED`.
 *   - CHALLENGE with hCaptcha disabled (dev bypass) → request proceeds.
 *   - ALLOW decision passes through without setting `captchaRequired`.
 */

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function buildContext({
  request,
  guarded = true,
}: {
  request: Partial<BotDetectionRequest>;
  guarded?: boolean;
}): ExecutionContext {
  const reflector = {
    getAllAndOverride: jest.fn().mockImplementation((key: string) => {
      if (key === REQUIRE_BOT_CHECK_KEY) return guarded;
      return undefined;
    }),
  };
  // Stash the reflector on the context so tests can inspect calls.
  const ctx = {
    getType: () => 'http' as const,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => ({}) as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => function () {} as any,
    getClass: () => class {} as any,
  } as unknown as ExecutionContext;
  // Attach reflector for assertions in tests that care.
  (ctx as unknown as { _reflector: typeof reflector })._reflector = reflector;
  return ctx;
}

function buildBotService(evaluation: BotEvaluation): BotDetectionService {
  return {
    evaluate: jest.fn().mockResolvedValue(evaluation),
  } as unknown as BotDetectionService;
}

function buildReflector(guarded: boolean): Reflector {
  return {
    getAllAndOverride: jest.fn().mockImplementation((key: string) => {
      if (key === REQUIRE_BOT_CHECK_KEY) return guarded;
      return undefined;
    }),
  } as unknown as Reflector;
}

function buildHCaptcha(opts: {
  enabled?: boolean;
  shouldFail?: boolean;
}): HCaptchaService {
  return {
    isEnabled: jest.fn().mockReturnValue(opts.enabled ?? false),
    assertValid: jest
      .fn()
      .mockImplementation(async (token?: string) => {
        if (!opts.shouldFail) return undefined;
        throw new HttpException(
          {
            code: HCaptchaService.ERROR_CODE,
            message: 'A valid hCaptcha solution is required to continue.',
            details: { errorCodes: ['missing-input-response'] },
          },
          HttpStatus.FORBIDDEN,
        );
      }),
  } as unknown as HCaptchaService;
}

// =====================================================================
// Tests
// =====================================================================

describe('BotDetectionGuard — opt-in routing', () => {
  it('passes the request through when no `@RequireBotCheck()` is set', async () => {
    const botService = buildBotService({
      score: 0.99,
      signals: ['ua.known_bot'],
      decision: 'BLOCK',
    });
    const guard = new BotDetectionGuard(
      botService,
      buildReflector(false),
    );

    const ctx = buildContext({ request: {}, guarded: false });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(botService.evaluate).not.toHaveBeenCalled();
  });

  it('skips evaluation for non-HTTP transports', async () => {
    const botService = buildBotService({
      score: 0.99,
      signals: ['ua.known_bot'],
      decision: 'BLOCK',
    });
    const guard = new BotDetectionGuard(
      botService,
      buildReflector(true),
    );

    const wsCtx = {
      getType: () => 'ws' as const,
      switchToHttp: () => {
        throw new Error('not http');
      },
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(wsCtx)).resolves.toBe(true);
    expect(botService.evaluate).not.toHaveBeenCalled();
  });
});

describe('BotDetectionGuard — BLOCK decision', () => {
  it('throws 403 BOT_DETECTED when the bot service returns BLOCK', async () => {
    const evaluation: BotEvaluation = {
      score: 0.95,
      signals: ['ua.known_bot', 'timing.burst'],
      decision: 'BLOCK',
    };
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
    );

    const ctx = buildContext({ request: { headers: {} } });
    try {
      await guard.canActivate(ctx);
      fail('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('BOT_DETECTED');
      const details = body['details'] as Record<string, unknown>;
      expect(details['signals']).toEqual(evaluation.signals);
    }
  });

  it('stamps `req.botBlockedReason` with the joined signal list', async () => {
    const evaluation: BotEvaluation = {
      score: 0.95,
      signals: ['ua.known_bot', 'timing.burst'],
      decision: 'BLOCK',
    };
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
    );
    const request: BotDetectionRequest = { headers: {} };
    const ctx = buildContext({ request });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(request.botBlockedReason).toBe('ua.known_bot,timing.burst');
  });
});

describe('BotDetectionGuard — CHALLENGE decision (hCaptcha composition)', () => {
  it('passes through and sets `captchaRequired` when hCaptcha verification succeeds', async () => {
    const evaluation: BotEvaluation = {
      score: 0.6,
      signals: ['ua.headless'],
      decision: 'CHALLENGE',
    };
    const hCaptcha = buildHCaptcha({ enabled: true, shouldFail: false });
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
      hCaptcha,
    );

    const request: BotDetectionRequest = {
      headers: { 'x-hcaptcha-token': 'good-token' },
      ip: '203.0.113.10',
    };
    const ctx = buildContext({ request });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(hCaptcha.assertValid).toHaveBeenCalledWith(
      'good-token',
      '203.0.113.10',
    );
    expect(request.captchaRequired).toBe(true);
  });

  it('throws CAPTCHA_REQUIRED when hCaptcha rejects the solution', async () => {
    const evaluation: BotEvaluation = {
      score: 0.6,
      signals: ['ua.headless'],
      decision: 'CHALLENGE',
    };
    const hCaptcha = buildHCaptcha({ enabled: true, shouldFail: true });
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
      hCaptcha,
    );

    const request: BotDetectionRequest = { headers: {} };
    const ctx = buildContext({ request });

    try {
      await guard.canActivate(ctx);
      fail('expected canActivate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('CAPTCHA_REQUIRED');
    }
    expect(request.captchaRequired).toBe(true);
  });

  it('falls back to dev-mode bypass when HCaptchaService is disabled', async () => {
    const evaluation: BotEvaluation = {
      score: 0.6,
      signals: ['ua.headless'],
      decision: 'CHALLENGE',
    };
    const hCaptcha = buildHCaptcha({ enabled: false });
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
      hCaptcha,
    );

    const request: BotDetectionRequest = { headers: {} };
    const ctx = buildContext({ request });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(hCaptcha.assertValid).not.toHaveBeenCalled();
    expect(request.captchaRequired).toBe(true);
  });

  it('reads the captcha token from the request body when no header is present', async () => {
    const evaluation: BotEvaluation = {
      score: 0.6,
      signals: ['ua.headless'],
      decision: 'CHALLENGE',
    };
    const hCaptcha = buildHCaptcha({ enabled: true, shouldFail: false });
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
      hCaptcha,
    );

    const request: BotDetectionRequest = {
      headers: {},
      body: { hCaptchaToken: 'body-token' },
      ip: '203.0.113.20',
    };
    const ctx = buildContext({ request });

    await guard.canActivate(ctx);
    expect(hCaptcha.assertValid).toHaveBeenCalledWith(
      'body-token',
      '203.0.113.20',
    );
  });
});

describe('BotDetectionGuard — ALLOW decision', () => {
  it('passes through without setting `captchaRequired`', async () => {
    const evaluation: BotEvaluation = {
      score: 0.1,
      signals: [],
      decision: 'ALLOW',
    };
    const hCaptcha = buildHCaptcha({ enabled: true });
    const guard = new BotDetectionGuard(
      buildBotService(evaluation),
      buildReflector(true),
      hCaptcha,
    );

    const request: BotDetectionRequest = { headers: {} };
    const ctx = buildContext({ request });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(hCaptcha.assertValid).not.toHaveBeenCalled();
    expect(request.captchaRequired).toBeUndefined();
  });
});

// =====================================================================
// Kill-switch (BOT_DETECTION_ENABLED=false)
// =====================================================================

describe('BotDetectionGuard — kill-switch', () => {
  function buildConfigService(values: Record<string, unknown>) {
    return {
      get: jest.fn().mockImplementation((key: string) => values[key]),
    };
  }

  it('short-circuits to ALLOW when BOT_DETECTION_ENABLED=false even on a BLOCK decision', async () => {
    const botService = buildBotService({
      score: 0.99,
      signals: ['ua.known_bot'],
      decision: 'BLOCK',
    });
    const config = buildConfigService({ BOT_DETECTION_ENABLED: false });
    const guard = new BotDetectionGuard(
      botService,
      buildReflector(true),
      buildHCaptcha({ enabled: true }),
      config as any,
    );

    const ctx = buildContext({ request: { headers: {} } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(botService.evaluate).not.toHaveBeenCalled();
  });

  it('honours the string form "false" of BOT_DETECTION_ENABLED', async () => {
    const botService = buildBotService({
      score: 0.99,
      signals: ['ua.known_bot'],
      decision: 'BLOCK',
    });
    const config = buildConfigService({ BOT_DETECTION_ENABLED: 'false' });
    const guard = new BotDetectionGuard(
      botService,
      buildReflector(true),
      buildHCaptcha({ enabled: true }),
      config as any,
    );

    const ctx = buildContext({ request: { headers: {} } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(botService.evaluate).not.toHaveBeenCalled();
  });

  it('keeps the guard active when BOT_DETECTION_ENABLED is true / undefined', async () => {
    const botService = buildBotService({
      score: 0.99,
      signals: ['ua.known_bot'],
      decision: 'BLOCK',
    });
    const guard = new BotDetectionGuard(
      botService,
      buildReflector(true),
      buildHCaptcha({ enabled: true }),
      buildConfigService({ BOT_DETECTION_ENABLED: true }) as any,
    );

    const ctx = buildContext({ request: { headers: {} } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(botService.evaluate).toHaveBeenCalled();
  });
});
