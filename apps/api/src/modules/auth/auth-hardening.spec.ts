import { HttpException, HttpStatus } from '@nestjs/common';

import { AdminAuditService } from '../admin/admin-audit.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuthHardeningService } from './auth-hardening.service';

/**
 * Unit tests for `AuthHardeningService` — Task 27.2 brute-force
 * lockout, IP block tiers, credential-stuffing detection, and the
 * email-driven account unlock flow.
 *
 * The service depends on a Redis-shaped store. Instead of running a
 * real Redis we use an in-memory fake that supports the small subset
 * of operations the service actually reaches for (`get` / `set` /
 * `del` / `setnx` / `incr` / `expire` plus the underlying ioredis
 * `sadd` / `scard` / `expire` for the credential-stuffing tracker).
 *
 * The fake also exposes a synthetic clock (`tickSeconds`) so we can
 * age TTLs deterministically without leaning on real wall-clock time.
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

  /** Fast-forward the synthetic clock by `seconds`. */
  tickSeconds(seconds: number): void {
    this.clockOffsetMs += seconds * 1000;
  }

  // ---- ioredis-shaped client used by the credential-stuffing path ----
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
      expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : null,
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
    if (entry) entry.expiresAt = this.now() + ttlSeconds * 1000;
  }

  // ---- test helpers ----
  size(): number {
    this.purgeExpired();
    return this.kv.size + this.sets.size;
  }

  hasKey(key: string): boolean {
    this.purgeExpired();
    return this.kv.has(key);
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
  // Only `$transaction` is invoked — forward the callback to a stub
  // tx (we never assert on tx contents in these tests).
  const tx = {} as any;
  return {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx),
    ),
  } as any;
}

interface BuildOpts {
  withRedis?: boolean;
  withAudit?: boolean;
  withOutbox?: boolean;
}

interface BuildResult {
  service: AuthHardeningService;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
  outbox: jest.Mocked<OutboxService>;
  prisma: ReturnType<typeof buildPrisma>;
}

function buildService(opts: BuildOpts = {}): BuildResult {
  const redis = new FakeRedis();
  const audit = buildAuditService();
  const outbox = buildOutboxService();
  const prisma = buildPrisma();

  const service = new AuthHardeningService(
    opts.withRedis === false
      ? undefined
      : (redis as unknown as RedisService),
    opts.withAudit === false ? undefined : audit,
    opts.withOutbox === false ? undefined : outbox,
    opts.withOutbox === false ? undefined : (prisma as any),
  );

  return { service, redis, audit, outbox, prisma };
}

async function recordFailures(
  service: AuthHardeningService,
  account: string,
  ip: string,
  count: number,
  meta: { userId?: string; email?: string } = {},
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await service.recordFailure(account, ip, meta);
  }
}

// ---------------------------------------------------------------------
// 1. Soft lock — 5 failures in 15 min → 15 min lockout
// ---------------------------------------------------------------------

