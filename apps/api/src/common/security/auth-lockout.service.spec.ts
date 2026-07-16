import { HttpException, HttpStatus } from '@nestjs/common';

import { AdminAuditService } from '../../modules/admin/admin-audit.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { RedisService } from '../../infra/redis/redis.service';
import { BruteForceService } from './brute-force.service';

/**
 * Unit-test the progressive brute-force lockout + credential-stuffing
 * detection (Task 27.2, Requirements 27.4 / 27.5 / 27.9).
 *
 * The service depends on Redis. Instead of using a real Redis we run
 * an in-memory replacement that supports just enough of the
 * `RedisService` surface (`get` / `set` / `del` / `exists` / `incr` /
 * `expire`) plus the underlying `ioredis` SET ops we use for the
 * credential-stuffing tracker (`sadd`, `scard`, `expire`). Sticking
 * with a fake keeps the suite hermetic while still exercising the
 * atomic INCR semantics that real Redis provides.
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

  // ---- ioredis-shaped client used by the SADD/SCARD path ----
  readonly client = {
    sadd: async (key: string, member: string): Promise<number> => {
      this.purgeExpired();
      const set = this.sets.get(key) ?? {
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
      set.expiresAt = Date.now() + ttlSeconds * 1000;
      return 1;
    },
  };

  private purgeExpired(): void {
    const now = Date.now();
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

  // ---- RedisService surface ----
  getClient(): typeof this.client {
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
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    const had = this.kv.delete(key) || this.sets.delete(key);
    return had ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.purgeExpired();
    return this.kv.has(key) || this.sets.has(key);
  }

  async setnx(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    this.purgeExpired();
    if (this.kv.has(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
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
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  // ---- test helpers ----
  size(): number {
    this.purgeExpired();
    return this.kv.size + this.sets.size;
  }

  rawSet(key: string, value: string, ttlSeconds?: number): void {
    this.kv.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}

function buildAuditService(): jest.Mocked<AdminAuditService> {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
}

function buildOutboxService(): jest.Mocked<OutboxService> {
  return {
    create: jest.fn().mockResolvedValue('outbox-id'),
  } as unknown as jest.Mocked<OutboxService>;
}

function buildPrisma() {
  // The service only uses `$transaction` to wrap an outbox write.
  // Forward the callback to the supplied `tx` shape (here just an
  // empty object — OutboxService is mocked).
  const tx = {} as any;
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(tx);
    }),
  } as any;
}

function buildService(opts: {
  redis?: FakeRedis | null;
  audit?: jest.Mocked<AdminAuditService> | null;
  outbox?: jest.Mocked<OutboxService> | null;
  prisma?: ReturnType<typeof buildPrisma> | null;
} = {}): {
  service: BruteForceService;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
  outbox: jest.Mocked<OutboxService>;
  prisma: ReturnType<typeof buildPrisma>;
} {
  const redis = opts.redis === undefined ? new FakeRedis() : (opts.redis as FakeRedis);
  const audit = opts.audit === undefined ? buildAuditService() : (opts.audit as jest.Mocked<AdminAuditService>);
  const outbox = opts.outbox === undefined ? buildOutboxService() : (opts.outbox as jest.Mocked<OutboxService>);
  const prisma = opts.prisma === undefined ? buildPrisma() : (opts.prisma as ReturnType<typeof buildPrisma>);

  const service = new BruteForceService(
    (redis as unknown as RedisService) ?? undefined,
    (outbox as unknown as OutboxService) ?? undefined,
    prisma ?? undefined,
    (audit as unknown as AdminAuditService) ?? undefined,
  );

  return { service, redis, audit, outbox, prisma };
}

async function recordFailures(
  service: BruteForceService,
  email: string,
  ip: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await service.recordFailure(email, ip);
  }
}

describe('BruteForceService — progressive per-email lockout (Task 27.2 / Req 27.4)', () => {
  it.each([
    { failures: 4, locked: false },
    { failures: 5, locked: true, durationSec: 60 },
    { failures: 10, locked: true, durationSec: 5 * 60 },
    { failures: 15, locked: true, durationSec: 30 * 60 },
    { failures: 20, locked: true, durationSec: 24 * 60 * 60 },
    { failures: 25, locked: true, durationSec: 24 * 60 * 60 },
  ])(
    'after %p failures the email lockout matches the spec table',
    async ({ failures, locked, durationSec }) => {
      const { service } = buildService();
      const email = 'user@example.com';
      const ip = '203.0.113.10';

      await recordFailures(service, email, ip, failures - 1);
      const final = await service.recordFailure(email, ip);

      expect(final.emailFailureCount).toBe(failures);
      expect(final.emailLocked).toBe(locked);
      if (locked) {
        expect(final.emailLockoutUntil).toBeInstanceOf(Date);
        const remaining =
          (final.emailLockoutUntil!.getTime() - Date.now()) / 1000;
        // Allow a small jitter for execution time.
        expect(remaining).toBeGreaterThan(durationSec! - 5);
        expect(remaining).toBeLessThanOrEqual(durationSec!);
      } else {
        expect(final.emailLockoutUntil).toBeNull();
      }
    },
  );

  it('throws 429 ACCOUNT_LOCKED with retryAfter once an email lockout is active', async () => {
    const { service } = buildService();
    const email = 'locked@example.com';
    const ip = '203.0.113.11';

    await recordFailures(service, email, ip, 5);

    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toMatchObject({
      constructor: HttpException,
      response: expect.objectContaining({
        code: 'ACCOUNT_LOCKED',
        details: expect.objectContaining({
          retryAfter: expect.any(Number),
          retryAfterUntil: expect.any(String),
        }),
      }),
    });

    try {
      await service.assertNotLocked(email, ip);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('writes one auth.lockout.email audit row per escalation tier', async () => {
    const { service, audit } = buildService();
    const email = 'audit@example.com';
    const ip = '203.0.113.12';

    await recordFailures(service, email, ip, 5); // tier 1
    expect(audit.log).toHaveBeenCalledTimes(1);

    await recordFailures(service, email, ip, 5); // → 10, tier 2
    expect(audit.log).toHaveBeenCalledTimes(2);

    await recordFailures(service, email, ip, 5); // → 15, tier 3
    expect(audit.log).toHaveBeenCalledTimes(3);

    await recordFailures(service, email, ip, 5); // → 20, tier 4 (24h)
    expect(audit.log).toHaveBeenCalledTimes(4);

    expect(audit.log).toHaveBeenLastCalledWith(
      null,
      'auth.lockout.email',
      email,
      expect.objectContaining({
        threshold: 20,
        attemptCount: 20,
        durationSec: 24 * 60 * 60,
      }),
    );
  });

  it('emits a security.account_locked outbox event at the 24h tier', async () => {
    const { service, outbox } = buildService();
    const email = 'critical@example.com';
    const ip = '203.0.113.13';

    await recordFailures(service, email, ip, 19);
    expect(outbox.create).not.toHaveBeenCalled();

    await service.recordFailure(email, ip);

    expect(outbox.create).toHaveBeenCalledTimes(1);
    expect(outbox.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topic: 'security.account_locked',
        payload: expect.objectContaining({
          email,
          severity: 'TERMINAL',
          threshold: 20,
          attemptCount: 20,
        }),
        idempotencyKey: 'security.account_locked:critical@example.com:20',
      }),
    );
  });

  it('does not emit the outbox alert at the lower (1m / 5m / 30m) tiers', async () => {
    const { service, outbox } = buildService();
    const email = 'tiered@example.com';
    const ip = '203.0.113.14';

    await recordFailures(service, email, ip, 15); // 5 → 10 → 15
    expect(outbox.create).not.toHaveBeenCalled();
  });
});

describe('BruteForceService — counter resets on success (Req 27.4)', () => {
  it('clears the email counter and lockout on recordSuccess', async () => {
    const { service, redis } = buildService();
    const email = 'reset@example.com';
    const ip = '203.0.113.20';

    await recordFailures(service, email, ip, 5);
    expect(await redis.get(`auth:failed:email:${email}`)).toBe('5');
    expect(await redis.get(`auth:lockout:email:${email}`)).not.toBeNull();

    await service.recordSuccess(email, ip);

    expect(await redis.get(`auth:failed:email:${email}`)).toBeNull();
    expect(await redis.get(`auth:lockout:email:${email}`)).toBeNull();
    expect(await service.isCaptchaRequired(email)).toBe(false);
  });

  it('preserves the IP counter on recordSuccess (IP tracks abuse, not the user)', async () => {
    const { service, redis } = buildService();
    const email = 'ipsticky@example.com';
    const ip = '203.0.113.21';

    await recordFailures(service, email, ip, 3);
    expect(await redis.get(`auth:failed:ip:${ip}`)).toBe('3');

    await service.recordSuccess(email, ip);

    expect(await redis.get(`auth:failed:ip:${ip}`)).toBe('3');
  });

  it('captcha-required flag is set once the email is locked and cleared on success', async () => {
    const { service } = buildService();
    const email = 'captcha@example.com';
    const ip = '203.0.113.22';

    await recordFailures(service, email, ip, 5);
    expect(await service.isCaptchaRequired(email)).toBe(true);

    await service.recordSuccess(email, ip);
    expect(await service.isCaptchaRequired(email)).toBe(false);
  });
});

describe('BruteForceService — per-IP rate-based block (Req 27.9)', () => {
  it('blocks the IP after IP_RATE_THRESHOLD failures inside the window', async () => {
    const { service, redis, audit } = buildService();
    const ip = '203.0.113.30';
    // Use a single email so the credential-stuffing tracker stays at
    // 1 distinct email — it must NOT race the IP_RATE path. The
    // email lockout fires after 5 failures but recordFailure keeps
    // bumping the IP counter regardless.
    const email = 'spray@example.com';

    for (let i = 0; i < BruteForceService.IP_RATE_THRESHOLD - 1; i++) {
      await service.recordFailure(email, ip);
    }
    expect(await redis.get(`auth:lockout:ip:${ip}`)).toBeNull();

    const final = await service.recordFailure(email, ip);
    expect(final.ipLocked).toBe(true);
    expect(final.ipLockoutUntil).toBeInstanceOf(Date);

    // Audit row written.
    const ipAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'auth.lockout.ip',
    );
    expect(ipAudits).toHaveLength(1);
    expect(ipAudits[0]![3]).toMatchObject({
      reason: 'IP_RATE',
      durationSec: 60 * 60,
    });
  });

  it('the IP lockout is independent of the email lockout', async () => {
    const { service } = buildService();
    const ip = '203.0.113.31';

    // Send the email far past its 24h tier (using a single email)
    // and then probe assertNotLocked from a *different* IP — the
    // email lockout should still gate the request, but the IP
    // lockout should not.
    const targetEmail = 'victim@example.com';
    await recordFailures(service, targetEmail, ip, 25);

    // Different IP for the next probe.
    const otherIp = '203.0.113.32';
    await expect(
      service.assertNotLocked(targetEmail, otherIp),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
    });

    // And a different email from the same original IP should not be
    // blocked because the IP counter is well below the threshold.
    const cleanEmail = 'cleanuser@example.com';
    await expect(
      service.assertNotLocked(cleanEmail, ip),
    ).resolves.toBeUndefined();
  });

  it('IP_LOCKED is surfaced before ACCOUNT_LOCKED when both are active', async () => {
    const { service } = buildService();
    const email = 'both@example.com';
    const ip = '203.0.113.33';

    // 50 consecutive failures from the same email push the email
    // past the 24h tier (≥20) AND increment the IP counter to 50,
    // which is exactly IP_RATE_THRESHOLD. Both lockout markers are
    // now active.
    await recordFailures(
      service,
      email,
      ip,
      BruteForceService.IP_RATE_THRESHOLD,
    );

    await expect(
      service.assertNotLocked(email, ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IP_LOCKED' }),
    });
  });
});

describe('BruteForceService — credential-stuffing detection (Req 27.9)', () => {
  it('blocks the IP when distinct emails attempted exceeds CRED_STUFFING_DISTINCT_EMAILS', async () => {
    const { service, redis, audit } = buildService();
    const ip = '203.0.113.40';

    // Hit the same IP from 11 distinct emails — the 11th attempt
    // should trip the credential-stuffing path. We stay under the
    // rate-based threshold (50 failures) by using fewer attempts.
    for (let i = 0; i < BruteForceService.CRED_STUFFING_DISTINCT_EMAILS; i++) {
      const state = await service.recordFailure(`u${i}@example.com`, ip);
      // Boundary: we must NOT be IP-locked yet — only crossing past
      // the threshold should block.
      expect(state.ipLocked).toBe(false);
    }

    const finalState = await service.recordFailure(
      `u${BruteForceService.CRED_STUFFING_DISTINCT_EMAILS}@example.com`,
      ip,
    );
    expect(finalState.suspectedCredentialStuffing).toBe(true);
    expect(finalState.ipLocked).toBe(true);
    expect(await redis.get(`auth:lockout:ip:${ip}`)).not.toBeNull();

    const ipAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'auth.lockout.ip',
    );
    expect(ipAudits).toHaveLength(1);
    expect(ipAudits[0]![3]).toMatchObject({
      reason: 'CREDENTIAL_STUFFING',
      threshold: BruteForceService.CRED_STUFFING_DISTINCT_EMAILS,
    });
  });

  it('multiple failures from the same email do not increase the distinct-emails counter', async () => {
    const { service } = buildService();
    const ip = '203.0.113.41';
    const email = 'sticky@example.com';

    // 11 failures from the same email — same single distinct email,
    // so the credential-stuffing tracker stays under the threshold.
    // The email lockout will fire after 5 failures, but that is
    // independent of the IP path.
    for (let i = 0; i < 11; i++) {
      const state = await service.recordFailure(email, ip);
      expect(state.suspectedCredentialStuffing).toBe(false);
      expect(state.ipLocked).toBe(false);
    }
  });
});

describe('BruteForceService — concurrency (atomic Redis INCR)', () => {
  it('produces sequential email counts when failures are recorded in parallel', async () => {
    const { service, redis } = buildService();
    const email = 'parallel@example.com';
    const ip = '203.0.113.50';

    const PARALLEL = 7;
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        service.recordFailure(email, ip),
      ),
    );

    const counts = results.map((r) => r.emailFailureCount).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await redis.get(`auth:failed:email:${email}`)).toBe(String(PARALLEL));
  });

  it('still applies the lockout exactly once when racers cross the threshold', async () => {
    const { service, audit } = buildService();
    const email = 'race@example.com';
    const ip = '203.0.113.51';

    // 4 sequential failures, then 3 racing failures — racers should
    // collectively cross the 5-failure threshold but only the racer
    // that reaches exactly 5 issues the lockout (and thus the audit
    // row).
    await recordFailures(service, email, ip, 4);
    audit.log.mockClear();

    await Promise.all([
      service.recordFailure(email, ip),
      service.recordFailure(email, ip),
      service.recordFailure(email, ip),
    ]);

    const tierAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'auth.lockout.email' && (call[3] as any).threshold === 5,
    );
    expect(tierAudits).toHaveLength(1);
  });
});

describe('BruteForceService — fail-open without Redis', () => {
  it('returns an empty state and never throws when Redis is missing', async () => {
    const service = new BruteForceService(undefined, undefined, undefined, undefined);

    const state = await service.recordFailure('a@example.com', '127.0.0.1');
    expect(state).toEqual({
      emailFailureCount: 0,
      ipFailureCount: 0,
      emailLocked: false,
      ipLocked: false,
      emailLockoutUntil: null,
      ipLockoutUntil: null,
      suspectedCredentialStuffing: false,
    });

    await expect(
      service.assertNotLocked('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();
    await expect(
      service.recordSuccess('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();
    await expect(service.isCaptchaRequired('a@example.com')).resolves.toBe(
      false,
    );
  });
});

describe('BruteForceService — tier table helper', () => {
  it('returns null for counts below the first threshold', () => {
    expect(BruteForceService.tierForEmailCount(0)).toBeNull();
    expect(BruteForceService.tierForEmailCount(4)).toBeNull();
  });

  it('returns the highest tier whose threshold is <= count', () => {
    expect(BruteForceService.tierForEmailCount(5)?.threshold).toBe(5);
    expect(BruteForceService.tierForEmailCount(9)?.threshold).toBe(5);
    expect(BruteForceService.tierForEmailCount(10)?.threshold).toBe(10);
    expect(BruteForceService.tierForEmailCount(14)?.threshold).toBe(10);
    expect(BruteForceService.tierForEmailCount(15)?.threshold).toBe(15);
    expect(BruteForceService.tierForEmailCount(19)?.threshold).toBe(15);
    expect(BruteForceService.tierForEmailCount(20)?.threshold).toBe(20);
    expect(BruteForceService.tierForEmailCount(999)?.threshold).toBe(20);
  });
});
