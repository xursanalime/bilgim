import { RedisService } from '../../../infra/redis/redis.service';
import { BehavioralService } from './behavioral.service';
import { BotDetectionService } from './bot-detection.service';
import { FingerprintService } from './fingerprint.service';
import type { BotDetectionRequest } from './types';
import type { ConfigService } from '@nestjs/config';

/**
 * Unit tests for `BotDetectionService` (Task 27.4, Req 27.6).
 *
 * Coverage:
 *   - User-Agent classification: `sqlmap` → BLOCK, modern Chrome → ALLOW.
 *   - Request timing burst (≥10 reqs in the 1s window) → strong signal.
 *   - Header anomaly detection (missing `Accept-Language`,
 *     `Accept-Encoding`, browser UA without `Sec-Fetch-*`).
 *   - Fingerprint anomaly bridges through `FingerprintService.check`.
 *   - WAF challenge marker contributes weight.
 *   - Behavioural summary fold-in via `BehavioralService.lookup`.
 *   - Decision thresholds: `>= 0.85 BLOCK`, `0.5–0.85 CHALLENGE`,
 *     `< 0.5 ALLOW`.
 */

// ---------------------------------------------------------------------
// Fake Redis — only the surface `BotDetectionService` calls.
// ---------------------------------------------------------------------

class FakeRedis {
  private kv = new Map<string, { value: string; expiresAt: number | null }>();
  private offsetMs = 0;

  private now(): number {
    return Date.now() + this.offsetMs;
  }

  private purge(): void {
    const t = this.now();
    for (const [k, v] of this.kv) {
      if (v.expiresAt !== null && v.expiresAt <= t) this.kv.delete(k);
    }
  }

  /** Fast-forward the fake clock (seconds). */
  tickSeconds(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }

  async incr(key: string): Promise<number> {
    this.purge();
    const cur = this.kv.get(key);
    const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
    this.kv.set(key, {
      value: String(next),
      expiresAt: cur?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, ttl: number): Promise<void> {
    const cur = this.kv.get(key);
    if (cur) cur.expiresAt = this.now() + ttl * 1000;
  }

  // The behavioural service uses these — keep them around so tests
  // that flex behavioural composition can lean on the same fake.
  async get(key: string): Promise<string | null> {
    this.purge();
    return this.kv.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt: ttl !== undefined ? this.now() + ttl * 1000 : null,
    });
  }
}

function asRedis(fake: FakeRedis): RedisService {
  return fake as unknown as RedisService;
}

// ---------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------

function modernChromeHeaders(): Record<string, string> {
  return {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
  };
}

function makeRequest(
  overrides: Partial<BotDetectionRequest> = {},
): BotDetectionRequest {
  return {
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...modernChromeHeaders() },
    ip: '203.0.113.10',
    body: {},
    ...overrides,
  };
}

// =====================================================================
// User-Agent classification
// =====================================================================

describe('BotDetectionService — User-Agent classification', () => {
  it('flags a `sqlmap` UA as known_bot and BLOCKs the request', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          ...modernChromeHeaders(),
          'user-agent': 'sqlmap/1.7.2#stable (https://sqlmap.org)',
        },
      }),
    );

    expect(evaluation.signals).toContain('ua.known_bot');
    expect(evaluation.score).toBeGreaterThanOrEqual(
      BotDetectionService.BLOCK_THRESHOLD,
    );
    expect(evaluation.decision).toBe('BLOCK');
  });

  it('classifies HeadlessChrome as a moderate signal (CHALLENGE band, not BLOCK)', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          ...modernChromeHeaders(),
          'user-agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
        },
      }),
    );

    expect(evaluation.signals).toContain('ua.headless');
    expect(evaluation.decision).toBe('CHALLENGE');
    expect(evaluation.score).toBeLessThan(
      BotDetectionService.BLOCK_THRESHOLD,
    );
  });

  it('treats a missing User-Agent as the `ua.missing` signal', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: { ...modernChromeHeaders(), 'user-agent': '' },
      }),
    );

    expect(evaluation.signals).toContain('ua.missing');
  });

  it('lets a modern Chrome desktop UA through as ALLOW (no signals)', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(makeRequest());

    expect(evaluation.signals).not.toContain('ua.known_bot');
    expect(evaluation.signals).not.toContain('ua.headless');
    expect(evaluation.signals).not.toContain('ua.missing');
    expect(evaluation.decision).toBe('ALLOW');
    expect(evaluation.score).toBeLessThan(
      BotDetectionService.CHALLENGE_THRESHOLD,
    );
  });
});

