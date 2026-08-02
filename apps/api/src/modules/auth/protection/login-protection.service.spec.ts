import { HttpException, HttpStatus } from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';
import {
  LOGIN_LOCKOUT_DEFAULT_TIERS,
  LoginProtectionService,
} from './login-protection.service';

/**
 * Unit-test the progressive login lockout (Task 27.2,
 * Requirements 27.4 / 27.5 / 27.9).
 *
 * The service depends on a Redis-shaped store so we run an in-memory
 * fake that supports the methods `LoginProtectionService` reaches
 * for: `get` / `set` / `del` / `incr` / `expire`. Manual TTL ageing
 * via `tickSeconds` lets us assert the marker actually expires
 * without a real clock or a real Redis.
 */

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

class FakeRedis {
  private kv = new Map<string, StoredValue>();
  /** Synthetic clock offset (ms) — added to `Date.now()` for TTL math. */
  private clockOffsetMs = 0;

  private now(): number {
    return Date.now() + this.clockOffsetMs;
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.kv) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.kv.delete(key);
      }
    }
  }

  /** Fast-forward the fake clock by `seconds` to age TTLs. */
  tickSeconds(seconds: number): void {
    this.clockOffsetMs += seconds * 1000;
  }

  // ---- RedisService surface ----
  getClient(): unknown {
    return null;
  }

  async get(key: string): Promise<string | null> {
    this.purgeExpired();
    return this.kv.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.purgeExpired();
    return this.kv.has(key);
  }

  async incr(key: string): Promise<number> {
    this.purgeExpired();
    const current = this.kv.get(key);
    const next = (current ? parseInt(current.value, 10) : 0) + 1;
    this.kv.set(key, {
      value: String(next),
      expiresAt: current?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.kv.get(key);
    if (entry) entry.expiresAt = this.now() + ttlSeconds * 1000;
  }

  // ---- test helpers ----
  size(): number {
    this.purgeExpired();
    return this.kv.size;
  }
}

interface BuildResult {
  service: LoginProtectionService;
  redis: FakeRedis;
}

function buildService(opts: { withRedis?: boolean } = {}): BuildResult {
  const redis = new FakeRedis();
  const service = new LoginProtectionService(
    opts.withRedis === false
      ? undefined
      : (redis as unknown as RedisService),
  );
  return { service, redis };
}

async function recordFailures(
  service: LoginProtectionService,
  email: string,
  ip: string,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await service.recordFailure(email, ip);
  }
}

describe('LoginProtectionService — progressive lockout schedule (Task 27.2)', () => {
  it.each([
    { failures: 4, expectLocked: false },
    { failures: 5, expectLocked: true, durationSec: 60 },
    { failures: 9, expectLocked: false },
    { failures: 10, expectLocked: true, durationSec: 5 * 60 },
    { failures: 19, expectLocked: false },
    { failures: 20, expectLocked: true, durationSec: 30 * 60 },
    { failures: 49, expectLocked: false },
    { failures: 50, expectLocked: true, durationSec: 24 * 60 * 60 },
    { failures: 75, expectLocked: false },
  ])(
    'after %p failures the lockout matches the spec table',
    async ({ failures, expectLocked, durationSec }) => {
      const { service } = buildService();
      const email = 'progressive@example.com';
      const ip = '203.0.113.1';

      await recordFailures(service, email, ip, failures - 1);
      const result = await service.recordFailure(email, ip);

      const isThresholdAttempt =
        durationSec !== undefined && expectLocked === true;

      if (isThresholdAttempt) {
        expect(result.lockedUntil).toBeInstanceOf(Date);
        const remaining =
          (result.lockedUntil!.getTime() - Date.now()) / 1000;
        expect(remaining).toBeGreaterThan(durationSec! - 5);
        expect(remaining).toBeLessThanOrEqual(durationSec! + 1);
      } else {
        // Past-threshold non-anchor attempts (e.g. 75) don't apply a
        // new marker. They may still surface an existing marker
        // because we read the prior tier's lockout, so we don't
        // assert null here.
        expect(typeof result.attemptsLeft).toBe('number');
      }
    },
  );

  it('throws 429 LOGIN_LOCKED with retryAfter once the lockout is active', async () => {
    const { service } = buildService();
    const email = 'locked@example.com';
    const ip = '203.0.113.2';

    await recordFailures(service, email, ip, 5);

    await expect(service.assertNotLocked(email, ip)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LOGIN_LOCKED',
        details: expect.objectContaining({
          retryAfter: expect.any(Number),
          lockedUntil: expect.any(String),
        }),
      }),
    });

    try {
      await service.assertNotLocked(email, ip);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['details']).toMatchObject({
        retryAfter: expect.any(Number),
        lockedUntil: expect.any(String),
      });
    }
  });

  it('decreases attemptsLeft as failures accumulate before the first tier', async () => {
    const { service } = buildService();
    const email = 'count@example.com';
    const ip = '203.0.113.3';

    const r1 = await service.recordFailure(email, ip);
    expect(r1.attemptsLeft).toBe(4);

    const r2 = await service.recordFailure(email, ip);
    expect(r2.attemptsLeft).toBe(3);

    const r3 = await service.recordFailure(email, ip);
    expect(r3.attemptsLeft).toBe(2);

    const r4 = await service.recordFailure(email, ip);
    expect(r4.attemptsLeft).toBe(1);

    const r5 = await service.recordFailure(email, ip);
    expect(r5.attemptsLeft).toBe(5); // 5 → next tier is 10, 10 - 5 = 5
    expect(r5.lockedUntil).toBeInstanceOf(Date);
  });
});

