import type { RedisService } from '../../../infra/redis/redis.service';
import {
  GeoIpService,
  isPrivateIp,
  lookupFromHeader,
} from './geoip.service';

/**
 * Unit tests for Task 27.3 — `GeoIpService` (Req 27.3).
 *
 * Covers the resolution chain:
 *   1. Private / loopback / link-local IPs short-circuit to `null`.
 *   2. `lookupFromHeader` translates a `cf-ipcountry` header into a
 *      country-centre coordinate.
 *   3. `lookup()` reads / writes the Redis cache (no MaxMind DB
 *      configured in the test environment).
 *   4. Unknown country in the header → `null`.
 *
 * **Validates: Requirements 27.3**
 */

class FakeRedis {
  private kv = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      this.kv.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt:
        ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  size(): number {
    return this.kv.size;
  }

  keys(): string[] {
    return [...this.kv.keys()];
  }
}

function build(opts: { withRedis?: boolean } = {}) {
  const redis = new FakeRedis();
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  };
  const service = new GeoIpService(
    // ConfigService is generic over EnvConfig — we don't need a real
    // env to exercise the cache + header fallback path.
    config as unknown as ConstructorParameters<typeof GeoIpService>[0],
    opts.withRedis === false ? undefined : (redis as unknown as RedisService),
  );
  return { service, redis, config };
}

describe('isPrivateIp', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['10.0.0.5', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.254', true],
    ['fc00::1', true],
    ['fd12:3456:7890::1', true],
    // Public addresses
    ['203.0.113.5', false],
    ['198.51.100.42', false],
    ['8.8.8.8', false],
    ['', true],
  ])('isPrivateIp(%s) === %s', (ip, expected) => {
    expect(isPrivateIp(ip)).toBe(expected);
  });
});

describe('lookupFromHeader', () => {
  it('returns a known country centroid for a valid cf-ipcountry header', () => {
    const result = lookupFromHeader({ 'cf-ipcountry': 'UZ' });
    expect(result).not.toBeNull();
    expect(result?.country).toBe('UZ');
    expect(result?.latitude).toBeCloseTo(41.3, 1);
    expect(result?.longitude).toBeCloseTo(69.3, 1);
  });

  it('uppercases lowercased country codes', () => {
    const result = lookupFromHeader({ 'cf-ipcountry': 'ru' });
    expect(result?.country).toBe('RU');
  });

  it('returns null for unknown country codes', () => {
    const result = lookupFromHeader({ 'cf-ipcountry': 'XX' });
    expect(result).toBeNull();
  });

  it('returns null for malformed headers', () => {
    expect(lookupFromHeader({ 'cf-ipcountry': '123' })).toBeNull();
    expect(lookupFromHeader({})).toBeNull();
    expect(lookupFromHeader(undefined)).toBeNull();
  });

  it('handles header arrays (Express duplicate-header form)', () => {
    const result = lookupFromHeader({ 'cf-ipcountry': ['DE'] });
    expect(result?.country).toBe('DE');
  });
});

describe('GeoIpService.lookup', () => {
  it('returns null for private / loopback IPs without consulting Redis', async () => {
    const { service, redis } = build();
    expect(await service.lookup('127.0.0.1')).toBeNull();
    expect(await service.lookup('::1')).toBeNull();
    expect(redis.size()).toBe(0);
  });

  it('falls back to cf-ipcountry header when no MaxMind DB is configured', async () => {
    const { service, redis } = build();
    const result = await service.lookup('203.0.113.50', {
      'cf-ipcountry': 'UZ',
    });
    expect(result).not.toBeNull();
    expect(result?.country).toBe('UZ');
    expect(result?.accuracyRadius).toBe(
      GeoIpService.COUNTRY_ACCURACY_RADIUS_KM,
    );
    // Cached for the next call.
    expect(redis.size()).toBe(1);
    expect(redis.keys()[0]).toContain('203.0.113.50');
  });

  it('returns a Redis-cached value on subsequent lookups', async () => {
    const { service } = build();
    const ip = '203.0.113.51';
    const first = await service.lookup(ip, { 'cf-ipcountry': 'DE' });
    // Header dropped on second call — must come from cache.
    const second = await service.lookup(ip);
    expect(second).toEqual(first);
  });

  it('caches a MISS sentinel when no signal resolves', async () => {
    const { service, redis } = build();
    const ip = '203.0.113.52';
    expect(await service.lookup(ip)).toBeNull();
    // The sentinel must short-circuit subsequent lookups.
    const second = await service.lookup(ip, { 'cf-ipcountry': 'UZ' });
    expect(second).toBeNull();
    expect(redis.size()).toBe(1);
  });

  it('returns null when no header AND no MaxMind DB', async () => {
    const { service } = build();
    const result = await service.lookup('203.0.113.53');
    expect(result).toBeNull();
  });

  it('invalidate() drops the cached entry', async () => {
    const { service, redis } = build();
    const ip = '203.0.113.54';
    await service.lookup(ip, { 'cf-ipcountry': 'GB' });
    expect(redis.size()).toBe(1);
    await service.invalidate(ip);
    expect(redis.size()).toBe(0);
  });

  it('still works without a Redis service (degrades gracefully)', async () => {
    const { service } = build({ withRedis: false });
    const result = await service.lookup('203.0.113.55', {
      'cf-ipcountry': 'JP',
    });
    expect(result?.country).toBe('JP');
  });
});
