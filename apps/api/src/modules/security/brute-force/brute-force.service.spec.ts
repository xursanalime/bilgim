import { HttpException, HttpStatus } from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';
import { AdminAuditService } from '../../admin/admin-audit.service';
import {
  AdminNotifier,
  BruteForceService,
} from './brute-force.service';

/**
 * Unit tests for the new `modules/security/brute-force` service
 * (Task 27.2, Requirements 27.4, 27.5, 27.9).
 *
 * Covers the state machine:
 *   - 5 fails in 15 min → TEMP_LOCKED for 30 min, captcha required.
 *   - 3 more fails while TEMP_LOCKED → PERM_LOCKED + admin alert.
 *   - successful login resets every counter and clears both locks.
 *   - 10+ distinct accounts from same IP in 1 h → IP_BLOCKED 24 h.
 */

interface KvEntry {
  value: string;
  expiresAt: number | null;
}
interface SetEntry {
  members: Set<string>;
  expiresAt: number | null;
}

class FakeRedis {
  private kv = new Map<string, KvEntry>();
  private sets = new Map<string, SetEntry>();
  private offsetMs = 0;

  private now(): number {
    return Date.now() + this.offsetMs;
  }

  private purge(): void {
    const t = this.now();
    for (const [k, v] of this.kv) {
      if (v.expiresAt !== null && v.expiresAt <= t) this.kv.delete(k);
    }
    for (const [k, v] of this.sets) {
      if (v.expiresAt !== null && v.expiresAt <= t) this.sets.delete(k);
    }
  }

  /** Fast-forward the fake clock. */
  tickSeconds(seconds: number): void {
    this.offsetMs += seconds * 1000;
  }

  readonly client = {
    sadd: async (key: string, member: string): Promise<number> => {
      this.purge();
      const set = this.sets.get(key) ?? {
        members: new Set<string>(),
        expiresAt: null,
      };
      const isNew = !set.members.has(member);
      set.members.add(member);
      this.sets.set(key, set);
      return isNew ? 1 : 0;
    },
    scard: async (key: string): Promise<number> => {
      this.purge();
      return this.sets.get(key)?.members.size ?? 0;
    },
    expire: async (
      key: string,
      ttl: number,
      mode?: 'NX' | 'XX',
    ): Promise<number> => {
      this.purge();
      const set = this.sets.get(key);
      if (!set) return 0;
      if (mode === 'NX' && set.expiresAt !== null) return 0;
      set.expiresAt = this.now() + ttl * 1000;
      return 1;
    },
  };

  getClient(): typeof this.client {
    return this.client;
  }

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

