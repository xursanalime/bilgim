import type { ConfigService } from '@nestjs/config';

import {
  TIERED_RATE_LIMITS,
  TieredRateLimiterService,
} from './tiered-rate-limiter.service';

/**
 * Unit tests for the tiered rate limiter (Task 27.1).
 *
 * The tests run against an in-memory Redis mock so we can assert the
 * counter / ban semantics without spinning up a real instance. The
 * mock implements the small subset of `RedisService` the limiter
 * actually uses.
 */

interface StoredValue {
  value: string;
  /** Epoch ms at which the key expires, or `null` for no TTL. */
  expiresAt: number | null;
}

function nowMs(): number {
  return Date.now();
}

class FakeRedisService {
  private store = new Map<string, StoredValue>();

  private nowMs(): number {
    return nowMs();
  }

  private gc(key: string): void {
    const v = this.store.get(key);
    if (v && v.expiresAt !== null && v.expiresAt <= this.nowMs()) {
      this.store.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.gc(key);
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt:
        ttlSeconds && ttlSeconds > 0 ? this.nowMs() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.gc(key);
    return this.store.has(key);
  }

  async incr(key: string): Promise<number> {
    this.gc(key);
    const current = this.store.get(key);
    const next = (current ? Number(current.value) : 0) + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: current?.expiresAt ?? null,
    });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const current = this.store.get(key);
    if (!current) return;
    this.store.set(key, {
      value: current.value,
      expiresAt: this.nowMs() + ttlSeconds * 1000,
    });
  }

  /** Mirrors `redisService.getClient().ttl(key)` semantics. */
  getClient() {
    return {
      ttl: async (key: string): Promise<number> => {
        this.gc(key);
        const v = this.store.get(key);
        if (!v) return -2;
        if (v.expiresAt === null) return -1;
        return Math.max(0, Math.ceil((v.expiresAt - this.nowMs()) / 1000));
      },
    };
  }

  // ---- test helpers ---------------------------------------------
  _peek(key: string): StoredValue | undefined {
    this.gc(key);
    return this.store.get(key);
  }

  _wipe(): void {
    this.store.clear();
  }
}

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('TieredRateLimiterService', () => {
  let redis: FakeRedisService;
  let service: TieredRateLimiterService;

  beforeEach(() => {
    redis = new FakeRedisService();
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig(),
    );
  });

  it('has the documented default limits', () => {
    expect(service.limits.ipBurst).toBe(TIERED_RATE_LIMITS.IP_BURST);
    expect(service.limits.ipGlobal).toBe(TIERED_RATE_LIMITS.IP_GLOBAL);
    expect(service.limits.user).toBe(TIERED_RATE_LIMITS.USER);
  });

  it('allows requests within the burst budget', async () => {
    for (let i = 0; i < TIERED_RATE_LIMITS.IP_BURST; i += 1) {
      const result = await service.consume({ ip: '203.0.113.1' });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeNull();
    }
  });

  it('rejects on the burst+1 request and applies a burst-ban', async () => {
    for (let i = 0; i < TIERED_RATE_LIMITS.IP_BURST; i += 1) {
      await service.consume({ ip: '203.0.113.2' });
    }
    const overage = await service.consume({ ip: '203.0.113.2' });
    expect(overage.allowed).toBe(false);
    expect(overage.reason).toBe('IP_BURST');
    expect(overage.retryAfterSeconds).toBe(
      TIERED_RATE_LIMITS.IP_BURST_BAN_SECONDS,
    );
  });

  it('keeps subsequent requests rejected while the burst-ban is active', async () => {
    for (let i = 0; i < TIERED_RATE_LIMITS.IP_BURST + 1; i += 1) {
      await service.consume({ ip: '203.0.113.3' });
    }
    const stillBlocked = await service.consume({ ip: '203.0.113.3' });
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.reason).toBe('IP_BURST');
    expect(stillBlocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rejects with IP_GLOBAL when the per-minute cap is exceeded but burst is not', async () => {
    // Configure a small global cap so the test stays fast and the
    // burst cap is not the active limit.
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({
        THREAT_RATE_LIMIT_IP_BURST: 100, // unreachable for this test
        THREAT_RATE_LIMIT_IP_GLOBAL: 10,
      }),
    );
    for (let i = 0; i < 10; i += 1) {
      const r = await service.consume({ ip: '203.0.113.4' });
      expect(r.allowed).toBe(true);
    }
    const overage = await service.consume({ ip: '203.0.113.4' });
    expect(overage.allowed).toBe(false);
    expect(overage.reason).toBe('IP_GLOBAL');
  });

  it('rejects with USER reason when the per-user cap is exceeded', async () => {
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({
        THREAT_RATE_LIMIT_IP_BURST: 1000,
        THREAT_RATE_LIMIT_IP_GLOBAL: 1000,
        THREAT_RATE_LIMIT_USER: 5,
      }),
    );
    const caller = { ip: '203.0.113.5', userId: 'user-abc' };
    for (let i = 0; i < 5; i += 1) {
      const r = await service.consume(caller);
      expect(r.allowed).toBe(true);
    }
    const overage = await service.consume(caller);
    expect(overage.allowed).toBe(false);
    expect(overage.reason).toBe('USER');
  });

  it('isolates buckets between distinct IPs', async () => {
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({ THREAT_RATE_LIMIT_IP_BURST: 3 }),
    );
    for (let i = 0; i < 3; i += 1) {
      const r = await service.consume({ ip: '198.51.100.1' });
      expect(r.allowed).toBe(true);
    }
    const blocked = await service.consume({ ip: '198.51.100.1' });
    expect(blocked.allowed).toBe(false);

    // Other IP still has full budget
    const fresh = await service.consume({ ip: '198.51.100.2' });
    expect(fresh.allowed).toBe(true);
  });

  it('isolates buckets between distinct users on the same IP', async () => {
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({
        THREAT_RATE_LIMIT_IP_BURST: 1000,
        THREAT_RATE_LIMIT_IP_GLOBAL: 1000,
        THREAT_RATE_LIMIT_USER: 2,
      }),
    );
    const ip = '198.51.100.10';
    await service.consume({ ip, userId: 'alice' });
    await service.consume({ ip, userId: 'alice' });
    const aliceBlocked = await service.consume({ ip, userId: 'alice' });
    expect(aliceBlocked.allowed).toBe(false);
    expect(aliceBlocked.reason).toBe('USER');

    const bobAllowed = await service.consume({ ip, userId: 'bob' });
    expect(bobAllowed.allowed).toBe(true);
  });

  it('fails open when no Redis service is wired', async () => {
    const noRedis = new TieredRateLimiterService(undefined, makeConfig());
    for (let i = 0; i < 200; i += 1) {
      const r = await noRedis.consume({ ip: '198.51.100.99' });
      expect(r.allowed).toBe(true);
    }
  });

  it('fails open when Redis throws on incr', async () => {
    const flaky = {
      incr: jest.fn().mockRejectedValue(new Error('redis down')),
      expire: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      getClient: () => ({ ttl: async () => -2 }),
    } as unknown as any;
    const failingService = new TieredRateLimiterService(flaky, makeConfig());
    const result = await failingService.consume({ ip: '203.0.113.99' });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('honours an existing ban marker without re-running the counter', async () => {
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({ THREAT_RATE_LIMIT_IP_BURST: 1 }),
    );
    const ip = '203.0.113.10';
    // Trip the burst once.
    await service.consume({ ip });
    const tripped = await service.consume({ ip });
    expect(tripped.allowed).toBe(false);

    // Wipe the counter — the ban marker should still keep the IP out.
    redis._wipe();
    redis['store'] = new Map();
    // Manually re-apply just the ban marker (matches what Redis would
    // hold after the counter window expired but before the ban TTL).
    await redis.set(
      `tp:ban:ip:burst:${ip}`,
      '1',
      TIERED_RATE_LIMITS.IP_BURST_BAN_SECONDS,
    );

    const stillBlocked = await service.consume({ ip });
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.reason).toBe('IP_BURST');
    expect(stillBlocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('reports retryAfterSeconds at least 1 second on every reject path', async () => {
    service = new TieredRateLimiterService(
      redis as unknown as any,
      makeConfig({ THREAT_RATE_LIMIT_IP_BURST: 1 }),
    );
    const ip = '203.0.113.11';
    await service.consume({ ip });
    const blocked = await service.consume({ ip });
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