describe('AuthHardeningService — soft lockout (5 fails / 15 min → 15 min)', () => {
  it('does not lock the account before the 5-failure threshold', async () => {
    const { service } = buildService();
    const account = 'soft@example.com';
    const ip = '203.0.113.1';

    for (let i = 0; i < 4; i++) {
      const result = await service.recordFailure(account, ip);
      expect(result.accountLock).toBeNull();
    }

    await expect(
      service.assertNotLocked(account, ip),
    ).resolves.toBeUndefined();
  });

  it('locks the account on the 5th failure with code ACCOUNT_LOCKED_TEMP', async () => {
    const { service } = buildService();
    const account = 'soft@example.com';
    const ip = '203.0.113.2';

    await recordFailures(service, account, ip, 4);
    const fifth = await service.recordFailure(account, ip);

    expect(fifth.accountLock).not.toBeNull();
    expect(fifth.accountLock!.code).toBe('ACCOUNT_LOCKED_TEMP');

    const remainingSec =
      (fifth.accountLock!.until.getTime() - Date.now()) / 1000;
    // Lockout duration is 15 min — allow generous jitter on slow runners.
    expect(remainingSec).toBeGreaterThan(15 * 60 - 5);
    expect(remainingSec).toBeLessThanOrEqual(15 * 60 + 1);
  });

  it('throws 429 ACCOUNT_LOCKED_TEMP on subsequent assertNotLocked calls', async () => {
    const { service } = buildService();
    const account = 'asserted@example.com';
    const ip = '203.0.113.3';

    await recordFailures(service, account, ip, 5);

    await expect(
      service.assertNotLocked(account, ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ACCOUNT_LOCKED_TEMP',
        details: expect.objectContaining({
          retryAfter: expect.any(Number),
          lockedUntil: expect.any(String),
        }),
      }),
    });

    try {
      await service.assertNotLocked(account, ip);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });

  it('the soft lock auto-clears after 15 min (TTL expiry)', async () => {
    const { service, redis } = buildService();
    const account = 'expiry@example.com';
    const ip = '203.0.113.4';

    await recordFailures(service, account, ip, 5);
    await expect(
      service.assertNotLocked(account, ip),
    ).rejects.toBeInstanceOf(HttpException);

    // Tick past the 15 minute soft-lock duration.
    redis.tickSeconds(15 * 60 + 1);

    await expect(
      service.assertNotLocked(account, ip),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// 2. Hard lock — 10 failures in 60 min → ACCOUNT_LOCKED_HARD
// ---------------------------------------------------------------------

describe('AuthHardeningService — hard lockout (10 fails / 60 min → email unlock)', () => {
  it('locks the account on the 10th failure with code ACCOUNT_LOCKED_HARD', async () => {
    const { service } = buildService();
    const account = 'hard@example.com';
    const ip = '203.0.113.10';

    await recordFailures(service, account, ip, 9, {
      userId: 'user-1',
      email: account,
    });
    const tenth = await service.recordFailure(account, ip, {
      userId: 'user-1',
      email: account,
    });

    expect(tenth.accountLock).not.toBeNull();
    expect(tenth.accountLock!.code).toBe('ACCOUNT_LOCKED_HARD');
  });

  it('emits a security.account_unlock_requested outbox event when the hard lock fires', async () => {
    const { service, outbox } = buildService();
    const account = 'hardemail@example.com';
    const ip = '203.0.113.11';

    await recordFailures(service, account, ip, 10, {
      userId: 'user-2',
      email: account,
    });

    expect(outbox.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        topic: 'security.account_unlock_requested',
        payload: expect.objectContaining({
          userId: 'user-2',
          email: account,
          token: expect.any(String),
          ttlSeconds: 15 * 60,
        }),
      }),
    );
  });

  it('writes a security.account_hard_locked audit row at the threshold', async () => {
    const { service, audit } = buildService();
    const account = 'hardaudit@example.com';
    const ip = '203.0.113.12';

    await recordFailures(service, account, ip, 10, {
      userId: 'user-3',
      email: account,
    });

    const hardLockedCalls = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.account_hard_locked',
    );
    expect(hardLockedCalls.length).toBeGreaterThanOrEqual(1);
    expect(hardLockedCalls[0]![3]).toMatchObject({
      threshold: 10,
      failures60m: expect.any(Number),
    });
  });

  it('details.requiresEmailUnlock is true when the hard-lock 429 fires', async () => {
    const { service } = buildService();
    const account = 'hardflag@example.com';
    const ip = '203.0.113.13';

    await recordFailures(service, account, ip, 10, {
      userId: 'user-4',
      email: account,
    });

    try {
      await service.assertNotLocked(account, ip);
      fail('expected HttpException');
    } catch (err) {
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('ACCOUNT_LOCKED_HARD');
      expect(body['details']).toMatchObject({
        requiresEmailUnlock: true,
      });
    }
  });
});

// ---------------------------------------------------------------------
// 3. IP block — 50 failures from one IP in 60 min → 24h deny-list
// ---------------------------------------------------------------------

describe('AuthHardeningService — per-IP block triggers', () => {
  it('blocks the IP after 20 failures in 5 min with code IP_BLOCKED_TEMP', async () => {
    const { service } = buildService();
    const ip = '203.0.113.20';
    // Use a single email so the credential-stuffing path stays at
    // cardinality 1 and the IP rate-block path is the only trigger.
    // The per-account counter saturates well before 20 — that's a
    // separate code path and does not affect what we're asserting on
    // here (the IP-level state).
    const account = 'lone@example.com';

    for (let i = 0; i < 19; i++) {
      const result = await service.recordFailure(account, ip);
      expect(result.ipLock).toBeNull();
    }

    const tripping = await service.recordFailure(account, ip);
    expect(tripping.ipLock).not.toBeNull();
    expect(tripping.ipLock!.code).toBe('IP_BLOCKED_TEMP');

    const remainingSec =
      (tripping.ipLock!.until.getTime() - Date.now()) / 1000;
    expect(remainingSec).toBeGreaterThan(15 * 60 - 5);
    expect(remainingSec).toBeLessThanOrEqual(15 * 60 + 1);
  });

  it('deny-lists the IP for 24h after 50 failures in 60 min with code IP_DENYLISTED', async () => {
    const { service, audit } = buildService();
    const ip = '203.0.113.21';

    // The IP_DENYLIST_THRESHOLD is 50 — drive 50 failures from
    // a single account so we don't conflate with credential
    // stuffing, but the per-account counter saturates well before
    // we reach 50, so the per-account lockout markers are written
    // first (we only assert on the IP path).
    for (let i = 0; i < 49; i++) {
      await service.recordFailure('victim@example.com', ip);
    }
    const tripping = await service.recordFailure('victim@example.com', ip);

    expect(tripping.ipLock).not.toBeNull();
    expect(tripping.ipLock!.code).toBe('IP_DENYLISTED');

    const remainingSec =
      (tripping.ipLock!.until.getTime() - Date.now()) / 1000;
    // 24h deny-list — broad jitter tolerance.
    expect(remainingSec).toBeGreaterThan(24 * 60 * 60 - 60);
    expect(remainingSec).toBeLessThanOrEqual(24 * 60 * 60 + 1);

    const denyAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.ip_denylisted',
    );
    expect(denyAudits).toHaveLength(1);
  });

  it('asserts the IP block on a fresh, unrelated account from the same IP', async () => {
    const { service } = buildService();
    const ip = '203.0.113.22';

    // Saturate the IP via 50 failures distributed across one account.
    await recordFailures(service, 'u@example.com', ip, 50);

    // Fresh account from the same IP — must hit the IP block.
    await expect(
      service.assertNotLocked('clean@example.com', ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: expect.stringMatching(/IP_/),
      }),
    });
  });
});