  async setnx(key: string, value: string, ttl: number): Promise<boolean> {
    this.purge();
    if (this.kv.has(key)) return false;
    this.kv.set(key, { value, expiresAt: this.now() + ttl * 1000 });
    return true;
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.purge();
    return this.kv.has(key) || this.sets.has(key);
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

  async publish(): Promise<number> {
    return 0;
  }
}

function buildAudit(): jest.Mocked<AdminAuditService> {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
}

function buildNotifier(): jest.Mocked<AdminNotifier> {
  return {
    notifyAdmins: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminNotifier>;
}

interface Built {
  service: BruteForceService;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
  notifier: jest.Mocked<AdminNotifier>;
}

function build(opts: { withRedis?: boolean } = {}): Built {
  const redis = new FakeRedis();
  const audit = buildAudit();
  const notifier = buildNotifier();
  const service = new BruteForceService(
    opts.withRedis === false ? undefined : (redis as unknown as RedisService),
    audit,
    notifier,
  );
  return { service, redis, audit, notifier };
}

async function failNTimes(
  service: BruteForceService,
  email: string,
  ip: string,
  count: number,
) {
  const out: Array<Awaited<ReturnType<BruteForceService['recordFailedAttempt']>>> = [];
  for (let i = 0; i < count; i++) {
    out.push(await service.recordFailedAttempt(email, ip));
  }
  return out;
}

describe('BruteForceService — per-account state machine', () => {
  it('keeps the account in NORMAL state for the first 4 failures', async () => {
    const { service } = build();
    const results = await failNTimes(service, 'a@example.com', '203.0.113.1', 4);
    for (const r of results) {
      expect(r.status).toBe('NORMAL');
      expect(r.captchaRequired).toBe(false);
    }
  });

  it('flips the account to TEMP_LOCKED on the 5th failure within 15 min', async () => {
    const { service, audit } = build();
    const email = 'temp@example.com';
    const ip = '203.0.113.2';
    await failNTimes(service, email, ip, 4);

    const trip = await service.recordFailedAttempt(email, ip);
    expect(trip.status).toBe('TEMP_LOCKED');
    expect(trip.captchaRequired).toBe(true);
    expect(trip.remainingMs).toBeGreaterThan(0);

    // 30-min lock — allow generous CI clock slack.
    const sec = (trip.remainingMs ?? 0) / 1000;
    expect(sec).toBeGreaterThan(30 * 60 - 5);
    expect(sec).toBeLessThanOrEqual(30 * 60 + 1);

    // Single audit row written for the TEMP_LOCKED transition.
    expect(audit.log).toHaveBeenCalledWith(
      null,
      BruteForceService.ACTION_TEMP_LOCKED,
      email,
      expect.objectContaining({
        email,
        fails: 5,
        threshold: BruteForceService.TEMP_LOCK_THRESHOLD,
      }),
    );
  });

  it('escalates to PERM_LOCKED after 3 more failures while TEMP_LOCKED', async () => {
    const { service, audit, notifier } = build();
    const email = 'perm@example.com';
    const ip = '203.0.113.3';
    // Trip the temp-lock first.
    await failNTimes(service, email, ip, 5);
    audit.log.mockClear(); // ignore the TEMP_LOCKED row for clarity

    const a = await service.recordFailedAttempt(email, ip);
    expect(a.status).toBe('TEMP_LOCKED');
    const b = await service.recordFailedAttempt(email, ip);
    expect(b.status).toBe('TEMP_LOCKED');
    const c = await service.recordFailedAttempt(email, ip);
    expect(c.status).toBe('PERM_LOCKED');
    expect(c.captchaRequired).toBe(true);

    // Audit row written for the PERM_LOCKED transition.
    expect(audit.log).toHaveBeenCalledWith(
      null,
      BruteForceService.ACTION_PERM_LOCKED,
      email,
      expect.objectContaining({
        email,
        lockedFails: 3,
        threshold: BruteForceService.PERM_LOCK_THRESHOLD,
      }),
    );
    // Admin notification fan-out fired.
    expect(notifier.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        email,
        reason: expect.stringMatching(/permanently locked/i),
      }),
    );
  });
});

describe('BruteForceService — recordSuccessfulLogin clears state', () => {
  it('clears every counter and lock so subsequent failures start over', async () => {
    const { service } = build();
    const email = 'reset@example.com';
    const ip = '203.0.113.4';

    await failNTimes(service, email, ip, 5); // TEMP_LOCKED
    let status = await service.checkAccountStatus(email);
    expect(status.status).toBe('TEMP_LOCKED');

    await service.recordSuccessfulLogin(email, ip);

    status = await service.checkAccountStatus(email);
    expect(status.status).toBe('NORMAL');
    expect(status.captchaRequired).toBe(false);

    // 4 fresh failures stay below threshold (counter was reset).
    const results = await failNTimes(service, email, ip, 4);
    for (const r of results) expect(r.status).toBe('NORMAL');
  });

  it('keeps the per-IP credential-stuffing tracker after a successful login', async () => {
    // The IP set tracks attacker activity across many emails — a
    // successful login on one account must not erase it.
    const { service } = build();
    const ip = '203.0.113.5';
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(`stuf-${i}@example.com`, ip);
    }
    await service.recordSuccessfulLogin('stuf-0@example.com', ip);

    const status = await service.checkIpStatus(ip);
    expect(status.distinctAccounts).toBeGreaterThanOrEqual(5);
    expect(status.blocked).toBe(false);
  });
});

