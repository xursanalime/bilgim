import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Result of one bucket check. `allowed=false` means the request
 * exhausted the bucket and MUST be rejected with `429
 * RATE_LIMIT_EXCEEDED` plus a `Retry-After` header.
 */
export interface BucketResult {
  allowed: boolean;
  /** Tokens left in the bucket *after* this call. */
  remaining: number;
  /** Seconds until at least one token is available again. 0 when allowed. */
  retryAfterSeconds: number;
  /** Effective bucket capacity (env-tuned). */
  capacity: number;
}

/**
 * Tier of bucket evaluated. Surfaced in the 429 envelope so a client
 * can distinguish "your IP is hot" from "your account is hot".
 */
export type RateLimitTier = 'IP' | 'USER';

/**
 * Tunable defaults documented in Task 27.1, Requirement 27.2:
 *
 *   - Per-IP:   1000 req / 60s
 *   - Per-user:  300 req / 60s (only when authenticated)
 *
 * These values intentionally exceed the per-route limits enforced by
 * `RateLimitInterceptor` (100 / 300 req / 60s on individual routes).
 * The two layers are complementary — the per-route bucket protects a
 * single endpoint; this guard protects the API as a whole. A small
 * gap between them is fine: a client that hammers a single endpoint
 * will trip the per-route interceptor first; a client that fans out
 * across many endpoints will trip this guard first.
 */
export const SECURITY_RATE_LIMIT_DEFAULTS = {
  /** Per-IP token-bucket capacity (req per `IP_WINDOW_SECONDS`). */
  IP_CAPACITY: 1000,
  IP_WINDOW_SECONDS: 60,
  /** Per-user token-bucket capacity (req per `USER_WINDOW_SECONDS`). */
  USER_CAPACITY: 300,
  USER_WINDOW_SECONDS: 60,
} as const;

/**
 * Path prefixes that bypass the guard entirely. Health and metrics
 * endpoints are kept open so kubelet probes / Prometheus scrapes are
 * never throttled — the same exclusion list used by the WAF and
 * DDoS guards.
 */
const SKIP_PATH_PREFIXES = [
  '/health',
  '/metrics',
  '/api/v1/health',
  '/api/v1/metrics',
];

/**
 * Subset of an Express request the guard reads. Defined locally so
 * we don't depend on `@types/express` for unit tests.
 */
interface RateLimitRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  user?: { sub?: string; id?: string } | null;
}

/**
 * Application-level token-bucket rate-limit guard (Task 27.1, Req 27.2).
 *
 * Two buckets evaluated per request, both must pass:
 *
 *   1. **Per-IP** — `RATE_LIMIT_IP_CAPACITY` (default 1000) tokens,
 *      refilled at `capacity / window` tokens per second. Always
 *      evaluated.
 *   2. **Per-user** — `RATE_LIMIT_USER_CAPACITY` (default 300) tokens,
 *      same algorithm. Only evaluated when `request.user` carries a
 *      `sub` or `id` (i.e. an authenticated request).
 *
 * Storage layout (Redis hash, lazy refill):
 *
 *   - `rl:tb:ip:{ip}` — `{ tokens, updated }`
 *   - `rl:tb:user:{userId}` — `{ tokens, updated }`
 *
 * On rejection the response carries:
 *   - HTTP `429 TOO_MANY_REQUESTS`
 *   - JSON envelope `{ code: 'RATE_LIMIT_EXCEEDED', tier, retryAfterSeconds }`
 *   - `Retry-After: <seconds>` header
 *
 * Fail-open posture: every Redis call is wrapped in try/catch and
 * defaults to "allowed". A Redis outage MUST NOT lock every IP out
 * of the platform.
 *
 * **Order vs other guards**: this guard is wired AFTER `DdosGuard`
 * and BEFORE `JwtAuthGuard`. The DDoS guard rejects the obviously
 * abusive flood first (cheap sliding-window counter); this guard
 * applies the stricter, per-IP / per-user budget; auth runs after
 * both so token validation never wastes cycles on rejected traffic.
 */