// =====================================================================
// Request timing
// =====================================================================

describe('BotDetectionService — request timing', () => {
  it('fires `timing.burst` when more than 10 reqs land in the 1s window', async () => {
    const fake = new FakeRedis();
    const service = new BotDetectionService(asRedis(fake));

    let lastEvaluation: Awaited<ReturnType<BotDetectionService['evaluate']>>;
    for (let i = 0; i < 11; i++) {
      // eslint-disable-next-line no-await-in-loop
      lastEvaluation = await service.evaluate(makeRequest());
    }

    expect(lastEvaluation!.signals).toContain('timing.burst');
    // burst (0.5) on its own keeps us in the CHALLENGE band, not BLOCK.
    expect(lastEvaluation!.decision).toBe('CHALLENGE');
  });

  it('does not flip the burst signal at 10 requests (boundary check)', async () => {
    const fake = new FakeRedis();
    const service = new BotDetectionService(asRedis(fake));

    let lastEvaluation: Awaited<ReturnType<BotDetectionService['evaluate']>>;
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      lastEvaluation = await service.evaluate(makeRequest());
    }

    expect(lastEvaluation!.signals).not.toContain('timing.burst');
  });

  it('lets the rate counter reset after the 1s window expires', async () => {
    const fake = new FakeRedis();
    const service = new BotDetectionService(asRedis(fake));

    for (let i = 0; i < 11; i++) {
      // eslint-disable-next-line no-await-in-loop
      await service.evaluate(makeRequest());
    }

    fake.tickSeconds(BotDetectionService.RATE_WINDOW_SEC + 1);

    const evaluation = await service.evaluate(makeRequest());
    expect(evaluation.signals).not.toContain('timing.burst');
  });

  it('still produces a result when Redis is unavailable (fail-open)', async () => {
    const broken: Pick<RedisService, 'incr' | 'expire'> = {
      incr: jest.fn().mockRejectedValue(new Error('redis down')),
      expire: jest.fn(),
    };
    const service = new BotDetectionService(broken as unknown as RedisService);

    const evaluation = await service.evaluate(makeRequest());
    expect(evaluation.signals).not.toContain('timing.burst');
    expect(evaluation.decision).toBe('ALLOW');
  });
});

// =====================================================================
// Header anomalies
// =====================================================================

describe('BotDetectionService — header anomalies', () => {
  it('flags missing Accept-Language and Accept-Encoding headers', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          'user-agent': 'curl/8.4.0',
        },
      }),
    );

    expect(evaluation.signals).toContain(
      'headers.missing_accept_language',
    );
    expect(evaluation.signals).toContain(
      'headers.missing_accept_encoding',
    );
  });

  it('flags a browser-claiming UA missing both Sec-Fetch-* metadata headers', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'accept-language': 'en',
          'accept-encoding': 'gzip',
        },
      }),
    );

    expect(evaluation.signals).toContain('headers.missing_sec_fetch');
  });

  it('does not flag Sec-Fetch when the UA is non-browser (e.g. curl)', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          'user-agent': 'curl/8.4.0',
          'accept-language': 'en',
          'accept-encoding': 'gzip',
        },
      }),
    );

    expect(evaluation.signals).not.toContain('headers.missing_sec_fetch');
  });
});

// =====================================================================
// Fingerprint anomaly bridge
// =====================================================================

