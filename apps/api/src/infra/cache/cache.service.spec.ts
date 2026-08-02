import { Logger } from '@nestjs/common';

import { CacheService } from './cache.service';

/**
 * `CacheService` unit tests — Task 24.2 (performance optimization).
 *
 * Coverage:
 *   - `getOrSet` cache hit returns the parsed value and skips the
 *     fetcher.
 *   - `getOrSet` cache miss invokes the fetcher and writes the result
 *     back with the supplied TTL.
 *   - Cache read/write failures fall through to the fetcher (Redis is
 *     a best-effort optimisation, never a hard dependency).
 *   - Poisoned cache entries (invalid JSON) are dropped and the
 *     fetcher is invoked.
 *   - `invalidate(key)` issues a single `DEL`.
 *   - `invalidate(pattern)` walks `SCAN` cursors and `DEL`s matching
 *     keys in batches.
 *   - Failure in the underlying Redis client during invalidation is
 *     logged and swallowed.
 */
describe('CacheService', () => {
  type FakeRedis = {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    getClient: jest.Mock;
  };

  let redis: FakeRedis;
  let scanClient: { scan: jest.Mock; del: jest.Mock };
  let service: CacheService;

  beforeEach(() => {
    scanClient = { scan: jest.fn(), del: jest.fn() };
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      getClient: jest.fn(() => scanClient),
    };
    service = new CacheService(redis as any);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================================================================
  // getOrSet — happy paths
  // ==================================================================

  describe('getOrSet', () => {
    it('returns the cached value on a hit and does not invoke the fetcher', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ items: [1, 2] }));
      const fetcher = jest.fn();

      const out = await service.getOrSet('k', 60, fetcher);

      expect(out).toEqual({ items: [1, 2] });
      expect(fetcher).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('invokes the fetcher and writes the result with the supplied TTL on a miss', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue({ items: ['a', 'b'] });

      const out = await service.getOrSet('k', 120, fetcher);

      expect(out).toEqual({ items: ['a', 'b'] });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        'k',
        JSON.stringify({ items: ['a', 'b'] }),
        120,
      );
    });

    it('falls through to the fetcher when the cache read throws', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      redis.set.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue('fresh');

      const out = await service.getOrSet('k', 60, fetcher);

      expect(out).toBe('fresh');
      expect(fetcher).toHaveBeenCalled();
    });

    it('returns the fetcher result even when the cache write fails', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error('redis down'));
      const fetcher = jest.fn().mockResolvedValue(42);

      await expect(service.getOrSet('k', 60, fetcher)).resolves.toBe(42);
    });

    it('drops a poisoned cache entry (invalid JSON) and invokes the fetcher', async () => {
      redis.get.mockResolvedValue('not-valid-json{');
      redis.del.mockResolvedValue(1);
      redis.set.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue('healed');

      const out = await service.getOrSet('k', 60, fetcher);

      expect(out).toBe('healed');
      expect(redis.del).toHaveBeenCalledWith('k');
      expect(fetcher).toHaveBeenCalled();
    });

    it('writes without TTL when the supplied TTL is <= 0', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue('forever');

      await service.getOrSet('k', 0, fetcher);

      // Three-arg `set` only when ttl > 0; the no-TTL path is two-arg.
      expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify('forever'));
    });

    it('still returns a usable value when the fetched payload is not serializable', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockResolvedValue(undefined);

      const circular: any = {};
      circular.self = circular; // JSON.stringify throws on circular refs
      const fetcher = jest.fn().mockResolvedValue(circular);

      const out = await service.getOrSet('k', 60, fetcher);
      expect(out).toBe(circular);
      // Write was attempted but skipped silently — never called Redis.
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // invalidate — single key
  // ==================================================================

  describe('invalidate (single key)', () => {
    it('issues a DEL for a literal key and returns the count', async () => {
      redis.del.mockResolvedValue(1);
      const removed = await service.invalidate('discovery:courses:abc');
      expect(redis.del).toHaveBeenCalledWith('discovery:courses:abc');
      expect(removed).toBe(1);
    });

    it('returns 0 when the supplied key is empty', async () => {
      const removed = await service.invalidate('');
      expect(removed).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('swallows DEL failures and returns 0', async () => {
      redis.del.mockRejectedValue(new Error('boom'));
      const removed = await service.invalidate('k');
      expect(removed).toBe(0);
    });
  });

  // ==================================================================
  // invalidate — pattern
  // ==================================================================

  describe('invalidate (pattern)', () => {
    it('walks SCAN cursors and DELs matching keys in batches', async () => {
      // Two scan iterations: cursor "0" -> "13" -> "0".
      scanClient.scan
        .mockResolvedValueOnce(['13', ['discovery:courses:a', 'discovery:courses:b']])
        .mockResolvedValueOnce(['0', ['discovery:courses:c']]);
      scanClient.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const removed = await service.invalidate('discovery:courses:*');

      expect(scanClient.scan).toHaveBeenNthCalledWith(
        1,
        '0',
        'MATCH',
        'discovery:courses:*',
        'COUNT',
        100,
      );
      expect(scanClient.scan).toHaveBeenNthCalledWith(
        2,
        '13',
        'MATCH',
        'discovery:courses:*',
        'COUNT',
        100,
      );
      expect(scanClient.del).toHaveBeenNthCalledWith(
        1,
        'discovery:courses:a',
        'discovery:courses:b',
      );
      expect(scanClient.del).toHaveBeenNthCalledWith(2, 'discovery:courses:c');
      expect(removed).toBe(3);
    });

    it('skips DEL when a SCAN batch returns no keys', async () => {
      scanClient.scan.mockResolvedValueOnce(['0', []]);
      const removed = await service.invalidate('foo:*');
      expect(removed).toBe(0);
      expect(scanClient.del).not.toHaveBeenCalled();
    });

    it('treats `?` and `[…]` as patterns (not literals)', async () => {
      scanClient.scan.mockResolvedValueOnce(['0', ['matched']]);
      scanClient.del.mockResolvedValueOnce(1);

      await service.invalidate('user:?');
      expect(scanClient.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'user:?',
        'COUNT',
        100,
      );
    });

    it('logs and returns the partial count when SCAN throws mid-walk', async () => {
      scanClient.scan
        .mockResolvedValueOnce(['7', ['k1']])
        .mockRejectedValueOnce(new Error('redis down'));
      scanClient.del.mockResolvedValue(1);

      const removed = await service.invalidate('a:*');
      expect(removed).toBe(1);
    });
  });
});