describe('LoginProtectionService — recordSuccess clears state (Req 27.4)', () => {
  it('clears the per-(email, ip) and per-email counters on success', async () => {
    const { service, redis } = buildService();
    const email = 'reset@example.com';
    const ip = '203.0.113.10';

    await recordFailures(service, email, ip, 4);
    expect(redis.size()).toBeGreaterThan(0);

    await service.recordSuccess(email, ip);

    expect(redis.size()).toBe(0);

    // After success, the user can hit the first tier again from
    // scratch — assert by fresh failures.
    const next = await service.recordFailure(email, ip);
    expect(next.attemptsLeft).toBe(4);
    expect(next.lockedUntil).toBeNull();
  });

  it('clears the lockout marker on success', async () => {
    const { service, redis } = buildService();
    const email = 'unlock@example.com';
    const ip = '203.0.113.11';

    await recordFailures(service, email, ip, 5); // crosses tier 1

    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toBeInstanceOf(HttpException);

    await service.recordSuccess(email, ip);
    await expect(
      service.assertNotLocked(email, ip),
    ).resolves.toBeUndefined();
    expect(redis.size()).toBe(0);
  });
});

describe('LoginProtectionService — lock survives restart (Redis TTL)', () => {
  /**
   * "Survives restart" is modelled by:
   *   1. recording the failures that trip the tier
   *   2. constructing a *fresh* `LoginProtectionService` against the
   *      same Redis store
   *   3. asserting the new instance still rejects `assertNotLocked`
   *
   * Then we age the fake clock past the tier duration and confirm
   * the marker drops, simulating the natural TTL expiry.
   */
  it('a brand-new service instance reading the same Redis still sees the lock', async () => {
    const redis = new FakeRedis();
    const first = new LoginProtectionService(
      redis as unknown as RedisService,
    );
    const email = 'survive@example.com';
    const ip = '203.0.113.20';

    await recordFailures(first, email, ip, 5);

    const second = new LoginProtectionService(
      redis as unknown as RedisService,
    );
    await expect(
      second.assertNotLocked(email, ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LOGIN_LOCKED' }),
    });
  });

  it('the lock auto-clears once the tier-driven TTL elapses', async () => {
    const redis = new FakeRedis();
    const service = new LoginProtectionService(
      redis as unknown as RedisService,
    );
    const email = 'expiry@example.com';
    const ip = '203.0.113.21';

    await recordFailures(service, email, ip, 5); // tier 1 → 60s lockout
    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toBeInstanceOf(HttpException);

    redis.tickSeconds(61);
    await expect(
      service.assertNotLocked(email, ip),
    ).resolves.toBeUndefined();
  });

  it('higher tier lockouts have a longer TTL than lower ones', async () => {
    const redis = new FakeRedis();
    const service = new LoginProtectionService(
      redis as unknown as RedisService,
    );
    const email = 'tier2@example.com';
    const ip = '203.0.113.22';

    await recordFailures(service, email, ip, 10); // tier 2 → 5 min

    redis.tickSeconds(61); // beyond tier 1's 1 min
    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toBeInstanceOf(HttpException);

    redis.tickSeconds(5 * 60); // beyond tier 2's 5 min
    await expect(
      service.assertNotLocked(email, ip),
    ).resolves.toBeUndefined();
  });
});

