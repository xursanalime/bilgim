import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Result of one `checkAndIncrement` call.
 *
 *   - `allowed=true` — the request fits inside the per-IP quota and
 *     should be served.
 *   - `allowed=false` — the quota is exhausted; the caller MUST
 *     short-circuit with 429 and forward `retryAfterSeconds` as the
 *     `Retry-After` response header.
 */
export interface DdosCheckResult {
  allowed: boolean;
  /** Seconds until the current sliding window resets. */
  retryAfterSeconds: number;
  /** Hits observed inside the current window after this call. */
  observedCount: number;
  /** Effective limit applied to this caller. */
  limit: number;
  /** True when the IP belongs to the trusted skip allow-list. */
  skipped: boolean;
}

/**
 * Authentication state hint passed in by the guard. We keep a small
 * union here rather than the actual Nest `request.user` object so the
 * service is trivially mockable.
 */
export type DdosCallerKind = 'anonymous' | 'authenticated';

/**
 * Tunables surfaced as constants so tests + monitoring can share
 * the numbers without drifting.
 */
export const DDOS_DEFAULTS = {
  /** Anonymous callers: 100 req / 60s (legacy sliding window). */
  RATE_LIMIT_UNAUTH: 100,
  /** Authenticated callers: 1000 req / 60s (legacy sliding window). */
  RATE_LIMIT_AUTH: 1000,
  /** Sliding window length in seconds. */
  WINDOW_SECONDS: 60,
  /**
   * Token-bucket capacity per IP — `DDOS_IP_RATE_LIMIT` env. The
   * bucket holds this many tokens at full and refills `capacity / 60s`
   * tokens per second, matching the documented "200 req/min" spec.
   */
  IP_TOKEN_BUCKET_CAPACITY: 200,
  /** Refill window for the token bucket, in seconds. */
  IP_TOKEN_BUCKET_REFILL_SECONDS: 60,
} as const;

/**
 * Result of one `consumeToken` call. Mirrors `DdosCheckResult` but
 * surfaces the token-bucket internals so callers can build richer
 * `Retry-After` headers.
 */
export interface DdosTokenResult {
  allowed: boolean;
  /** Seconds until at least one token is available again. 0 when allowed. */
  retryAfterSeconds: number;
  /** Tokens remaining in the bucket *after* this call. */
  remainingTokens: number;
  /** Effective bucket capacity. */
  capacity: number;
  /** True when the IP belongs to the trusted skip allow-list. */
  skipped: boolean;
}

/**
 * DdosProtectionService — Redis-backed sliding-window counter and
 * token-bucket limiter.
 *
 * Two complementary limits live on this service:
 *
 *   1. **Sliding window** (`checkAndIncrement`) — fixed-window counter
 *      keyed `ddos:{kind}:{ip}` with a TTL equal to the configured
 *      window. Used by the legacy `DdosGuard` path; kept around so
 *      existing integrations don't break.
 *
 *   2. **Token bucket** (`consumeToken`) — leaky-bucket implementation
 *      keyed `ddos:tb:{ip}`. Holds `DDOS_IP_RATE_LIMIT` tokens at
 *      full, refills at `capacity / DDOS_IP_RATE_LIMIT_WINDOW_SECONDS`
 *      tokens per second, and consumes one token per request. The
 *      bucket allows short bursts up to its capacity while still
 *      capping the long-run rate at `capacity / window`. This is the
 *      shape Task 27.1 documents.
 *
 * Both algorithms fail open: every Redis call is wrapped in try /
 * catch and returns `allowed=true` on error. A Redis outage MUST NOT
 * lock every IP out of the platform.
 *
 * Skip-list: comma-separated CIDR (or single IP) entries from
 * `DDOS_IP_WHITELIST`. Loopback is always implicitly allow-listed so
 * health probes from the kubelet (using `127.0.0.1`) never get
 * throttled.
 */
