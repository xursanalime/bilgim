import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

/**
 * Maximum number of keys expanded by a `SCAN`-driven invalidation per
 * batch. Keeping this small means a stuck Redis can never block the
 * event loop for a noticeable amount of time even on a key set with
 * tens of thousands of entries.
 */
const SCAN_BATCH_SIZE = 100;

/**
 * `CacheService` — thin getOrSet/invalidate facade over `RedisService`
 * (Task 24.2 — performance optimization).
 *
 * Two access patterns are supported:
 *
 *   1. **Cache-aside** via `getOrSet(key, ttl, fetcher)` — the most
 *      common shape. The service tries the cache first, falls back to
 *      the supplied fetcher on a miss, then writes the fetcher's
 *      result back with a TTL. A failure to *read* the cache never
 *      fails the request; we log and execute `fetcher` so Redis is a
 *      strict performance optimisation, not a hard dependency.
 *
 *   2. **Invalidation** via `invalidate(keyOrPattern)` — accepts either
 *      a single key (delegated to `DEL`) or a glob pattern (`*` /
 *      `?` / `[…]`) which is expanded with `SCAN` + chunked `DEL`.
 *      Patterns are limited to `SCAN_BATCH_SIZE` keys per batch so a
 *      runaway invalidation cannot stall the event loop.
 *
 * Values are JSON-encoded when written. Callers store and retrieve
 * structurally cloneable objects only — we don't try to handle
 * circular references or class instances.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Read-through cache helper.
   *
   * Behaviour:
   *   * **Hit**  — parse and return the cached value. `fetcher` is not
   *               called.
   *   * **Miss** — call `fetcher`, write the result back with `ttl`
   *               seconds (when defined and > 0), then return.
   *   * **Cache read error** — log and fall through to `fetcher`. The
   *                            request still succeeds.
   *   * **Cache write error** — log and return the fetched value
   *                             without raising (best-effort write).
   *
   * @param key      Stable Redis key — callers SHOULD include a
   *                 namespace prefix (`discovery:`, `tutor:`, …) so
   *                 `invalidate('discovery:*')` is selective.
   * @param ttl      Time-to-live in seconds. Pass `0` (or omit via
   *                 `undefined`) to disable expiry — usually a
   *                 mistake, so we log a warning when ttl is non-
   *                 positive but still write the entry.
   * @param fetcher  Lazy producer for the cached value on a miss.
   */
  async getOrSet<T>(
    key: string,
    ttl: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.safeGet<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const fresh = await fetcher();
    await this.safeSet(key, fresh, ttl);
    return fresh;
  }

  /**
   * Invalidate a cache entry or a set of entries matching a Redis-style
   * pattern. Returns the number of keys removed (best-effort — failure
   * is logged and ignored).
   *
   * Pattern detection is deliberately conservative: only `*`, `?`, and
   * `[` characters trigger the `SCAN`+`DEL` path. Plain keys go through
   * a single `DEL` for the lowest possible latency.
   */
  async invalidate(keyOrPattern: string): Promise<number> {
    if (!keyOrPattern) return 0;

    if (this.isPattern(keyOrPattern)) {
      return this.invalidatePattern(keyOrPattern);
    }

    try {
      return await this.redis.del(keyOrPattern);
    } catch (err) {
      this.logger.warn(
        `Cache delete failed for key="${keyOrPattern}": ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private isPattern(value: string): boolean {
    return /[*?[\]]/.test(value);
  }

  /**
   * Best-effort `GET`+JSON parse. Returns `undefined` on miss or any
   * failure path so the caller can decide between "no entry" and
   * "have a value" by matching against `undefined`.
   *
   * `null` is a valid cached value (encoded as the JSON string
   * `"null"`), so we use the sentinel `undefined` to denote "no row".
   */
  private async safeGet<T>(key: string): Promise<T | undefined> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `Cache read failed for key="${key}": ${(err as Error).message}`,
      );
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(
        `Cache parse failed for key="${key}": ${(err as Error).message}`,
      );
      // Drop the poisoned entry so the next caller fetches fresh.
      void this.invalidate(key);
      return undefined;
    }
  }

  private async safeSet(key: string, value: unknown, ttl: number): Promise<void> {
    if (!Number.isFinite(ttl) || ttl <= 0) {
      this.logger.warn(
        `Cache write for key="${key}" using non-positive TTL=${ttl}; entry will not expire`,
      );
    }
    let payload: string;
    try {
      payload = JSON.stringify(value);
    } catch (err) {
      this.logger.warn(
        `Cache serialize failed for key="${key}": ${(err as Error).message}`,
      );
      return;
    }
    try {
      if (Number.isFinite(ttl) && ttl > 0) {
        await this.redis.set(key, payload, ttl);
      } else {
        await this.redis.set(key, payload);
      }
    } catch (err) {
      this.logger.warn(
        `Cache write failed for key="${key}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Expand `pattern` via `SCAN`, batch-delete the matching keys, and
   * return the total count removed. We intentionally avoid `KEYS` —
   * it is `O(n)` over the entire keyspace and blocks Redis.
   */
  private async invalidatePattern(pattern: string): Promise<number> {
    const client = this.redis.getClient();
    let cursor = '0';
    let removed = 0;
    try {
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          SCAN_BATCH_SIZE,
        );
        cursor = next;
        if (keys.length > 0) {
          removed += await client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(
        `Cache pattern invalidation failed for pattern="${pattern}": ${(err as Error).message}`,
      );
    }
    return removed;
  }
}