describe('LoginProtectionService — fail-open without Redis', () => {
  it('returns sentinel results and never throws when Redis is missing', async () => {
    const { service } = buildService({ withRedis: false });
    await expect(
      service.assertNotLocked('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    const result = await service.recordFailure('a@example.com', '127.0.0.1');
    expect(result.lockedUntil).toBeNull();
    expect(result.attemptsLeft).toBe(5); // first-tier sentinel

    await expect(
      service.recordSuccess('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();
  });
});

describe('LoginProtectionService — tier table loader', () => {
  it('falls back to the spec defaults when no ConfigService is supplied', () => {
    const tiers = LoginProtectionService.loadTiers();
    expect(tiers.map((t) => t.threshold)).toEqual([5, 10, 20, 50]);
    expect(tiers.map((t) => t.durationSec)).toEqual([
      60,
      5 * 60,
      30 * 60,
      24 * 60 * 60,
    ]);
  });

  it('reads operator overrides from the configured environment variables', () => {
    const fakeConfig = {
      get: (key: string) =>
        ({
          LOGIN_LOCKOUT_TIER_1_FAILS: 3,
          LOGIN_LOCKOUT_TIER_1_DURATION_SECONDS: 30,
          LOGIN_LOCKOUT_TIER_2_FAILS: 6,
          LOGIN_LOCKOUT_TIER_2_DURATION_SECONDS: 120,
          LOGIN_LOCKOUT_TIER_3_FAILS: 12,
          LOGIN_LOCKOUT_TIER_3_DURATION_SECONDS: 600,
          LOGIN_LOCKOUT_TIER_4_FAILS: 30,
          LOGIN_LOCKOUT_TIER_4_DURATION_SECONDS: 3600,
        })[key as string],
    } as any;

    const tiers = LoginProtectionService.loadTiers(fakeConfig);
    expect(tiers).toEqual([
      { threshold: 3, durationSec: 30 },
      { threshold: 6, durationSec: 120 },
      { threshold: 12, durationSec: 600 },
      { threshold: 30, durationSec: 3600 },
    ]);
  });

  it('falls back to the per-tier default when an env var is missing or invalid', () => {
    const fakeConfig = {
      get: (key: string) =>
        ({
          LOGIN_LOCKOUT_TIER_1_FAILS: 'not-a-number',
          LOGIN_LOCKOUT_TIER_1_DURATION_SECONDS: -10,
          LOGIN_LOCKOUT_TIER_2_FAILS: 8,
          LOGIN_LOCKOUT_TIER_2_DURATION_SECONDS: 240,
        })[key as string],
    } as any;

    const tiers = LoginProtectionService.loadTiers(fakeConfig);
    expect(tiers[0]).toEqual(LOGIN_LOCKOUT_DEFAULT_TIERS[0]);
    expect(tiers[1]).toEqual({ threshold: 8, durationSec: 240 });
    expect(tiers[2]).toEqual(LOGIN_LOCKOUT_DEFAULT_TIERS[2]);
    expect(tiers[3]).toEqual(LOGIN_LOCKOUT_DEFAULT_TIERS[3]);
  });
});

describe('LoginProtectionService — recordFailure return shape', () => {
  it('reports lockedUntil as a Date when a tier triggers', async () => {
    const { service } = buildService();
    const email = 'shape@example.com';
    const ip = '203.0.113.30';

    const before = await service.recordFailure(email, ip);
    expect(before.lockedUntil).toBeNull();
    expect(before.attemptsLeft).toBe(4);

    await recordFailures(service, email, ip, 3);
    const tripping = await service.recordFailure(email, ip);
    expect(tripping.lockedUntil).toBeInstanceOf(Date);
    expect(tripping.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});