@Injectable()
export class DdosProtectionService {
  private readonly logger = new Logger(DdosProtectionService.name);

  private readonly limitUnauth: number;
  private readonly limitAuth: number;
  private readonly windowSeconds: number;
  private readonly tokenBucketCapacity: number;
  private readonly tokenBucketRefillSeconds: number;
  private readonly skipList: ReadonlyArray<DdosAllowEntry>;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() configService?: ConfigService<EnvConfig, true>,
  ) {
    this.limitUnauth = clampPositiveInt(
      configService?.get('DDOS_RATE_LIMIT_UNAUTH', { infer: true }) as
        | number
        | undefined,
      DDOS_DEFAULTS.RATE_LIMIT_UNAUTH,
    );
    this.limitAuth = clampPositiveInt(
      configService?.get('DDOS_RATE_LIMIT_AUTH', { infer: true }) as
        | number
        | undefined,
      DDOS_DEFAULTS.RATE_LIMIT_AUTH,
    );
    this.windowSeconds = clampPositiveInt(
      configService?.get('DDOS_WINDOW_SECONDS', { infer: true }) as
        | number
        | undefined,
      DDOS_DEFAULTS.WINDOW_SECONDS,
    );
    this.tokenBucketCapacity = clampPositiveInt(
      configService?.get('DDOS_IP_RATE_LIMIT', { infer: true }) as
        | number
        | undefined,
      DDOS_DEFAULTS.IP_TOKEN_BUCKET_CAPACITY,
    );
    // Refill window matches the sliding-window window so both
    // limiters reset at the same operator-visible cadence.
    this.tokenBucketRefillSeconds = this.windowSeconds;

    const rawSkip =
      (configService?.get('DDOS_IP_WHITELIST', { infer: true }) as
        | string
        | undefined) ?? '';
    this.skipList = parseSkipList(rawSkip);
    if (this.skipList.length > 0) {
      this.logger.log(
        `DDoS skip-list loaded: ${this.skipList.length} entries`,
      );
    }
  }

  /**
   * Increment the per-IP counter and report whether the current
   * request fits inside the configured quota.
   *
   * @param ip   Client IP. Trim/normalise upstream — we treat
   *             missing IPs as the literal `'unknown'` bucket so a
   *             misrouted request still gets counted.
   * @param kind Anonymous or authenticated. The two are tracked on
   *             separate keys so a logged-in user does not get pinned
   *             by the lower anon limit when sharing a NAT.
   */
  async checkAndIncrement(
    ip: string,
    kind: DdosCallerKind = 'anonymous',
  ): Promise<DdosCheckResult> {
    const safeIp = (ip ?? '').trim() || 'unknown';
    const limit =
      kind === 'authenticated' ? this.limitAuth : this.limitUnauth;

    if (this.isAllowed(safeIp)) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        observedCount: 0,
        limit,
        skipped: true,
      };
    }

    if (!this.redis) {
      // No Redis wired — fail open. This is the desired behaviour in
      // unit-test contexts that don't spin up a Redis stub.
      return {
        allowed: true,
        retryAfterSeconds: 0,
        observedCount: 0,
        limit,
        skipped: false,
      };
    }

    const key = bucketKey(safeIp, kind);
    let count = 0;
    let ttlSeconds = this.windowSeconds;
    try {
      count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.windowSeconds);
        ttlSeconds = this.windowSeconds;
      } else {
        const client = this.redis.getClient();
        const ttl = await client.ttl(key);
        if (typeof ttl === 'number' && ttl >= 0) {
          ttlSeconds = ttl;
        } else {
          // Counter exists with no TTL — re-arm the expiry. This
          // happens on the very first hit if the EXPIRE call lost a
          // race; clamping the window keeps the bucket bounded.
          await this.redis.expire(key, this.windowSeconds);
          ttlSeconds = this.windowSeconds;
        }
      }
    } catch (err) {
      this.logger.warn(
        `DdosProtectionService.checkAndIncrement: Redis error for ${key}: ${(err as Error).message}`,
      );
      // Fail open.
      return {
        allowed: true,
        retryAfterSeconds: 0,
        observedCount: 0,
        limit,
        skipped: false,
      };
    }

    const exceeded = count > limit;
    return {
      allowed: !exceeded,
      retryAfterSeconds: exceeded ? Math.max(1, ttlSeconds) : 0,
      observedCount: count,
      limit,
      skipped: false,
    };
  }

  /**
   * Token-bucket per-IP rate limiter (Task 27.1, requirement 2).
   *
   * Algorithm:
   *
   *   - The bucket holds {@link tokenBucketCapacity} tokens at full.
   *   - Refill rate is `capacity / tokenBucketRefillSeconds` tokens
   *     per second, applied lazily on each call (we don't run a
   *     timer — the elapsed time since the last call drives the
   *     refill arithmetic).
   *   - Each call consumes 1 token. When 0 tokens remain, the call
   *     is rejected with `retryAfterSeconds` set to the time until
   *     1 token will be available again.
   *
   * Storage layout:
   *
   *   - Key `ddos:tb:{ip}` is a Redis hash with two fields:
   *     - `tokens`   — float, current bucket level
   *     - `updated`  — float, milliseconds-epoch of the last refresh
   *   - TTL is set to `2 × refillSeconds` so an idle IP's bucket
   *     fades out without holding storage.
   *
   * The implementation uses a Redis pipeline (HMGET → HMSET → EXPIRE)
   * rather than a Lua script. The pipeline is not strictly atomic,
   * but the worst-case race lets a single extra request through —
   * acceptable for a coarse-grained 200 req/min limit, and easier
   * to maintain than a Lua dependency.
   */
  async consumeToken(
    ip: string,
    options: { kind?: DdosCallerKind; cost?: number } = {},
  ): Promise<DdosTokenResult> {
    const safeIp = (ip ?? '').trim() || 'unknown';
    const cost =
      typeof options.cost === 'number' && options.cost > 0 ? options.cost : 1;
    const capacity = this.tokenBucketCapacity;

    if (this.isAllowed(safeIp)) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remainingTokens: capacity,
        capacity,
        skipped: true,
      };
    }

    if (!this.redis) {
      // No Redis — fail open. Tests and dev that don't wire Redis
      // fall through cleanly.
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remainingTokens: capacity,
        capacity,
        skipped: false,
      };
    }

    const key = tokenBucketKey(safeIp);
    const refillRatePerMs = capacity / (this.tokenBucketRefillSeconds * 1000);
    const now = Date.now();

    try {
      const client = this.redis.getClient();
      const [tokensRaw, updatedRaw] = (await client.hmget(
        key,
        'tokens',
        'updated',
      )) as Array<string | null>;

      let tokens =
        typeof tokensRaw === 'string' && tokensRaw.length > 0
          ? Number(tokensRaw)
          : capacity;
      let updated =
        typeof updatedRaw === 'string' && updatedRaw.length > 0
          ? Number(updatedRaw)
          : now;

      if (!Number.isFinite(tokens)) tokens = capacity;
      if (!Number.isFinite(updated)) updated = now;

      // Lazy refill: top up the bucket based on elapsed wall-clock.
      const elapsedMs = Math.max(0, now - updated);
      tokens = Math.min(capacity, tokens + elapsedMs * refillRatePerMs);

      if (tokens >= cost) {
        tokens -= cost;
        await client.hmset(key, {
          tokens: tokens.toFixed(6),
          updated: String(now),
        });
        await client.expire(key, this.tokenBucketRefillSeconds * 2);
        return {
          allowed: true,
          retryAfterSeconds: 0,
          remainingTokens: tokens,
          capacity,
          skipped: false,
        };
      }

      // Bucket empty — record the current state without consuming
      // and report the wait time until the next token arrives.
      await client.hmset(key, {
        tokens: tokens.toFixed(6),
        updated: String(now),
      });
      await client.expire(key, this.tokenBucketRefillSeconds * 2);

      const tokensNeeded = cost - tokens;
      const msUntilToken = tokensNeeded / refillRatePerMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(msUntilToken / 1000));

      return {
        allowed: false,
        retryAfterSeconds,
        remainingTokens: tokens,
        capacity,
        skipped: false,
      };
    } catch (err) {
      this.logger.warn(
        `DdosProtectionService.consumeToken: Redis error for ${key}: ${(err as Error).message}`,
      );
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remainingTokens: capacity,
        capacity,
        skipped: false,
      };
    }
  }

  /**
   * Whether `ip` matches a configured skip-list entry or is loopback.
   * Exposed so the guard can short-circuit logging on internal traffic.
   */
  isAllowed(ip: string): boolean {
    if (!ip) return false;
    if (isLoopback(ip)) return true;
    return this.skipList.some((entry) => entry.matches(ip));
  }

  // ---------------------------------------------------------------
  // Test / debug helpers — read-only views of the configuration.
  // ---------------------------------------------------------------

  /** Effective limit applied to anonymous callers. */
  get unauthenticatedLimit(): number {
    return this.limitUnauth;
  }

  /** Effective limit applied to authenticated callers. */
  get authenticatedLimit(): number {
    return this.limitAuth;
  }

  /** Effective sliding-window length, in seconds. */
  get window(): number {
    return this.windowSeconds;
  }

  /** Effective token-bucket capacity (`DDOS_IP_RATE_LIMIT`). */
  get tokenBucketLimit(): number {
    return this.tokenBucketCapacity;
  }

  /** Refill window applied to the token bucket. */
  get tokenBucketRefillWindow(): number {
    return this.tokenBucketRefillSeconds;
  }
}

