import { RedisService } from '../../../infra/redis/redis.service';
import { FingerprintService } from './fingerprint.service';
import type { DeviceFingerprintPayload } from './types';

/**
 * Unit tests for `FingerprintService` (Task 27.4, Req 27.6).
 *
 * Coverage:
 *   - `hash()` is stable + normalises whitespace / case before hashing.
 *   - `record()` adds the identity / IP to the per-fingerprint sets and
 *     refreshes the TTL.
 *   - Suspicion threshold flips after the fifth distinct identity inside
 *     the 30-day window — corresponds to the "1 fingerprint → 5 users
 *     within 1h" scenario in the task body.
 *   - `check()` is read-only — never mutates the stored sets.
 *   - Redis outages fail open (`suspicious: false`).
 */

// ---------------------------------------------------------------------
// Fake Redis — minimal SET/SCARD/EXPIRE surface used by the service.
// ---------------------------------------------------------------------

interface SetEntry {
  members: Set<string>;
  expiresAt: number | null;
}

class FakeRedis {
  private sets = new Map<string, SetEntry>();
  private offsetMs = 0;

  private now(): number {
    return Date.now() + this.offsetMs;
  }

  private purge(): void {
    const t = this.now();
    for (const [k, v] of this.sets) {
      if (v.expiresAt !== null && v.expiresAt <= t) this.sets.delete(k);
    }
  }

  ttlOf(key: string): number | null {
    return this.sets.get(key)?.expiresAt ?? null;
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
    expire: async (key: string, ttl: number): Promise<number> => {
      this.purge();
      const set = this.sets.get(key);
      if (!set) return 0;
      set.expiresAt = this.now() + ttl * 1000;
      return 1;
    },
  };

  getClient(): typeof this.client {
    return this.client;
  }
}

function asRedis(fake: FakeRedis): RedisService {
  return fake as unknown as RedisService;
}

function payload(): DeviceFingerprintPayload {
  return {
    canvasHash: 'abcdef',
    fonts: 'Arial,Helvetica,Verdana',
    screen: '1920x1080',
    timezone: 'Asia/Tashkent',
    language: 'en-US',
  };
}

// =====================================================================
// `hash()` is stable
// =====================================================================

describe('FingerprintService — hash()', () => {
  it('returns the same SHA-256 hash for two payloads with whitespace / case differences', () => {
    const a = payload();
    const b: DeviceFingerprintPayload = {
      ...payload(),
      fonts: '  ARIAL,helvetica,verdana  ',
      language: 'EN-US',
    };
    expect(FingerprintService.hash(a)).toBe(FingerprintService.hash(b));
  });

  it('returns a 64-char hex string', () => {
    const hash = FingerprintService.hash(payload());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any meaningful field changes', () => {
    const baseline = FingerprintService.hash(payload());
    const variants: DeviceFingerprintPayload[] = [
      { ...payload(), canvasHash: 'different' },
      { ...payload(), screen: '800x600' },
      { ...payload(), timezone: 'UTC' },
    ];
    for (const v of variants) {
      expect(FingerprintService.hash(v)).not.toBe(baseline);
    }
  });
});

// =====================================================================
// `record()` adds + refreshes the TTL
// =====================================================================

describe('FingerprintService — record()', () => {
  it('adds the user identity + IP and refreshes the 30-day TTL', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));

    const result = await service.record(payload(), {
      userId: 'user-1',
      ip: '203.0.113.10',
    });

    expect(result.distinctIdentities).toBe(1);
    expect(result.distinctIps).toBe(1);
    expect(result.suspicious).toBe(false);

    const usersTtl = fake.ttlOf(`fp:${result.fingerprintHash}:users`);
    const ipsTtl = fake.ttlOf(`fp:${result.fingerprintHash}:ips`);
    expect(usersTtl).not.toBeNull();
    expect(ipsTtl).not.toBeNull();
    // Roughly 30 days from now (allow ±10s for slow CI).
    const expected = Date.now() + FingerprintService.TTL_SECONDS * 1000;
    expect(Math.abs((usersTtl as number) - expected)).toBeLessThan(10_000);
  });

  it('flips `suspicious` after 5 distinct identities for one fingerprint', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));
    const fp = payload();

    let result;
    for (let i = 1; i <= 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      result = await service.record(fp, {
        userId: `user-${i}`,
        ip: `203.0.113.${i}`,
      });
    }

    expect(result!.distinctIdentities).toBe(5);
    expect(result!.suspicious).toBe(true);
  });

  it('treats anonymous traffic without a userId as ip-keyed identities', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));

    const result1 = await service.record(payload(), {
      userId: null,
      ip: '203.0.113.10',
    });
    const result2 = await service.record(payload(), {
      userId: null,
      ip: '203.0.113.10',
    });

    // Same IP / no user → same identity bucket → still 1 distinct identity.
    expect(result1.distinctIdentities).toBe(1);
    expect(result2.distinctIdentities).toBe(1);
  });

  it('returns a non-suspicious snapshot when Redis is unwired', async () => {
    const service = new FingerprintService();
    const result = await service.record(payload(), {
      userId: 'u',
      ip: '1.2.3.4',
    });
    expect(result.suspicious).toBe(false);
    expect(result.distinctIdentities).toBe(0);
  });

  it('fails open when the Redis client throws', async () => {
    const broken = {
      getClient: () => ({
        sadd: jest.fn().mockRejectedValue(new Error('redis down')),
        scard: jest.fn(),
        expire: jest.fn(),
      }),
    } as unknown as RedisService;
    const service = new FingerprintService(broken);

    const result = await service.record(payload(), {
      userId: 'u',
      ip: '1.2.3.4',
    });
    expect(result.suspicious).toBe(false);
    expect(result.distinctIdentities).toBe(0);
  });
});

// =====================================================================
// `check()` is read-only
// =====================================================================

describe('FingerprintService — check()', () => {
  it('returns the current cardinality without mutating the sets', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));

    // Seed 3 distinct users for the same fingerprint.
    for (let i = 1; i <= 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      await service.record(payload(), {
        userId: `user-${i}`,
        ip: '203.0.113.10',
      });
    }
    const hash = FingerprintService.hash(payload());

    // First check() reads through.
    const first = await service.check(hash);
    expect(first.distinctIdentities).toBe(3);

    // Second check() returns the same value — no mutation.
    const second = await service.check(hash);
    expect(second.distinctIdentities).toBe(3);
  });

  it('returns an empty snapshot for a hash never seen before', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));

    const result = await service.check('never-seen-hash');
    expect(result.distinctIdentities).toBe(0);
    expect(result.suspicious).toBe(false);
  });

  it('returns an empty snapshot for whitespace-only hashes', async () => {
    const fake = new FakeRedis();
    const service = new FingerprintService(asRedis(fake));

    const result = await service.check('   ');
    expect(result.fingerprintHash).toBe('');
    expect(result.suspicious).toBe(false);
  });
});
