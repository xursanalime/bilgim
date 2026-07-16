import { AdminAuditService } from '../../admin/admin-audit.service';
import { RedisService } from '../../../infra/redis/redis.service';
import { CredentialStuffingDetector } from './credential-stuffing.detector';

/**
 * Unit-test the credential-stuffing detector (Task 27.2, Req 27.9).
 *
 * The detector tracks distinct emails per IP via Redis SET ops
 * (`SADD`, `SCARD`). Instead of a real Redis we run an in-memory
 * fake that supports the four operations we actually use:
 * `getClient().sadd / scard / expire`, plus the `setnx` debounce
 * marker.
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

  tickSeconds(seconds: number): void {
    this.clockOffsetMs += seconds * 1000;
  }

  // ---- ioredis-shaped client ----
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

  async get(key: string): Promise<string | null> {
    this.purgeExpired();
    return this.kv.get(key)?.value ?? null;
  }

  async exists(key: string): Promise<boolean> {
    this.purgeExpired();
    return this.kv.has(key) || this.sets.has(key);
  }

  /** Test helper — current cardinality of the set under `key`. */
  setSize(key: string): number {
    this.purgeExpired();
    return this.sets.get(key)?.members.size ?? 0;
  }

  /** Test helper — bypass the public API and read the marker. */
  hasDetectedMarker(key: string): boolean {
    this.purgeExpired();
    return this.kv.has(key);
  }
}

function buildAuditService(): jest.Mocked<AdminAuditService> {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
}

interface BuildOpts {
  withRedis?: boolean;
  threshold?: number;
}

interface BuildResult {
  detector: CredentialStuffingDetector;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
}

function buildDetector(opts: BuildOpts = {}): BuildResult {
  const redis = new FakeRedis();
  const audit = buildAuditService();
  const config = {
    get: (key: string) =>
      opts.threshold !== undefined &&
      key === 'CREDENTIAL_STUFFING_DISTINCT_EMAILS_PER_HOUR'
        ? opts.threshold
        : undefined,
  } as any;
  const detector = new CredentialStuffingDetector(
    opts.withRedis === false
      ? undefined
      : (redis as unknown as RedisService),
    audit,
    opts.threshold !== undefined ? config : undefined,
  );
  return { detector, redis, audit };
}

describe('CredentialStuffingDetector — distinct-emails counter (Task 27.2)', () => {
  it('counts the number of distinct emails per IP', async () => {
    const { detector, redis } = buildDetector();
    const ip = '203.0.113.100';

    const r1 = await detector.recordAttempt('a@example.com', ip);
    expect(r1.distinctEmails).toBe(1);
    expect(r1.detected).toBe(false);

    const r2 = await detector.recordAttempt('b@example.com', ip);
    expect(r2.distinctEmails).toBe(2);

    // Same email twice — no new distinct entry.
    const r3 = await detector.recordAttempt('a@example.com', ip);
    expect(r3.distinctEmails).toBe(2);

    expect(redis.setSize(`credstuff:emails:${ip}`)).toBe(2);
  });

  it('counts emails per IP independently', async () => {
    const { detector } = buildDetector();
    const ipA = '203.0.113.110';
    const ipB = '203.0.113.111';

    await detector.recordAttempt('shared@example.com', ipA);
    await detector.recordAttempt('shared@example.com', ipB);
    await detector.recordAttempt('only-a@example.com', ipA);

    expect(await detector.distinctEmailsForIp(ipA)).toBe(2);
    expect(await detector.distinctEmailsForIp(ipB)).toBe(1);
  });

  it('normalises emails to lowercase so case variations dont inflate the count', async () => {
    const { detector } = buildDetector();
    const ip = '203.0.113.112';

    await detector.recordAttempt('User@Example.com', ip);
    const second = await detector.recordAttempt('user@example.com', ip);

    expect(second.distinctEmails).toBe(1);
  });
});