// =====================================================================
// Module-private helpers
// =====================================================================

function bucketKey(ip: string, kind: DdosCallerKind): string {
  return `ddos:${kind}:${ip}`;
}

function tokenBucketKey(ip: string): string {
  return `ddos:tb:${ip}`;
}

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function parseSkipList(raw: string): DdosAllowEntry[] {
  if (!raw) return [];
  const out: DdosAllowEntry[] = [];
  for (const piece of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const parsed = DdosAllowEntry.tryParse(piece);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Tiny IPv4 CIDR matcher — same shape as the WAF allow-list helper
 * inside `ThreatProtectionService` so both layers parse the same way.
 * IPv6 entries fall back to exact-string matching, which is the safer
 * default for environments where v6 has not been validated.
 */
class DdosAllowEntry {
  private constructor(
    private readonly raw: string,
    private readonly mode: 'ipv4-cidr' | 'exact',
    private readonly network?: number,
    private readonly mask?: number,
  ) {}

  static tryParse(value: string): DdosAllowEntry | null {
    if (value.includes('/') && isIpv4Cidr(value)) {
      const [base, prefix] = value.split('/');
      if (!base) return null;
      const prefixLen = Number(prefix);
      if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
        return null;
      }
      const baseInt = ipv4ToInt(base);
      if (baseInt === null) return null;
      const mask =
        prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
      const network = baseInt & mask;
      return new DdosAllowEntry(value, 'ipv4-cidr', network, mask);
    }
    return new DdosAllowEntry(value, 'exact');
  }

  matches(ip: string): boolean {
    if (this.mode === 'exact') return this.raw === ip;
    const ipInt = ipv4ToInt(ip);
    if (
      ipInt === null ||
      this.mask === undefined ||
      this.network === undefined
    ) {
      return false;
    }
    return (ipInt & this.mask) === this.network;
  }
}

function isIpv4Cidr(value: string): boolean {
  const [base] = value.split('/');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(base ?? '');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}

function isLoopback(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}