// ---------------------------------------------------------------------
// 4. Credential stuffing — 10+ distinct emails in 5 min from one IP
// ---------------------------------------------------------------------

describe('AuthHardeningService — credential-stuffing detection', () => {
  it('flags CREDENTIAL_STUFFING_BLOCKED on the 10th distinct email in 5 min', async () => {
    const { service, audit } = buildService();
    const ip = '203.0.113.30';

    // 9 distinct emails — under the threshold.
    for (let i = 0; i < 9; i++) {
      const r = await service.recordFailure(`u${i}@example.com`, ip);
      expect(r.credentialStuffingDetected).toBe(false);
    }

    // 10th distinct email — should fire.
    const tripping = await service.recordFailure('u9@example.com', ip);
    expect(tripping.credentialStuffingDetected).toBe(true);
    expect(tripping.ipLock).not.toBeNull();
    expect(tripping.ipLock!.code).toBe('CREDENTIAL_STUFFING_BLOCKED');

    const csAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.credential_stuffing',
    );
    expect(csAudits).toHaveLength(1);
    expect(csAudits[0]![3]).toMatchObject({
      ip,
      distinctEmails: 10,
      threshold: 10,
      windowSec: 5 * 60,
    });
  });

  it('does NOT flag credential stuffing when the same email retries many times', async () => {
    const { service, audit } = buildService();
    const ip = '203.0.113.31';
    const account = 'sticky@example.com';

    for (let i = 0; i < 12; i++) {
      const r = await service.recordFailure(account, ip);
      expect(r.credentialStuffingDetected).toBe(false);
    }
    const csAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.credential_stuffing',
    );
    expect(csAudits).toHaveLength(0);
  });

  it('writes exactly one credential-stuffing audit row per IP per window', async () => {
    const { service, audit } = buildService();
    const ip = '203.0.113.32';

    // 15 distinct emails — five tripping attempts past the threshold.
    for (let i = 0; i < 15; i++) {
      await service.recordFailure(`u${i}@example.com`, ip);
    }

    const csAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.credential_stuffing',
    );
    expect(csAudits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// 5. Successful login clears the per-account counter
// ---------------------------------------------------------------------

describe('AuthHardeningService — recordSuccess clears account state', () => {
  it('wipes the per-account counter on success', async () => {
    const { service } = buildService();
    const account = 'reset@example.com';
    const ip = '203.0.113.40';

    // 4 failures — one short of the soft lock.
    await recordFailures(service, account, ip, 4);

    await service.recordSuccess(account, ip);

    // After success the user starts from scratch — record 4 more
    // and assert no lock yet.
    for (let i = 0; i < 4; i++) {
      const r = await service.recordFailure(account, ip);
      expect(r.accountLock).toBeNull();
    }
  });

  it('clears any existing soft-lock marker on success', async () => {
    const { service } = buildService();
    const account = 'unlock@example.com';
    const ip = '203.0.113.41';

    await recordFailures(service, account, ip, 5);

    await expect(
      service.assertNotLocked(account, ip),
    ).rejects.toBeInstanceOf(HttpException);

    await service.recordSuccess(account, ip);

    await expect(
      service.assertNotLocked(account, ip),
    ).resolves.toBeUndefined();
  });

  it('does NOT clear the per-IP counter on success (IP tracks abuse, not the user)', async () => {
    const { service } = buildService();
    const ip = '203.0.113.42';

    // Drive 19 failures from distinct emails to come right up to the
    // 20-fails-in-5-min IP-block edge.
    for (let i = 0; i < 19; i++) {
      await service.recordFailure(`u${i}@example.com`, ip);
    }

    // A successful login on one of those accounts.
    await service.recordSuccess('u0@example.com', ip);

    // The IP counter must still be at 19 — the next single failure
    // from a fresh email still pushes it over the threshold.
    const tripping = await service.recordFailure('fresh@example.com', ip);
    expect(tripping.ipLock).not.toBeNull();
  });
});

// ---------------------------------------------------------------------
// 6. Unlock token works once and expires after 15 min
// ---------------------------------------------------------------------

describe('AuthHardeningService — unlock token flow', () => {
  it('issues a token, accepts it once, and rejects subsequent uses (one-shot)', async () => {
    const { service } = buildService();
    const userId = 'user-unlock-1';
    const account = 'unlock1@example.com';
    const ip = '203.0.113.50';

    // Drive a hard lock first so the account is genuinely locked.
    await recordFailures(service, account, ip, 10, { userId, email: account });

    // The unlock email writes a token internally; for the unit
    // assertion we issue one explicitly so we capture the raw token.
    const token = await service.issueUnlockToken(userId, account, ip);

    const first = await service.consumeUnlockToken(token);
    expect(first.unlocked).toBe(true);
    expect(first.userId).toBe(userId);

    // Second use must fail.
    const second = await service.consumeUnlockToken(token);
    expect(second.unlocked).toBe(false);
    expect(second.userId).toBeNull();
  });

  it('rejects an unknown token without exposing whether the user exists', async () => {
    const { service } = buildService();
    const result = await service.consumeUnlockToken('not-a-real-token');
    expect(result.unlocked).toBe(false);
    expect(result.userId).toBeNull();
  });

  it('lets the user log in again once the token has been consumed', async () => {
    const { service } = buildService();
    const userId = 'user-unlock-2';
    const account = 'unlock2@example.com';
    const ip = '203.0.113.51';

    await recordFailures(service, account, ip, 10, { userId, email: account });

    const token = await service.issueUnlockToken(userId, account, ip);

    // Hard-locked before the token is consumed (assert on the userId
    // since that's what consumeUnlockToken keys on internally).
    await expect(
      service.assertNotLocked(userId, ip),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACCOUNT_LOCKED_HARD' }),
    });

    await service.consumeUnlockToken(token);

    await expect(
      service.assertNotLocked(userId, ip),
    ).resolves.toBeUndefined();
  });

  it('expires the token after 15 minutes', async () => {
    const { service, redis } = buildService();
    const userId = 'user-unlock-3';
    const account = 'unlock3@example.com';
    const ip = '203.0.113.52';

    const token = await service.issueUnlockToken(userId, account, ip);

    // Tick past the 15-minute TTL.
    redis.tickSeconds(15 * 60 + 1);

    const result = await service.consumeUnlockToken(token);
    expect(result.unlocked).toBe(false);
    expect(result.userId).toBeNull();
  });

  it('re-issuing invalidates the previous token (only the latest is valid)', async () => {
    const { service } = buildService();
    const userId = 'user-unlock-4';
    const account = 'unlock4@example.com';
    const ip = '203.0.113.53';

    const oldToken = await service.issueUnlockToken(userId, account, ip);
    const newToken = await service.issueUnlockToken(userId, account, ip);

    expect(oldToken).not.toBe(newToken);

    const oldResult = await service.consumeUnlockToken(oldToken);
    expect(oldResult.unlocked).toBe(false);

    const newResult = await service.consumeUnlockToken(newToken);
    expect(newResult.unlocked).toBe(true);
  });

  it('writes a security.account_unlocked audit row when a token is consumed', async () => {
    const { service, audit } = buildService();
    const userId = 'user-unlock-5';
    const account = 'unlock5@example.com';
    const ip = '203.0.113.54';

    const token = await service.issueUnlockToken(userId, account, ip);
    await service.consumeUnlockToken(token);

    const unlockedAudits = audit.log.mock.calls.filter(
      (call) => call[1] === 'security.account_unlocked',
    );
    expect(unlockedAudits).toHaveLength(1);
    expect(unlockedAudits[0]![3]).toMatchObject({
      userId,
      via: 'email_unlock_token',
    });
  });
});

// ---------------------------------------------------------------------
// Fail-open without Redis
// ---------------------------------------------------------------------

describe('AuthHardeningService — fail-open without Redis', () => {
  it('never throws and always returns null state when Redis is missing', async () => {
    const { service } = buildService({ withRedis: false });

    await expect(
      service.assertNotLocked('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    const result = await service.recordFailure('a@example.com', '127.0.0.1');
    expect(result).toEqual({
      accountLock: null,
      ipLock: null,
      credentialStuffingDetected: false,
    });

    await expect(
      service.recordSuccess('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    await expect(
      service.consumeUnlockToken('any-token'),
    ).resolves.toEqual({ unlocked: false, userId: null });
  });
});