describe('BotDetectionService — fingerprint anomaly bridge', () => {
  function buildFingerprintsStub(suspicious: boolean): FingerprintService {
    return {
      check: jest.fn().mockResolvedValue({
        fingerprintHash: 'hash',
        distinctIdentities: suspicious ? 7 : 1,
        distinctIps: suspicious ? 7 : 1,
        suspicious,
      }),
    } as unknown as FingerprintService;
  }

  it('folds in `fingerprint.anomaly` when the fingerprint service flags the hash', async () => {
    const fingerprints = buildFingerprintsStub(true);
    const service = new BotDetectionService(undefined, fingerprints);

    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          ...modernChromeHeaders(),
          'x-device-fingerprint': 'abc123',
        },
      }),
    );

    expect(fingerprints.check).toHaveBeenCalledWith('abc123');
    expect(evaluation.signals).toContain('fingerprint.anomaly');
  });

  it('does not contribute when the fingerprint service returns `suspicious: false`', async () => {
    const fingerprints = buildFingerprintsStub(false);
    const service = new BotDetectionService(undefined, fingerprints);

    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          ...modernChromeHeaders(),
          'x-device-fingerprint': 'abc123',
        },
      }),
    );

    expect(evaluation.signals).not.toContain('fingerprint.anomaly');
  });

  it('skips the lookup entirely when no fingerprint header is present', async () => {
    const fingerprints = buildFingerprintsStub(true);
    const service = new BotDetectionService(undefined, fingerprints);

    const evaluation = await service.evaluate(makeRequest());
    expect(fingerprints.check).not.toHaveBeenCalled();
    expect(evaluation.signals).not.toContain('fingerprint.anomaly');
  });
});

// =====================================================================
// WAF challenge marker
// =====================================================================

describe('BotDetectionService — WAF challenge marker', () => {
  it('contributes a strong weight when `req.wafChallenge` is set', async () => {
    const service = new BotDetectionService();
    const evaluation = await service.evaluate(
      makeRequest({
        wafChallenge: {
          ruleId: 'suspicious.scanner_user_agent',
          category: 'BOT',
          surface: 'headers',
        },
      }),
    );

    expect(evaluation.signals).toContain('waf.challenge');
    expect(evaluation.score).toBeGreaterThanOrEqual(
      BotDetectionService.CHALLENGE_THRESHOLD,
    );
  });
});

// =====================================================================
// Behavioural summary fold-in
// =====================================================================

describe('BotDetectionService — behavioural summary fold-in', () => {
  it('lifts the score into CHALLENGE when the stored summary scores high', async () => {
    const behavioural = {
      lookup: jest.fn().mockResolvedValue({
        sessionId: 'sess-1',
        mouseMovements: 0,
        keystrokes: 12,
        dwellTime: 1_200,
        formCompletionMs: 1_500,
        receivedAt: new Date().toISOString(),
      }),
      computeScore: jest.fn().mockReturnValue({
        score: 0.7,
        reasons: ['behavior.form_too_fast_no_mouse'],
      }),
    } as unknown as BehavioralService;

    const service = new BotDetectionService(undefined, undefined, behavioural);
    const evaluation = await service.evaluate(
      makeRequest({
        headers: {
          ...modernChromeHeaders(),
          'x-session-id': 'sess-1',
        },
      }),
    );

    expect(behavioural.lookup).toHaveBeenCalledWith('sess-1');
    expect(evaluation.signals).toContain('behavior.form_too_fast_no_mouse');
    expect(evaluation.decision).toBe('CHALLENGE');
  });

  it('skips the lookup when no `X-Session-Id` header is present', async () => {
    const behavioural = {
      lookup: jest.fn(),
      computeScore: jest.fn(),
    } as unknown as BehavioralService;
    const service = new BotDetectionService(undefined, undefined, behavioural);

    const evaluation = await service.evaluate(makeRequest());
    expect(behavioural.lookup).not.toHaveBeenCalled();
    expect(evaluation.decision).toBe('ALLOW');
  });
});

// =====================================================================
// Decision thresholds
// =====================================================================

