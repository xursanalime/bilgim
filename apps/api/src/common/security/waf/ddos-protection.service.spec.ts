import type { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import {
  DDOS_DEFAULTS,
  DdosProtectionService,
} from './ddos-protection.service';

/**
 * Build a `ConfigService` stub returning the supplied env values.
 * Anything not in the map resolves to `undefined`.
 *
 * Cast through `any` so the strictly-typed `EnvConfig` generic does
 * not force the spec to spell out the full env schema for what is
 * effectively a one-line lookup stub.
 */
function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

/**
 * In-memory `RedisService` stub. Implements just the surface used by
 * `DdosProtectionService` (incr / expire / del / get / set / ttl).
 * Time is virtual — call `tickSeconds()` to advance the clock so the
 * sliding-window TTL can expire deterministically.
 */
function makeFakeRedis() {
  type Entry = { value: string; expiresAt: number | null };
  type HashEntry = { fields: Map<string, string>; expiresAt: number | null };
  const store = new Map<string, Entry>();
  const hashStore = new Map<string, HashEntry>();
  let now = 1_000_000;

  const isExpired = (entry: { expiresAt: number | null }) =>
    entry.expiresAt !== null && entry.expiresAt <= now;
  const compact = () => {
    for (const [k, v] of store) if (isExpired(v)) store.delete(k);
    for (const [k, v] of hashStore) if (isExpired(v)) hashStore.delete(k);
  };

  const fakeService: any = {
    get: jest.fn(async (key: string) => {
      compact();
      return store.get(key)?.value ?? null;
    }),
    set: jest.fn(async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt =
        typeof ttlSeconds === 'number' ? now + ttlSeconds : null;
      store.set(key, { value, expiresAt });
    }),
    del: jest.fn(async (key: string) => {
      compact();
      const had = store.has(key);
      store.delete(key);
      hashStore.delete(key);
      return had ? 1 : 0;
    }),
    exists: jest.fn(async (key: string) => {
      compact();
      return store.has(key) || hashStore.has(key);
    }),
    incr: jest.fn(async (key: string) => {
      compact();
      const entry = store.get(key);
      const next = (entry ? Number(entry.value) || 0 : 0) + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    }),
    expire: jest.fn(async (key: string, ttlSeconds: number) => {
      const entry = store.get(key) ?? hashStore.get(key);
      if (!entry) return;
      entry.expiresAt = now + ttlSeconds;
    }),
    setnx: jest.fn(),
    publish: jest.fn(),
    getClient: () =>
      ({
        ttl: async (key: string) => {
          compact();
          const entry = store.get(key) ?? hashStore.get(key);
          if (!entry) return -2;
          if (entry.expiresAt === null) return -1;
          return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
        },
        hmget: async (key: string, ...fields: string[]) => {
          compact();
          const entry = hashStore.get(key);
          if (!entry) return fields.map(() => null);
          return fields.map((f) => entry.fields.get(f) ?? null);
        },
        hmset: async (
          key: string,
          values: Record<string, string> | string[],
        ) => {
          let entry = hashStore.get(key);
          if (!entry) {
            entry = { fields: new Map(), expiresAt: null };
            hashStore.set(key, entry);
          }
          if (Array.isArray(values)) {
            for (let i = 0; i < values.length; i += 2) {
              entry.fields.set(String(values[i]), String(values[i + 1] ?? ''));
            }
          } else {
            for (const [k, v] of Object.entries(values)) {
              entry.fields.set(k, String(v));
            }
          }
          return 'OK';
        },
        expire: async (key: string, ttlSeconds: number) => {
          const entry = store.get(key) ?? hashStore.get(key);
          if (!entry) return 0;
          entry.expiresAt = now + ttlSeconds;
          return 1;
        },
      } as any),
  };

  return {
    redis: fakeService as unknown as RedisService,
    store,
    hashStore,
    tickSeconds: (sec: number) => {
      now += sec;
    },
  };
}