describe('CredentialStuffingDetector — threshold trigger (Req 27.9)', () => {
  it('flags the IP only when the count strictly exceeds the threshold', async () => {
    const threshold = 5;
    const { detector, audit } = buildDetector({ threshold });
    const ip = '203.0.113.120';

    // Five distinct emails — at threshold, NOT yet detected.
    for (let i = 0; i < threshold; i++) {
      const r = await detector.recordAttempt(`u${i}@example.com`, ip);
      expect(r.detected).toBe(false);
    }
    expect(audit.log).not.toHaveBeenCalled();

    // The sixth distinct email crosses (>5).
    const tripping = await detector.recordAttempt('u5@example.com', ip);
    expect(tripping.detected).toBe(true);
    expect(tripping.distinctEmails).toBe(threshold + 1);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      null,
      'security.credential_stuffing_detected',
      ip,
      expect.objectContaining({
        ip,
        attemptedEmails: threshold + 1,
        threshold,
      }),
      { ip },
    );
  });

  it('writes exactly one audit row per IP per window even after many crossings', async () => {
    const threshold = 3;
    const { detector, audit } = buildDetector({ threshold });
    const ip = '203.0.113.121';

    for (let i = 0; i < threshold + 5; i++) {
      await detector.recordAttempt(`u${i}@example.com`, ip);
    }

    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('uses the spec default threshold of 20 when none is configured', async () => {
    const { detector, audit } = buildDetector(); // no threshold override
    expect(detector.getThreshold()).toBe(20);

    const ip = '203.0.113.122';
    // 20 distinct attempts — no detection.
    for (let i = 0; i < 20; i++) {
      await detector.recordAttempt(`u${i}@example.com`, ip);
    }
    expect(audit.log).not.toHaveBeenCalled();

    // 21st distinct email → detected.
    const trip = await detector.recordAttempt('u20@example.com', ip);
    expect(trip.detected).toBe(true);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('writes to AdminAuditLog with the full payload shape (ip, count, threshold, window)', async () => {
    const { detector, audit } = buildDetector({ threshold: 2 });
    const ip = '198.51.100.5';

    await detector.recordAttempt('a@example.com', ip);
    await detector.recordAttempt('b@example.com', ip);
    await detector.recordAttempt('c@example.com', ip);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const [actorId, action, target, payload, ctx] = audit.log.mock.calls[0]!;
    expect(actorId).toBeNull();
    expect(action).toBe('security.credential_stuffing_detected');
    expect(target).toBe(ip);
    expect(payload).toMatchObject({
      ip,
      attemptedEmails: 3,
      threshold: 2,
      windowSec: 60 * 60,
      detectedAt: expect.any(String),
    });
    expect(ctx).toEqual({ ip });
  });

  it('does not crash when no AdminAuditService is wired', async () => {
    const redis = new FakeRedis();
    const detector = new CredentialStuffingDetector(
      redis as unknown as RedisService,
      undefined,
    );

    const ip = '203.0.113.130';
    for (let i = 0; i <= 20; i++) {
      const r = await detector.recordAttempt(`u${i}@example.com`, ip);
      expect(typeof r.detected).toBe('boolean');
    }
  });
});

describe('CredentialStuffingDetector — fail-open without Redis', () => {
  it('returns a no-op result and never throws when Redis is missing', async () => {
    const { detector } = buildDetector({ withRedis: false });

    const r = await detector.recordAttempt('a@example.com', '127.0.0.1');
    expect(r).toEqual({ distinctEmails: 0, detected: false });

    expect(await detector.distinctEmailsForIp('127.0.0.1')).toBe(0);
  });

  it('skips empty inputs gracefully', async () => {
    const { detector, audit } = buildDetector();
    const r1 = await detector.recordAttempt('', '203.0.113.140');
    const r2 = await detector.recordAttempt('a@example.com', '');
    expect(r1.detected).toBe(false);
    expect(r2.detected).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('CredentialStuffingDetector — window expiry', () => {
  it('the per-IP set auto-expires after the rolling window', async () => {
    const { detector, redis } = buildDetector({ threshold: 2 });
    const ip = '203.0.113.150';

    await detector.recordAttempt('a@example.com', ip);
    await detector.recordAttempt('b@example.com', ip);
    expect(await detector.distinctEmailsForIp(ip)).toBe(2);

    // Fast-forward past the 1-hour window.
    redis.tickSeconds(60 * 60 + 1);

    expect(await detector.distinctEmailsForIp(ip)).toBe(0);
  });
});
