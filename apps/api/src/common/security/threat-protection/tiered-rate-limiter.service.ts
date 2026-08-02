import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Tiered rate limiter (Task 27.1).
 *
 * Beyond the per-route bucket exposed by `RateLimitInterceptor`, the
 * platform applies three coarser, blanket caps that protect the API as
 * a whole:
 *
 *   - **Per-IP burst** — 50 req / sec. Hitting this returns 429 and
 *     bans the IP for 5 seconds.
 *   - **Per-IP global** — 600 req / min. Hitting this returns 429 and
 *     bans the IP for 60 seconds.
 *   - **Per-user** — 1200 req / min for authenticated callers. Hitting
 *     this returns 429 and bans the user (not the IP) for 60 seconds.
 *
 * Each cap has its own Redis key family with a sliding window
 * approximated by EXPIRE-on-first-hit, plus a separate ban marker so
 * a banned actor receives the same 429 for the duration of the ban
 * without re-running the counter.
 *
 * ## Storage layout
 *
 * | Key                                  | Type    | TTL        | Notes                                   |
 * |--------------------------------------|---------|------------|-----------------------------------------|
 * | `tp:rl:ip:burst:{ip}`                | counter | 1s         | Per-IP burst counter                     |
 * | `tp:rl:ip:global:{ip}`               | counter | 60s        | Per-IP global counter                    |
 * | `tp:rl:user:{userId}`                | counter | 60s        | Per-user counter                         |
 * | `tp:ban:ip:burst:{ip}`               | flag    | 5s         | Burst-ban marker                         |
 * | `tp:ban:ip:global:{ip}`              | flag    | 60s        | Global-ban marker                        |
 * | `tp:ban:user:{userId}`               | flag    | 60s        | Per-user ban marker                      |
 *
 * ## Fail-open posture
 *
 * Every Redis call is wrapped in try/catch and falls back to "allowed".
 * A Redis outage MUST NOT lock every IP out of the platform.
 *
 * ## Order of checks
 *
 * 1. User-level ban (when `userId` provided)
 * 2. Burst-ban (per-IP)
 * 3. Global-ban (per-IP)
 * 4. Burst counter (1s window)
 * 5. Global counter (60s window)
 * 6. User counter (60s window, authenticated only)
 *
 * The first failure short-circuits the rest so we don't waste Redis
 * round trips on a request we already know we'll reject.
 */

/** Logical caller — `userId` populated only for authenticated requests. */
export interface RateLimitCaller {
  ip: string;
  userId?: string | null;
}

/**
 * Result of a single `consume` call. `allowed=false` means the caller
 * MUST receive a 429 response with a `Retry-After: retryAfterSeconds`
 * header.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the active limit (or ban) lifts. 0 when allowed. */
  retryAfterSeconds: number;
  /** Which tier rejected the request, or `null` when allowed. */
  reason: RateLimitReason | null;
}

export type RateLimitReason =
  | 'IP_BURST'
  | 'IP_GLOBAL'
  | 'USER';

/**
 * Tunable limits surfaced as constants so tests + monitoring share
 * the same numbers. Operators override via env (see `env.schema.ts`).
 */
export const TIERED_RATE_LIMITS = {
  /** Per-IP burst cap (req per `BURST_WINDOW_SECONDS`). */
  IP_BURST: 50,
  IP_BURST_WINDOW_SECONDS: 1,
  /** Per-IP burst ban duration. */
  IP_BURST_BAN_SECONDS: 5,

  /** Per-IP global cap (req per `IP_GLOBAL_WINDOW_SECONDS`). */
  IP_GLOBAL: 600,
  IP_GLOBAL_WINDOW_SECONDS: 60,
  /** Per-IP global ban duration. */
  IP_GLOBAL_BAN_SECONDS: 60,

  /** Per-user cap (req per `USER_WINDOW_SECONDS`). */
  USER: 1200,
  USER_WINDOW_SECONDS: 60,
  /** Per-user ban duration. */
  USER_BAN_SECONDS: 60,
} as const;

@Injectable()
export class TieredRateLimiterService {
  private readonly logger = new Logger(TieredRateLimiterService.name);

  /** Resolved limits — env overrides applied once at construction. */
  private readonly ipBurst: number;
  private readonly ipBurstWindowSec: number;
  private readonly ipBurstBanSec: number;

  private readonly ipGlobal: number;
  private readonly ipGlobalWindowSec: number;
  private readonly ipGlobalBanSec: number;

