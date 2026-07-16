import { HttpException, HttpStatus } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { BruteForceProtectionService } from './brute-force-protection.service';

/**
 * Unit tests for `BruteForceProtectionService` (Task 27.2,
 * Requirements 27.4, 27.5, 27.9).
 *
 * The service depends on a Redis-shaped store. Instead of a real
 * Redis we run an in-memory fake covering the four operations the
 * service actually uses (`incr`, `get`, `set`, `del`, `expire`,
 * `setnx`) plus the ioredis client surface for sets (`sadd`,
 * `scard`, `expire NX`).
 *
 * `tickSeconds` simulates clock progression so we can verify the
 * tier windows and the lockout TTLs without relying on real time.
 */

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

interface StoredSet {
  members: Set<string>;
  expiresAt: number | null;
}

class FakeRedis {
  private kv = new Map<string, StoredValue>();
  private sets = new Map<string, StoredSet>();
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
    for (const [key, entry] of this.sets) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.sets.delete(key);
      }
    }
  }

  /** Fast-forward the fake clock by `seconds`. */
  tickSeconds(seconds: number): void {
    this.clockOffsetMs += seconds * 1000;
  }

  // ---- Mirrors the ioredis shape used via `getClient()` ----
  readonly client = {
    sadd: async (key: string, member: string): Promise<number> => {
      this.purgeExpired();
      const set =
        this.sets.get(key) ?? {
          members: new Set<string>(),
          expiresAt: null,
        };
      const wasNew = !set.members.has(member);
      set.members.add(member);
      this.sets.set(key, set);
      return wasNew ? 1 : 0;
    },
    scard: async (key: string): Promise<number> => {
      this.purgeExpired();
      return this.sets.get(key)?.members.size ?? 0;
    },
    expire: async (
      key: string,
      ttlSeconds: number,
      mode?: 'NX' | 'XX',
    ): Promise<number> => {
      this.purgeExpired();
      const set = this.sets.get(key);
      if (!set) return 0;
      if (mode === 'NX' && set.expiresAt !== null) return 0;
      set.expiresAt = this.now() + ttlSeconds * 1000;
      return 1;
    },
  };

  getClient() {
    return this.client;
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
      expiresAt:
        ttlSeconds !== undefined ? this.now() + ttlSeconds * 1000 : null,
    });
  }

  async setnx(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    this.purgeExpired();
    if (this.kv.has(key)) return false;
    this.kv.set(key, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return true;
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.purgeExpired();
    return this.kv.has(key) || this.sets.has(key);
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

  // Test-only helpers
  size(): number {
    this.purgeExpired();
    return this.kv.size;
  }

  setSize(key: string): number {
    this.purgeExpired();
    return this.sets.get(key)?.members.size ?? 0;
  }
}

interface BuildResult {
  service: BruteForceProtectionService;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
}

function buildAudit(): jest.Mocked<AdminAuditService> {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
}

function buildService(
  opts: { withRedis?: boolean; withAudit?: boolean } = {},
): BuildResult {
  const redis = new FakeRedis();
  const audit = buildAudit();
  const service = new BruteForceProtectionService(
    opts.withRedis === false ? undefined : (redis as unknown as RedisService),
    opts.withAudit === false ? undefined : audit,
  );
  return { service, redis, audit };
}

async function recordFailures(
  service: BruteForceProtectionService,
  email: string,
  ip: string,
  count: number,
) {
  const results: Array<{ locked: boolean; lockedUntil?: Date }> = [];
  for (let i = 0; i < count; i++) {
    results.push(await service.recordFailure(email, ip));
  }
  return results;
}

describe('BruteForceProtectionService — tier table (Property 16)', () => {
  it('5 failures within the 15-minute window trip tier 1 (5-minute lockout)', async () => {
    const { service } = buildService();
    const email = 'tier1@example.com';
    const ip = '203.0.113.1';

    // First 4 are below threshold.
    const before = await recordFailures(service, email, ip, 4);
    for (const r of before) {
      expect(r.locked).toBe(false);
    }

    // 5th failure trips tier 1.
    const tripping = await service.recordFailure(email, ip);
    expect(tripping.locked).toBe(true);
    expect(tripping.lockedUntil).toBeInstanceOf(Date);

    const remainingSec =
      (tripping.lockedUntil!.getTime() - Date.now()) / 1000;
    // Tier 1 lockout = 5 minutes. Allow generous slack for CI clocks.
    expect(remainingSec).toBeGreaterThan(5 * 60 - 5);
    expect(remainingSec).toBeLessThanOrEqual(5 * 60 + 1);
  });

  it('10 failures inside an hour escalate to tier 2 (1-hour lockout)', async () => {
    const { service } = buildService();
    const email = 'tier2@example.com';
    const ip = '203.0.113.2';

    await recordFailures(service, email, ip, 10);

    const remaining = await service.recordFailure(email, ip);
    expect(remaining.locked).toBe(true);
    const sec =
      (remaining.lockedUntil!.getTime() - Date.now()) / 1000;
    // The 11th attempt sits firmly inside the tier 2 lockout (1h),
    // and the marker is monotonic so it never shrinks back to tier 1.
    expect(sec).toBeGreaterThan(60 * 60 - 5);
  });

  it('20 failures inside 24 hours escalate to tier 3 (24-hour lockout)', async () => {
    const { service } = buildService();
    const email = 'tier3@example.com';
    const ip = '203.0.113.3';

    await recordFailures(service, email, ip, 20);

    const remaining = await service.recordFailure(email, ip);
    expect(remaining.locked).toBe(true);
    const sec =
      (remaining.lockedUntil!.getTime() - Date.now()) / 1000;
    expect(sec).toBeGreaterThan(24 * 60 * 60 - 5);
  });

  it('throws 429 ACCOUNT_LOCKED with retryAfter once the lockout is active', async () => {
    const { service } = buildService();
    const email = 'locked@example.com';
    const ip = '203.0.113.4';

    await recordFailures(service, email, ip, 5);

    try {
      await service.assertNotLocked(email, ip);
      fail('expected assertNotLocked to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('ACCOUNT_LOCKED');
      expect(body['details']).toMatchObject({
        retryAfter: expect.any(Number),
        lockedUntil: expect.any(String),
      });
    }
  });
});

describe('BruteForceProtectionService — tier windows reset cleanly', () => {
  it('failures from a previous tier 1 window do not count toward a fresh tier 1 attempt', async () => {
    const { service, redis } = buildService();
    const email = 'window@example.com';
    const ip = '203.0.113.10';

    // Four failures, one short of tier 1.
    await recordFailures(service, email, ip, 4);

    // Wait past the tier 1 window (15 min).
    redis.tickSeconds(15 * 60 + 1);

    // Tier 1 counter has dropped → next failure is "the first" again
    // for tier 1 and must NOT trip the lockout.
    const next = await service.recordFailure(email, ip);
    expect(next.locked).toBe(false);
  });

  it('the same failure can count toward higher tiers whose window is still open', async () => {
    const { service, redis } = buildService();
    const email = 'rolling@example.com';
    const ip = '203.0.113.11';

    // Spread 9 failures over the first 14 minutes — under tier 1
    // threshold of 5 only because tier 1 counter resets each window.
    // To make it explicit: do 4 failures, age past tier 1 window, do
    // 6 more failures. Now tier 1 sees 6 (locks!), tier 2 sees 10
    // (also locks, 1h lockout), tier 3 sees 10 (no lock yet).
    await recordFailures(service, email, ip, 4);
    redis.tickSeconds(15 * 60 + 1); // tier 1 window resets, tier 2/3 still open
    const result = await recordFailures(service, email, ip, 6);

    // The 6th attempt in the second batch should have crossed both
    // tier 1 and tier 2; tier 2 wins because the algorithm picks
    // the highest crossed tier.
    const final = result[result.length - 1]!;
    expect(final.locked).toBe(true);
    const remainingSec =
      (final.lockedUntil!.getTime() - Date.now()) / 1000;
    // Tier 2 lockout is 1 hour.
    expect(remainingSec).toBeGreaterThan(60 * 60 - 60);
  });
});

describe('BruteForceProtectionService — recordSuccess clears state', () => {
  it('clears every tier counter and the lockout marker on success', async () => {
    const { service, redis } = buildService();
    const email = 'reset@example.com';
    const ip = '203.0.113.20';

    await recordFailures(service, email, ip, 5); // crosses tier 1
    expect(redis.size()).toBeGreaterThan(0);

    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toBeInstanceOf(HttpException);

    await service.recordSuccess(email, ip);

    // The lockout marker and per-tier counters are gone — but the
    // credential-stuffing set keeps state, so we don't assert
    // `size === 0` outright, only that lock + counters are clear.
    await expect(
      service.assertNotLocked(email, ip),
    ).resolves.toBeUndefined();

    // After success, the user can hit tier 1 again from scratch.
    const next4 = await recordFailures(service, email, ip, 4);
    for (const r of next4) {
      expect(r.locked).toBe(false);
    }
    const trip = await service.recordFailure(email, ip);
    expect(trip.locked).toBe(true);
  });
});

describe('BruteForceProtectionService — credential stuffing detection', () => {
  it('flags an email targeted by >10 distinct IPs in 5 minutes', async () => {
    const { service, audit } = buildService();
    const email = 'cs@example.com';

    // 10 distinct IPs — exactly at threshold, NOT yet detected.
    for (let i = 1; i <= 10; i++) {
      const r = await service.recordCredentialStuffing(
        email,
        `198.51.100.${i}`,
      );
      expect(r.detected).toBe(false);
    }
    expect(audit.log).not.toHaveBeenCalled();

    // 11th distinct IP crosses (>10 by spec).
    const trip = await service.recordCredentialStuffing(
      email,
      '198.51.100.11',
    );
    expect(trip.detected).toBe(true);
    expect(trip.distinctIps).toBe(11);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      null,
      'auth.credential_stuffing.detected',
      email,
      expect.objectContaining({
        email,
        distinctIps: 11,
        threshold: 10,
        windowSec: 5 * 60,
        triggeringIp: '198.51.100.11',
      }),
      { ip: '198.51.100.11' },
    );
  });

  it('writes exactly one audit row per email per window even after many crossings', async () => {
    const { service, audit } = buildService();
    const email = 'cs-debounce@example.com';

    // 30 distinct IPs — only the first crossing should produce an audit row.
    for (let i = 0; i < 30; i++) {
      await service.recordCredentialStuffing(email, `198.51.100.${i}`);
    }

    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('the per-email IP set auto-expires after the rolling window', async () => {
    const { service, redis } = buildService();
    const email = 'cs-window@example.com';

    for (let i = 0; i < 5; i++) {
      await service.recordCredentialStuffing(email, `198.51.100.${i}`);
    }
    expect(await service.distinctIpsForEmail(email)).toBe(5);

    redis.tickSeconds(5 * 60 + 1);
    expect(await service.distinctIpsForEmail(email)).toBe(0);
  });

  it('recording a failure also tracks the IP for credential stuffing', async () => {
    const { service, audit } = buildService();
    const email = 'cs-via-fail@example.com';

    // 10 distinct IP failures — at threshold, NOT detected.
    for (let i = 0; i < 10; i++) {
      await service.recordFailure(email, `198.51.100.${i}`);
    }
    expect(audit.log).not.toHaveBeenCalled();

    // 11th distinct IP failure crosses the >10 threshold.
    await service.recordFailure(email, '198.51.100.10');

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      null,
      'auth.credential_stuffing.detected',
      email,
      expect.objectContaining({ distinctIps: 11, threshold: 10 }),
      { ip: '198.51.100.10' },
    );
  });
});

describe('BruteForceProtectionService — fail-open without Redis', () => {
  it('returns a neutral result and never throws when Redis is missing', async () => {
    const { service } = buildService({ withRedis: false });

    await expect(
      service.assertNotLocked('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    const r = await service.recordFailure('a@example.com', '127.0.0.1');
    expect(r).toEqual({ locked: false });

    await expect(
      service.recordSuccess('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    expect(
      await service.recordCredentialStuffing('a@example.com', '127.0.0.1'),
    ).toEqual({ distinctIps: 0, detected: false });
  });
});

describe('BruteForceProtectionService — survives instance restart', () => {
  it('a brand-new service instance reading the same Redis still sees the lock', async () => {
    const redis = new FakeRedis();
    const audit = buildAudit();
    const first = new BruteForceProtectionService(
      redis as unknown as RedisService,
      audit,
    );
    const email = 'survive@example.com';
    const ip = '203.0.113.50';

    await recordFailures(first, email, ip, 5);

    const second = new BruteForceProtectionService(
      redis as unknown as RedisService,
      audit,
    );
    await expect(
      second.assertNotLocked(email, ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
    });
  });
});