@Injectable()
export class SecurityRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(SecurityRateLimitGuard.name);

  private readonly ipCapacity: number;
  private readonly ipWindowSec: number;
  private readonly userCapacity: number;
  private readonly userWindowSec: number;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() configService?: ConfigService<EnvConfig, true>,
  ) {
    this.ipCapacity = clampPositiveInt(
      configService?.get('SECURITY_RATE_LIMIT_IP', { infer: true }) as
        | number
        | undefined,
      SECURITY_RATE_LIMIT_DEFAULTS.IP_CAPACITY,
    );
    this.ipWindowSec = clampPositiveInt(
      configService?.get('SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS', {
        infer: true,
      }) as number | undefined,
      SECURITY_RATE_LIMIT_DEFAULTS.IP_WINDOW_SECONDS,
    );
    this.userCapacity = clampPositiveInt(
      configService?.get('SECURITY_RATE_LIMIT_USER', { infer: true }) as
        | number
        | undefined,
      SECURITY_RATE_LIMIT_DEFAULTS.USER_CAPACITY,
    );
    this.userWindowSec = clampPositiveInt(
      configService?.get('SECURITY_RATE_LIMIT_USER_WINDOW_SECONDS', {
        infer: true,
      }) as number | undefined,
      SECURITY_RATE_LIMIT_DEFAULTS.USER_WINDOW_SECONDS,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitRequest>();

    if (this.shouldSkip(request)) return true;

    const ip = extractClientIp(request);
    const userId =
      (request.user?.sub ?? request.user?.id ?? '').toString().trim() || null;

    // 1) Per-IP bucket — always evaluated.
    const ipResult = await this.consumeBucket(
      ipBucketKey(ip),
      this.ipCapacity,
      this.ipWindowSec,
    );
    if (!ipResult.allowed) {
      this.applyRetryAfter(http, ipResult.retryAfterSeconds);
      this.logger.warn({
        event: 'rate_limit.exceeded',
        message: 'Per-IP rate limit exhausted',
        tier: 'IP' as RateLimitTier,
        clientIp: ip,
        capacity: ipResult.capacity,
        retryAfterSeconds: ipResult.retryAfterSeconds,
        method: request.method ?? 'GET',
        path: sanitisePath(request),
      });
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Request rate exceeded — please slow down',
          tier: 'IP',
          retryAfterSeconds: ipResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2) Per-user bucket — only when authenticated.
    if (userId) {
      const userResult = await this.consumeBucket(
        userBucketKey(userId),
        this.userCapacity,
        this.userWindowSec,
      );
      if (!userResult.allowed) {
        this.applyRetryAfter(http, userResult.retryAfterSeconds);
        this.logger.warn({
          event: 'rate_limit.exceeded',
          message: 'Per-user rate limit exhausted',
          tier: 'USER' as RateLimitTier,
          clientIp: ip,
          userId,
          capacity: userResult.capacity,
          retryAfterSeconds: userResult.retryAfterSeconds,
          method: request.method ?? 'GET',
          path: sanitisePath(request),
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Request rate exceeded — please slow down',
            tier: 'USER',
            retryAfterSeconds: userResult.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  // ------------------------------------------------------------------
  // Read-only views for diagnostics / tests
  // ------------------------------------------------------------------

  get ipLimit(): number {
    return this.ipCapacity;
  }

  get userLimit(): number {
    return this.userCapacity;
  }

  get ipWindowSeconds(): number {
    return this.ipWindowSec;
  }

  get userWindowSeconds(): number {
    return this.userWindowSec;
  }

  // ------------------------------------------------------------------
  // Token bucket implementation
  // ------------------------------------------------------------------

  /**
   * Consume one token from the bucket identified by `key`. Lazy
   * refill: the elapsed wall-clock since the last call drives the
   * refill arithmetic, so we don't need a background timer.
   *
   * The implementation uses a Redis pipeline (HMGET → HMSET → EXPIRE)
   * rather than a Lua script. The pipeline isn't strictly atomic, but
   * the worst-case race lets a single extra request through —
   * acceptable for a coarse-grained 1000 / 300 req/min limit.
   *
   * The key TTL is `2 × windowSeconds` so an idle bucket eventually
   * fades out without holding storage forever.
   */
  private async consumeBucket(
    key: string,
    capacity: number,
    windowSeconds: number,
  ): Promise<BucketResult> {
    if (!this.redis) {
      // Tests and dev that don't wire Redis fall through cleanly.
      return {
        allowed: true,
        remaining: capacity,
        retryAfterSeconds: 0,
        capacity,
      };
    }

    const refillRatePerMs = capacity / (windowSeconds * 1000);
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

      // Lazy refill — top up based on elapsed wall-clock, capped at
      // the bucket's capacity so a long-idle IP doesn't accumulate
      // unlimited burst headroom.
      const elapsedMs = Math.max(0, now - updated);
      tokens = Math.min(capacity, tokens + elapsedMs * refillRatePerMs);

      if (tokens >= 1) {
        tokens -= 1;
        await client.hmset(key, {
          tokens: tokens.toFixed(6),
          updated: String(now),
        });
        await client.expire(key, windowSeconds * 2);
        return {
          allowed: true,
          remaining: tokens,
          retryAfterSeconds: 0,
          capacity,
        };
      }

      // Bucket empty — record the current state without consuming
      // and return the wait time until the next token arrives.
      await client.hmset(key, {
        tokens: tokens.toFixed(6),
        updated: String(now),
      });
      await client.expire(key, windowSeconds * 2);

      const tokensNeeded = 1 - tokens;
      const msUntilToken = tokensNeeded / refillRatePerMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(msUntilToken / 1000));

      return {
        allowed: false,
        remaining: tokens,
        retryAfterSeconds,
        capacity,
      };
    } catch (err) {
      this.logger.warn(
        `SecurityRateLimitGuard: Redis error for ${key}: ${(err as Error).message}`,
      );
      // Fail open — never lock every caller out on a Redis blip.
      return {
        allowed: true,
        remaining: capacity,
        retryAfterSeconds: 0,
        capacity,
      };
    }
  }

  private applyRetryAfter(
    http: ReturnType<ExecutionContext['switchToHttp']>,
    retryAfterSeconds: number,
  ): void {
    const response = http.getResponse<{
      setHeader?: (name: string, value: string) => unknown;
    }>();
    if (response && typeof response.setHeader === 'function') {
      try {
        response.setHeader(
          'Retry-After',
          String(Math.max(1, retryAfterSeconds)),
        );
      } catch {
        /* socket already gone */
      }
    }
  }

  private shouldSkip(req: RateLimitRequest): boolean {
    const raw = req.originalUrl ?? req.url ?? req.path ?? '';
    if (!raw) return false;
    const pathOnly = raw.split('?')[0] ?? '';
    return SKIP_PATH_PREFIXES.some((prefix) => pathOnly.startsWith(prefix));
  }
}

// =====================================================================
// Helpers
// =====================================================================

function ipBucketKey(ip: string): string {
  return `rl:tb:ip:${ip}`;
}

function userBucketKey(userId: string): string {
  return `rl:tb:user:${userId}`;
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function extractClientIp(req: RateLimitRequest): string {
  // `req.ip` first — see the identical note in `waf.middleware.ts`.
  // Reading the spoofable `x-forwarded-for` header first made this
  // guard's per-IP buckets trivially bypassable.
  const direct =
    req.ip ?? req.connection?.remoteAddress ?? req.socket?.remoteAddress;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return 'unknown';
}

function sanitisePath(req: RateLimitRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