describe('DdosProtectionService', () => {
  describe('configuration', () => {
    it('falls back to the documented defaults when env is empty', () => {
      const service = new DdosProtectionService(undefined, makeConfig({}));
      expect(service.unauthenticatedLimit).toBe(
        DDOS_DEFAULTS.RATE_LIMIT_UNAUTH,
      );
      expect(service.authenticatedLimit).toBe(DDOS_DEFAULTS.RATE_LIMIT_AUTH);
      expect(service.window).toBe(DDOS_DEFAULTS.WINDOW_SECONDS);
    });

    it('honours overridden limits from the env', () => {
      const service = new DdosProtectionService(
        undefined,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 5,
          DDOS_RATE_LIMIT_AUTH: 50,
          DDOS_WINDOW_SECONDS: 30,
        }),
      );
      expect(service.unauthenticatedLimit).toBe(5);
      expect(service.authenticatedLimit).toBe(50);
      expect(service.window).toBe(30);
    });

    it('clamps invalid values back to the defaults', () => {
      const service = new DdosProtectionService(
        undefined,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: -5,
          DDOS_RATE_LIMIT_AUTH: 0,
          DDOS_WINDOW_SECONDS: 'banana',
        }),
      );
      expect(service.unauthenticatedLimit).toBe(
        DDOS_DEFAULTS.RATE_LIMIT_UNAUTH,
      );
      expect(service.authenticatedLimit).toBe(DDOS_DEFAULTS.RATE_LIMIT_AUTH);
      expect(service.window).toBe(DDOS_DEFAULTS.WINDOW_SECONDS);
    });
  });

  describe('sliding-window enforcement', () => {
    it('allows requests up to the unauthenticated limit and blocks the next one', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 3,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.10';
      const allowed: boolean[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await service.checkAndIncrement(ip, 'anonymous');
        allowed.push(result.allowed);
      }
      expect(allowed).toEqual([true, true, true]);

      const blocked = await service.checkAndIncrement(ip, 'anonymous');
      expect(blocked.allowed).toBe(false);
      expect(blocked.observedCount).toBe(4);
      expect(blocked.limit).toBe(3);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('uses the higher authenticated limit for logged-in callers', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 2,
          DDOS_RATE_LIMIT_AUTH: 5,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.20';
      // 5 authenticated hits all allowed; the 6th is blocked.
      for (let i = 0; i < 5; i++) {
        const result = await service.checkAndIncrement(ip, 'authenticated');
        expect(result.allowed).toBe(true);
      }
      const blocked = await service.checkAndIncrement(ip, 'authenticated');
      expect(blocked.allowed).toBe(false);
      expect(blocked.limit).toBe(5);
    });

    it('tracks anonymous and authenticated counters on independent buckets', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 2,
          DDOS_RATE_LIMIT_AUTH: 5,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.30';
      // Burn through the anonymous bucket.
      await service.checkAndIncrement(ip, 'anonymous');
      await service.checkAndIncrement(ip, 'anonymous');
      const anonExceeded = await service.checkAndIncrement(ip, 'anonymous');
      expect(anonExceeded.allowed).toBe(false);

      // Authenticated bucket is independent.
      const authResult = await service.checkAndIncrement(ip, 'authenticated');
      expect(authResult.allowed).toBe(true);
      expect(authResult.observedCount).toBe(1);
    });

    it('resets the bucket after the window TTL expires', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 2,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.40';
      await service.checkAndIncrement(ip, 'anonymous');
      await service.checkAndIncrement(ip, 'anonymous');
      const blocked = await service.checkAndIncrement(ip, 'anonymous');
      expect(blocked.allowed).toBe(false);

      fake.tickSeconds(61);
      const recovered = await service.checkAndIncrement(ip, 'anonymous');
      expect(recovered.allowed).toBe(true);
      expect(recovered.observedCount).toBe(1);
    });

    it('reports retryAfterSeconds approximating the time until window reset', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 1,
          DDOS_WINDOW_SECONDS: 30,
        }),
      );

      const ip = '203.0.113.50';
      await service.checkAndIncrement(ip, 'anonymous');
      const blocked = await service.checkAndIncrement(ip, 'anonymous');
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(30);
    });
  });

  describe('skip allow-list', () => {
    it('skips IPs inside a configured CIDR range', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 1,
          DDOS_IP_WHITELIST: '10.0.0.0/8, 192.168.1.0/24',
        }),
      );
      // Burn the bucket — but the IP is allow-listed so it stays open.
      for (let i = 0; i < 5; i++) {
        const result = await service.checkAndIncrement(
          '10.5.6.7',
          'anonymous',
        );
        expect(result.allowed).toBe(true);
        expect(result.skipped).toBe(true);
      }
      // Second range matches.
      const second = await service.checkAndIncrement(
        '192.168.1.42',
        'anonymous',
      );
      expect(second.skipped).toBe(true);
    });

    it('exact-IP entries match exactly', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 1,
          DDOS_IP_WHITELIST: '203.0.113.5',
        }),
      );
      const allowed = await service.checkAndIncrement(
        '203.0.113.5',
        'anonymous',
      );
      expect(allowed.skipped).toBe(true);

      // Adjacent IP is NOT skipped.
      await service.checkAndIncrement('203.0.113.6', 'anonymous');
      const blocked = await service.checkAndIncrement(
        '203.0.113.6',
        'anonymous',
      );
      expect(blocked.allowed).toBe(false);
    });

    it('always treats loopback as implicitly allow-listed', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 1,
          DDOS_IP_WHITELIST: '',
        }),
      );
      for (let i = 0; i < 5; i++) {
        const result = await service.checkAndIncrement('127.0.0.1', 'anonymous');
        expect(result.allowed).toBe(true);
        expect(result.skipped).toBe(true);
      }
      const ipv6 = await service.checkAndIncrement('::1', 'anonymous');
      expect(ipv6.skipped).toBe(true);
    });

    it('drops malformed CIDR entries without widening the list', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 1,
          // /99 is invalid for IPv4, "not-an-ip" cannot parse;
          // 8.8.8.8 should still match exactly.
          DDOS_IP_WHITELIST: '10.0.0.0/99,not-an-ip,8.8.8.8',
        }),
      );
      // 10.0.0.5 should NOT bypass — the bad CIDR was discarded.
      await service.checkAndIncrement('10.0.0.5', 'anonymous');
      const blocked = await service.checkAndIncrement(
        '10.0.0.5',
        'anonymous',
      );
      expect(blocked.allowed).toBe(false);

      // 8.8.8.8 still bypasses.
      const allowed = await service.checkAndIncrement('8.8.8.8', 'anonymous');
      expect(allowed.skipped).toBe(true);
    });
  });

  describe('fail-open posture', () => {
    it('returns allowed=true when no Redis is wired', async () => {
      const service = new DdosProtectionService(undefined, makeConfig({}));
      const result = await service.checkAndIncrement(
        '203.0.113.99',
        'anonymous',
      );
      expect(result.allowed).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it('returns allowed=true when Redis throws on incr', async () => {
      const broken = {
        incr: jest.fn(async () => {
          throw new Error('redis is down');
        }),
        expire: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        getClient: () => ({}),
      } as unknown as RedisService;
      const service = new DdosProtectionService(broken, makeConfig({}));
      const result = await service.checkAndIncrement(
        '203.0.113.99',
        'anonymous',
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('input normalisation', () => {
    it('treats missing IPs as the literal "unknown" bucket', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_RATE_LIMIT_UNAUTH: 2,
        }),
      );
      await service.checkAndIncrement('', 'anonymous');
      const second = await service.checkAndIncrement('', 'anonymous');
      const blocked = await service.checkAndIncrement('', 'anonymous');
      expect(second.allowed).toBe(true);
      expect(blocked.allowed).toBe(false);
      // The two anonymous "unknown" requests should land on the same key.
      expect(fake.store.has('ddos:anonymous:unknown')).toBe(true);
    });

    it('trims leading/trailing whitespace from the IP', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({ DDOS_RATE_LIMIT_UNAUTH: 5 }),
      );
      await service.checkAndIncrement('  203.0.113.10  ', 'anonymous');
      const result = await service.checkAndIncrement(
        '203.0.113.10',
        'anonymous',
      );
      expect(result.observedCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // Token bucket — DDOS_IP_RATE_LIMIT (Task 27.1, requirement 2).
  // -------------------------------------------------------------------
  describe('consumeToken (token-bucket)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('exposes the configured token-bucket capacity', () => {
      const service = new DdosProtectionService(
        undefined,
        makeConfig({ DDOS_IP_RATE_LIMIT: 50 }),
      );
      expect(service.tokenBucketLimit).toBe(50);
    });

    it('defaults to 200 when DDOS_IP_RATE_LIMIT is unset', () => {
      const service = new DdosProtectionService(undefined, makeConfig({}));
      expect(service.tokenBucketLimit).toBe(200);
    });

    it('clamps invalid bucket capacity values back to the default', () => {
      const service = new DdosProtectionService(
        undefined,
        makeConfig({ DDOS_IP_RATE_LIMIT: -10 }),
      );
      expect(service.tokenBucketLimit).toBe(200);
    });

    it('allows a full-bucket burst up to capacity, then blocks', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 5,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.100';
      // Five immediate requests fit inside the 5-token bucket.
      for (let i = 0; i < 5; i++) {
        const result = await service.consumeToken(ip);
        expect(result.allowed).toBe(true);
      }
      // 6th request exhausts the bucket.
      const blocked = await service.consumeToken(ip);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.capacity).toBe(5);
    });

    it('refills tokens lazily based on elapsed time', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 10,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.110';
      // Drain the bucket.
      for (let i = 0; i < 10; i++) {
        await service.consumeToken(ip);
      }
      const exhausted = await service.consumeToken(ip);
      expect(exhausted.allowed).toBe(false);

      // Advance the wall-clock by 30 seconds. With 10 tokens / 60s,
      // that's a 5-token refill — should be enough to allow another
      // request.
      jest.advanceTimersByTime(30_000);
      const refilled = await service.consumeToken(ip);
      expect(refilled.allowed).toBe(true);
      // We consumed 1 of the ~5 refilled tokens, ~4 should remain.
      expect(refilled.remainingTokens).toBeGreaterThan(3);
      expect(refilled.remainingTokens).toBeLessThan(5);
    });

    it('full refill after the entire window elapses', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 4,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.120';
      for (let i = 0; i < 4; i++) await service.consumeToken(ip);
      const exhausted = await service.consumeToken(ip);
      expect(exhausted.allowed).toBe(false);

      // Advance by the full refill window — bucket should be back to
      // capacity (capped at the limit, even though more time has
      // elapsed than strictly needed).
      jest.advanceTimersByTime(120_000);
      const refilled = await service.consumeToken(ip);
      expect(refilled.allowed).toBe(true);
      expect(refilled.remainingTokens).toBeCloseTo(3, 0);
    });

    it('reports retryAfterSeconds approximating the time until next token', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 60,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      const ip = '203.0.113.130';
      // 60 tokens / 60s → 1 token per second. Drain the bucket.
      for (let i = 0; i < 60; i++) await service.consumeToken(ip);
      const blocked = await service.consumeToken(ip);
      expect(blocked.allowed).toBe(false);
      // Wait time should be ~1 second (one token per second refill).
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(2);
    });

    it('respects the DDoS skip allowlist', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 1,
          DDOS_IP_WHITELIST: '10.0.0.0/8',
        }),
      );
      // Burn many requests from an allow-listed IP — every one is
      // allowed and skipped.
      for (let i = 0; i < 50; i++) {
        const result = await service.consumeToken('10.5.6.7');
        expect(result.allowed).toBe(true);
        expect(result.skipped).toBe(true);
      }
    });

    it('always allows loopback (kubelet probes)', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({ DDOS_IP_RATE_LIMIT: 1 }),
      );
      for (let i = 0; i < 20; i++) {
        const result = await service.consumeToken('127.0.0.1');
        expect(result.allowed).toBe(true);
        expect(result.skipped).toBe(true);
      }
    });

    it('fails open when no Redis is wired', async () => {
      const service = new DdosProtectionService(
        undefined,
        makeConfig({ DDOS_IP_RATE_LIMIT: 1 }),
      );
      const result = await service.consumeToken('203.0.113.99');
      expect(result.allowed).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it('fails open when Redis throws on hmget', async () => {
      const broken = {
        getClient: () => ({
          hmget: jest.fn(async () => {
            throw new Error('redis is down');
          }),
          hmset: jest.fn(),
          expire: jest.fn(),
          ttl: jest.fn(),
        }),
      } as unknown as RedisService;
      const service = new DdosProtectionService(
        broken,
        makeConfig({ DDOS_IP_RATE_LIMIT: 1 }),
      );
      const result = await service.consumeToken('203.0.113.99');
      expect(result.allowed).toBe(true);
    });

    it('tracks separate buckets per IP', async () => {
      const fake = makeFakeRedis();
      const service = new DdosProtectionService(
        fake.redis,
        makeConfig({
          DDOS_IP_RATE_LIMIT: 2,
          DDOS_WINDOW_SECONDS: 60,
        }),
      );

      // Drain IP A.
      await service.consumeToken('203.0.113.10');
      await service.consumeToken('203.0.113.10');
      const blockedA = await service.consumeToken('203.0.113.10');
      expect(blockedA.allowed).toBe(false);

      // IP B is independent.
      const allowedB = await service.consumeToken('203.0.113.20');
      expect(allowedB.allowed).toBe(true);
    });
  });
});