  private readonly userLimit: number;
  private readonly userWindowSec: number;
  private readonly userBanSec: number;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() configService?: ConfigService<EnvConfig, true>,
  ) {
    this.ipBurst = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_IP_BURST', { infer: true }) as
        | number
        | undefined,
      TIERED_RATE_LIMITS.IP_BURST,
    );
    this.ipBurstWindowSec = TIERED_RATE_LIMITS.IP_BURST_WINDOW_SECONDS;
    this.ipBurstBanSec = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_IP_BURST_BAN_SECONDS', {
        infer: true,
      }) as number | undefined,
      TIERED_RATE_LIMITS.IP_BURST_BAN_SECONDS,
    );

    this.ipGlobal = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_IP_GLOBAL', { infer: true }) as
        | number
        | undefined,
      TIERED_RATE_LIMITS.IP_GLOBAL,
    );
    this.ipGlobalWindowSec = TIERED_RATE_LIMITS.IP_GLOBAL_WINDOW_SECONDS;
    this.ipGlobalBanSec = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_IP_GLOBAL_BAN_SECONDS', {
        infer: true,
      }) as number | undefined,
      TIERED_RATE_LIMITS.IP_GLOBAL_BAN_SECONDS,
    );

    this.userLimit = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_USER', { infer: true }) as
        | number
        | undefined,
      TIERED_RATE_LIMITS.USER,
    );
    this.userWindowSec = TIERED_RATE_LIMITS.USER_WINDOW_SECONDS;
    this.userBanSec = clampPositiveInt(
      configService?.get('THREAT_RATE_LIMIT_USER_BAN_SECONDS', {
        infer: true,
      }) as number | undefined,
      TIERED_RATE_LIMITS.USER_BAN_SECONDS,
    );
  }

  /**
   * Increment the relevant counters, evaluate the tiers in priority
   * order, and report whether the request fits inside every active
   * quota. Always returns `allowed=true` on a Redis outage.
   */
  async consume(caller: RateLimitCaller): Promise<RateLimitResult> {
    const ip = (caller.ip ?? '').trim() || 'unknown';
    const userId = caller.userId ? String(caller.userId).trim() || null : null;

    if (!this.redis) {
      // Tests and dev that don't wire Redis fall through.
      return { allowed: true, retryAfterSeconds: 0, reason: null };
    }

    // 1) Check existing bans first — they're cheap (single GET each)
    //    and short-circuit before we touch the counters.
    if (userId) {
      const banTtl = await this.banRemaining(this.userBanKey(userId));
      if (banTtl > 0) {
        return ban('USER', banTtl);
      }
    }
    const burstBan = await this.banRemaining(this.ipBurstBanKey(ip));
    if (burstBan > 0) return ban('IP_BURST', burstBan);
    const globalBan = await this.banRemaining(this.ipGlobalBanKey(ip));
    if (globalBan > 0) return ban('IP_GLOBAL', globalBan);

    // 2) Burst counter — 1s window.
    const burstCount = await this.bumpCounter(
      this.ipBurstCounterKey(ip),
      this.ipBurstWindowSec,
    );
    if (burstCount > this.ipBurst) {
      await this.applyBan(this.ipBurstBanKey(ip), this.ipBurstBanSec);
      return ban('IP_BURST', this.ipBurstBanSec);
    }

    // 3) Per-IP global counter — 60s window.
    const globalCount = await this.bumpCounter(
      this.ipGlobalCounterKey(ip),
      this.ipGlobalWindowSec,
    );
    if (globalCount > this.ipGlobal) {
      await this.applyBan(this.ipGlobalBanKey(ip), this.ipGlobalBanSec);
      return ban('IP_GLOBAL', this.ipGlobalBanSec);
    }

    // 4) Per-user counter — only when authenticated.
    if (userId) {
      const userCount = await this.bumpCounter(
        this.userCounterKey(userId),
        this.userWindowSec,
      );
      if (userCount > this.userLimit) {
        await this.applyBan(this.userBanKey(userId), this.userBanSec);
        return ban('USER', this.userBanSec);
      }
    }

    return { allowed: true, retryAfterSeconds: 0, reason: null };
  }

  // -----------------------------------------------------------------
  // Read-only helpers exposed for diagnostics + tests
  // -----------------------------------------------------------------

  get limits(): {
    ipBurst: number;
    ipGlobal: number;
    user: number;
  } {
    return {
      ipBurst: this.ipBurst,
      ipGlobal: this.ipGlobal,
      user: this.userLimit,
    };
  }

  // -----------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------

  private async bumpCounter(
    key: string,
    windowSec: number,
  ): Promise<number> {
    if (!this.redis) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSec);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `TieredRateLimiterService.bumpCounter: Redis error for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Return the remaining TTL (seconds) for a ban marker, or 0 when the
   * marker is absent / unparsable.
   */
  private async banRemaining(key: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const exists = await this.redis.exists(key);
      if (!exists) return 0;
      const client = this.redis.getClient();
      const ttl = await client.ttl(key);
      if (typeof ttl !== 'number' || ttl <= 0) return 0;
      return ttl;
    } catch (err) {
      this.logger.warn(
        `TieredRateLimiterService.banRemaining: Redis error for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private async applyBan(key: string, ttlSec: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, '1', ttlSec);
    } catch (err) {
      this.logger.warn(
        `TieredRateLimiterService.applyBan: Redis error for ${key}: ${(err as Error).message}`,
      );
    }
  }

  // ---- Key helpers — single-sourced naming -----------------------

  private ipBurstCounterKey(ip: string): string {
    return `tp:rl:ip:burst:${ip}`;
  }

  private ipGlobalCounterKey(ip: string): string {
    return `tp:rl:ip:global:${ip}`;
  }

  private userCounterKey(userId: string): string {
    return `tp:rl:user:${userId}`;
  }

  private ipBurstBanKey(ip: string): string {
    return `tp:ban:ip:burst:${ip}`;
  }

  private ipGlobalBanKey(ip: string): string {
    return `tp:ban:ip:global:${ip}`;
  }

  private userBanKey(userId: string): string {
    return `tp:ban:user:${userId}`;
  }
}

// =====================================================================
// Module helpers
// =====================================================================

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function ban(
  reason: RateLimitReason,
  retryAfterSeconds: number,
): RateLimitResult {
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, retryAfterSeconds),
    reason,
  };
}