describe('BruteForceService — credential stuffing IP block', () => {
  it('blocks the IP once 10 distinct accounts have been attempted', async () => {
    const { service, audit, notifier } = build();
    const ip = '198.51.100.10';

    // 9 distinct accounts — under threshold, no block.
    for (let i = 0; i < 9; i++) {
      const r = await service.recordFailedAttempt(
        `stuff-${i}@example.com`,
        ip,
      );
      expect(r.status).toBe('NORMAL');
    }
    expect((await service.checkIpStatus(ip)).blocked).toBe(false);

    // 10th distinct account trips the >=10 threshold.
    await service.recordFailedAttempt('stuff-10@example.com', ip);

    const status = await service.checkIpStatus(ip);
    expect(status.blocked).toBe(true);
    expect(status.distinctAccounts).toBe(10);

    // 24-hour lockout (with CI slack).
    const sec = (status.remainingMs ?? 0) / 1000;
    expect(sec).toBeGreaterThan(24 * 60 * 60 - 60);

    // One audit row + one admin notification for the IP block.
    expect(audit.log).toHaveBeenCalledWith(
      null,
      BruteForceService.ACTION_IP_BLOCKED,
      ip,
      expect.objectContaining({
        ip,
        distinctAccounts: 10,
        threshold: BruteForceService.CS_DISTINCT_ACCOUNTS,
      }),
      { ip },
    );
    expect(notifier.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringMatching(/credential stuffing/i),
      }),
    );
  });

  it('the credential-stuffing window expires after 1 hour', async () => {
    const { service, redis } = build();
    const ip = '198.51.100.20';

    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(`exp-${i}@example.com`, ip);
    }
    expect((await service.checkIpStatus(ip)).distinctAccounts).toBe(5);

    redis.tickSeconds(BruteForceService.CS_WINDOW_SEC + 1);

    const status = await service.checkIpStatus(ip);
    expect(status.distinctAccounts).toBeUndefined();
    expect(status.blocked).toBe(false);
  });
});

describe('BruteForceService — assertNotBlocked', () => {
  it('throws 403 ACCOUNT_LOCKED when the account is TEMP_LOCKED', async () => {
    const { service } = build();
    const email = 'gate@example.com';
    const ip = '203.0.113.6';
    await failNTimes(service, email, ip, 5);

    try {
      await service.assertNotBlocked(email, ip);
      fail('expected assertNotBlocked to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('ACCOUNT_LOCKED');
      expect(body['details']).toMatchObject({
        captchaRequired: true,
        retryAfter: expect.any(Number),
      });
    }
  });

  it('throws 403 IP_BLOCKED when the IP is credential-stuffing-blocked', async () => {
    const { service } = build();
    const ip = '198.51.100.30';
    for (let i = 0; i < 10; i++) {
      await service.recordFailedAttempt(`s-${i}@example.com`, ip);
    }
    try {
      await service.assertNotBlocked('any@example.com', ip);
      fail('expected assertNotBlocked to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('IP_BLOCKED');
    }
  });

  it('passes through cleanly for a brand-new (email, ip) pair', async () => {
    const { service } = build();
    await expect(
      service.assertNotBlocked('fresh@example.com', '203.0.113.99'),
    ).resolves.toBeUndefined();
  });
});

describe('BruteForceService — fail-open without Redis', () => {
  it('returns NORMAL and never throws when Redis is unavailable', async () => {
    const { service } = build({ withRedis: false });
    const r = await service.recordFailedAttempt('a@example.com', '127.0.0.1');
    expect(r).toEqual({ status: 'NORMAL', captchaRequired: false });

    await expect(
      service.assertNotBlocked('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    await expect(
      service.recordSuccessfulLogin('a@example.com', '127.0.0.1'),
    ).resolves.toBeUndefined();

    expect(await service.checkIpStatus('127.0.0.1')).toEqual({
      blocked: false,
    });
  });
});