describe('BotDetectionService — decision thresholds', () => {
  const service = new BotDetectionService();

  it('returns ALLOW for scores below 0.5', () => {
    expect(service.decide(0)).toBe('ALLOW');
    expect(service.decide(0.49)).toBe('ALLOW');
  });

  it('returns CHALLENGE for scores in [0.5, 0.85)', () => {
    expect(service.decide(0.5)).toBe('CHALLENGE');
    expect(service.decide(0.84)).toBe('CHALLENGE');
  });

  it('returns BLOCK for scores >= 0.85', () => {
    expect(service.decide(0.85)).toBe('BLOCK');
    expect(service.decide(1)).toBe('BLOCK');
  });

  it('clamps the final score into [0, 1]', async () => {
    // Stack every signal we can reach: known-bot UA + missing language +
    // missing encoding + WAF challenge would otherwise sum > 1.
    const evaluation = await service.evaluate(
      makeRequest({
        headers: { 'user-agent': 'sqlmap/1.0' },
        wafChallenge: {
          ruleId: 'rule',
          category: 'BOT',
          surface: 'headers',
        },
      }),
    );
    expect(evaluation.score).toBeLessThanOrEqual(1);
    expect(evaluation.score).toBeGreaterThanOrEqual(0);
  });
});

// =====================================================================
// Env-driven threshold overrides
// =====================================================================

describe('BotDetectionService — env-driven threshold overrides', () => {
  function buildConfig(values: Record<string, unknown>): {
    get: jest.Mock;
  } {
    return {
      get: jest.fn().mockImplementation((key: string) => values[key]),
    };
  }

  it('honours `BOT_DETECTION_BLOCK_THRESHOLD` when ConfigService is provided', () => {
    const config = buildConfig({
      BOT_DETECTION_BLOCK_THRESHOLD: 0.7,
      BOT_DETECTION_CHALLENGE_THRESHOLD: 0.4,
    });
    const service = new BotDetectionService(
      undefined,
      undefined,
      undefined,
      config as unknown as ConfigService,
    );

    expect(service.effectiveBlockThreshold).toBe(0.7);
    expect(service.effectiveChallengeThreshold).toBe(0.4);
    expect(service.decide(0.7)).toBe('BLOCK');
    expect(service.decide(0.5)).toBe('CHALLENGE');
    expect(service.decide(0.39)).toBe('ALLOW');
  });

  it('falls back to defaults when ConfigService returns undefined', () => {
    const config = buildConfig({});
    const service = new BotDetectionService(
      undefined,
      undefined,
      undefined,
      config as unknown as ConfigService,
    );

    expect(service.effectiveBlockThreshold).toBe(
      BotDetectionService.BLOCK_THRESHOLD,
    );
    expect(service.effectiveChallengeThreshold).toBe(
      BotDetectionService.CHALLENGE_THRESHOLD,
    );
  });

  it('clamps challenge below block when the operator inverted the pair', () => {
    const config = buildConfig({
      BOT_DETECTION_BLOCK_THRESHOLD: 0.4,
      BOT_DETECTION_CHALLENGE_THRESHOLD: 0.9,
    });
    const service = new BotDetectionService(
      undefined,
      undefined,
      undefined,
      config as unknown as ConfigService,
    );

    expect(service.effectiveBlockThreshold).toBe(0.4);
    expect(service.effectiveChallengeThreshold).toBeLessThanOrEqual(
      service.effectiveBlockThreshold,
    );
  });

  it('clamps numeric thresholds into [0, 1]', () => {
    const config = buildConfig({
      BOT_DETECTION_BLOCK_THRESHOLD: 5,
      BOT_DETECTION_CHALLENGE_THRESHOLD: -1,
    });
    const service = new BotDetectionService(
      undefined,
      undefined,
      undefined,
      config as unknown as ConfigService,
    );

    expect(service.effectiveBlockThreshold).toBe(1);
    expect(service.effectiveChallengeThreshold).toBe(0);
  });
});
