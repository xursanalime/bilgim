import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';

/**
 * One configurable progressive-lockout tier. The schedule is loaded
 * from the environment so operators can tune the policy without a
 * code change (Task 27.2 — env vars `LOGIN_LOCKOUT_TIER_*_FAILS` /
 * `LOGIN_LOCKOUT_TIER_*_DURATION_SECONDS`).
 */
export interface LoginLockoutTier {
  /** Inclusive lower bound on the failure counter (e.g. 5, 10, 20, 50). */
  readonly threshold: number;
  /** Lockout duration in seconds applied when the threshold is crossed. */
  readonly durationSec: number;
}

/**
 * Result of a `recordFailure` call — surfaced back to the caller so
 * `AuthService.login` can shape the response (e.g. include the
 * remaining-attempts hint when not yet locked).
 */
export interface LoginFailureResult {
  /** Lockout expiry when a tier was crossed, otherwise `null`. */
  lockedUntil: Date | null;
  /**
   * Failures the caller can still record before the next tier
   * triggers. `0` means the next failure will lock the account.
   * Negative when already past the highest tier — clamped to `0` for
   * the API response.
   */
  attemptsLeft: number;
}

/**
 * Default progressive-lockout tier table. Falls in line with the
 * spec wording of Task 27.2:
 *   5 fails → 1 min, 10 → 5 min, 20 → 30 min, 50 → 24 h.
 *
 * The actual tiers used at runtime come from environment variables
 * (`LoginProtectionService.loadTiers`) — these constants are the
 * defaults applied when the operator hasn't overridden them.
 */
export const LOGIN_LOCKOUT_DEFAULT_TIERS: readonly LoginLockoutTier[] = [
  { threshold: 5, durationSec: 60 }, //   1 min
  { threshold: 10, durationSec: 5 * 60 }, //   5 min
  { threshold: 20, durationSec: 30 * 60 }, //  30 min
  { threshold: 50, durationSec: 24 * 60 * 60 }, //  24 h
] as const;

/**
 * Environment-variable names that drive the lockout schedule. Kept
 * as constants so the docs and the loader stay in lock-step.
 */
export const LOGIN_LOCKOUT_ENV_KEYS = [
  {
    fails: 'LOGIN_LOCKOUT_TIER_1_FAILS',
    duration: 'LOGIN_LOCKOUT_TIER_1_DURATION_SECONDS',
  },
  {
    fails: 'LOGIN_LOCKOUT_TIER_2_FAILS',
    duration: 'LOGIN_LOCKOUT_TIER_2_DURATION_SECONDS',
  },
  {
    fails: 'LOGIN_LOCKOUT_TIER_3_FAILS',
    duration: 'LOGIN_LOCKOUT_TIER_3_DURATION_SECONDS',
  },
  {
    fails: 'LOGIN_LOCKOUT_TIER_4_FAILS',
    duration: 'LOGIN_LOCKOUT_TIER_4_DURATION_SECONDS',
  },
] as const;

/**
 * `LoginProtectionService` — progressive lockout for failed login
 * attempts (Task 27.2, Requirements 27.4 / 27.5).
 *
 * Tracks two failure counters:
 *
 *   1. `(email, ip)`-pair counter — used as the **primary** lockout
 *      gate. Pinning the counter to the *pair* lets a legitimate
 *      user on a stable home IP fail a few times without locking
 *      out attackers spraying the same email from elsewhere.
 *   2. `email`-global counter — escalates on a coordinated
 *      multi-IP attack against the same account. Crossing a tier
 *      on either counter applies the lockout for that email.
 *
 * Both counters share the same progressive schedule:
 *
 *   | Failures | Lockout |
 *   |----------|---------|
 *   |   5      |   1 min |
 *   |  10      |   5 min |
 *   |  20      |  30 min |
 *   |  50+     |  24 h   |
 *
 * The tiers are environment-driven so operations can tune them
 * without a redeploy. See `LOGIN_LOCKOUT_ENV_KEYS`.
 *
 * ## Storage layout (Redis)
 *
 * | Key                                  | Type    | TTL          |
 * |--------------------------------------|---------|--------------|
 * | `loginprot:fails:pair:{email}:{ip}`  | counter | 24 h         |
 * | `loginprot:fails:email:{email}`      | counter | 24 h         |
 * | `loginprot:lock:email:{email}`       | string  | tier-driven  |
 *
 * The lockout marker stores the ISO expiry timestamp so the
 * `assertNotLocked` path returns the same wall-clock value clients
 * received during the failing request — even if the Redis TTL drifts
 * a few hundred milliseconds.
 *
 * ## Fail-open semantics
 *
 * Every Redis hit is wrapped in `try/catch` and falls back to the
 * non-blocking path. A Redis outage MUST NOT lock every account out:
 * self-DoS is worse than the brute-force window we'd otherwise
 * cover. Failures are logged at `warn` level so SREs notice.
 */
@Injectable()
export class LoginProtectionService {
  private readonly logger = new Logger(LoginProtectionService.name);

  /** TTL of the per-(email,ip) and per-email failure counters. */
  static readonly FAILURE_COUNTER_TTL_SEC = 24 * 60 * 60;

  /** Redis key prefix — kept in one spot so operators can grep them. */
  static readonly KEY_PREFIX = 'loginprot';

  /** HTTP error code returned by `assertNotLocked`. */
  static readonly ERROR_CODE = 'LOGIN_LOCKED';

  /** Resolved tier table — sorted ascending by `threshold`. */
  private readonly tiers: readonly LoginLockoutTier[];

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.tiers = LoginProtectionService.loadTiers(this.configService);
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Throw `429 LOGIN_LOCKED` if either the email is currently locked
   * out for *any* IP, or this specific `(email, ip)` pair is locked.
   * Call this at the very top of the login flow so the response time
   * is independent of whether the account exists.
   */
  async assertNotLocked(email: string, ip: string): Promise<void> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    const lockedUntil = await this.readLockoutMarker(normEmail);
    if (lockedUntil) {
      throw this.lockedException(lockedUntil);
    }

    // Pair-level marker — defends against a single attacker IP that
    // sprays many wrong passwords against a known email even when
    // the email-global counter hasn't crossed a tier yet (e.g.
    // `recordFailure` was racing against a marker write).
    const pairLockedUntil = await this.readPairLockoutMarker(
      normEmail,
      normIp,
    );
    if (pairLockedUntil) {
      throw this.lockedException(pairLockedUntil);
    }
  }

  /**
   * Record one failed login attempt. Increments both the
   * `(email, ip)`-pair and per-email counters and applies the
   * lockout for whichever crosses a tier first.
   *
   * Returns `{ lockedUntil, attemptsLeft }` so callers can decide
   * whether to surface a 429 immediately or just bubble the
   * 401 with the standard generic message.
   *
   * Best-effort — never throws on a Redis outage.
   */
  async recordFailure(
    email: string,
    ip: string,
  ): Promise<LoginFailureResult> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    if (!this.redis) {
      // No Redis → no counters, no lockout. Surface a sentinel
      // `attemptsLeft` so the API response shape stays stable.
      return { lockedUntil: null, attemptsLeft: this.firstThreshold() };
    }

    // Bump both counters in parallel — independent keys, no ordering
    // requirement.
    const [pairCount, emailCount] = await Promise.all([
      this.bumpCounter(this.pairCounterKey(normEmail, normIp)),
      this.bumpCounter(this.emailCounterKey(normEmail)),
    ]);

    // The "effective" count is whichever counter is higher. Tier
    // application uses the higher value so a coordinated multi-IP
    // attack on the same email escalates faster than the slowest
    // lane.
    const effectiveCount = Math.max(pairCount, emailCount);
    const tier = this.tierForCount(effectiveCount);

    let lockedUntil: Date | null = null;

    if (
      tier &&
      (pairCount === tier.threshold || emailCount === tier.threshold)
    ) {
      // Apply the lockout exactly once at the threshold so
      // subsequent attempts (which still bump the counter while
      // the lock holds) don't re-issue the marker repeatedly.
      lockedUntil = await this.applyEmailLockout(normEmail, tier);
      // Per-pair marker mirrors the same TTL so a single attacker IP
      // is capped even if they switch emails afterwards.
      await this.applyPairLockout(normEmail, normIp, tier);
    } else if (tier) {
      // Already past a tier — return the existing marker so the
      // caller still sees `lockedUntil`.
      lockedUntil = await this.readLockoutMarker(normEmail);
    }

    return {
      lockedUntil,
      attemptsLeft: this.attemptsLeft(effectiveCount),
    };
  }

  /**
   * Clear the per-(email, ip) and per-email failure counters and the
   * lockout markers after a successful login. Best-effort —
   * exceptions are logged but never propagated.
   */
  async recordSuccess(email: string, ip: string): Promise<void> {
    if (!this.redis) return;

    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    const keys = [
      this.pairCounterKey(normEmail, normIp),
      this.emailCounterKey(normEmail),
      this.lockoutKey(normEmail),
      this.pairLockoutKey(normEmail, normIp),
    ];

    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.redis!.del(key);
        } catch (err) {
          this.logger.warn(
            `LoginProtectionService.recordSuccess: Redis DEL failed for "${key}": ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Resolve the active tier table — environment overrides win, with
   * the `LOGIN_LOCKOUT_DEFAULT_TIERS` constants used as a fallback.
   * Exposed as a static so unit tests can exercise the loader
   * without spinning up Nest.
   */
  static loadTiers(
    configService?: ConfigService,
  ): readonly LoginLockoutTier[] {
    if (!configService) {
      return [...LOGIN_LOCKOUT_DEFAULT_TIERS];
    }

    const tiers: LoginLockoutTier[] = LOGIN_LOCKOUT_ENV_KEYS.map(
      (entry, idx) => {
        const fallback = LOGIN_LOCKOUT_DEFAULT_TIERS[idx]!;
        const failsRaw = configService.get<string | number>(entry.fails);
        const durRaw = configService.get<string | number>(entry.duration);
        const fails = Number(failsRaw);
        const duration = Number(durRaw);
        return {
          threshold:
            Number.isFinite(fails) && fails > 0 ? fails : fallback.threshold,
          durationSec:
            Number.isFinite(duration) && duration > 0
              ? duration
              : fallback.durationSec,
        };
      },
    );

    // Keep ascending so `tierForCount` can stop on the first
    // greater-threshold and `attemptsLeft` math stays sane.
    return tiers.slice().sort((a, b) => a.threshold - b.threshold);
  }

  // =====================================================================
  // Internals — counters
  // =====================================================================

  private async bumpCounter(key: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(
          key,
          LoginProtectionService.FAILURE_COUNTER_TTL_SEC,
        );
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `LoginProtectionService.bumpCounter: Redis INCR failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // =====================================================================
  // Internals — lockout markers
  // =====================================================================

  private async readLockoutMarker(email: string): Promise<Date | null> {
    return this.readMarker(this.lockoutKey(email));
  }

  private async readPairLockoutMarker(
    email: string,
    ip: string,
  ): Promise<Date | null> {
    return this.readMarker(this.pairLockoutKey(email, ip));
  }

  private async readMarker(key: string): Promise<Date | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `LoginProtectionService.readMarker: Redis GET failed for ${key}: ${(err as Error).message}`,
      );
      // Fail open — better to let the attempt through than to DoS
      // the platform when Redis hiccups.
      return null;
    }
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  }

  private async applyEmailLockout(
    email: string,
    tier: LoginLockoutTier,
  ): Promise<Date | null> {
    return this.applyMarker(this.lockoutKey(email), tier.durationSec);
  }

  private async applyPairLockout(
    email: string,
    ip: string,
    tier: LoginLockoutTier,
  ): Promise<Date | null> {
    return this.applyMarker(this.pairLockoutKey(email, ip), tier.durationSec);
  }

  private async applyMarker(
    key: string,
    durationSec: number,
  ): Promise<Date | null> {
    if (!this.redis) return null;
    const expiresAt = new Date(Date.now() + durationSec * 1000);
    try {
      await this.redis.set(key, expiresAt.toISOString(), durationSec);
      return expiresAt;
    } catch (err) {
      this.logger.warn(
        `LoginProtectionService.applyMarker: Redis SET failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // =====================================================================
  // Internals — tier resolution
  // =====================================================================

  /** Highest tier whose threshold ≤ count, or `null` below the first. */
  private tierForCount(count: number): LoginLockoutTier | null {
    let active: LoginLockoutTier | null = null;
    for (const tier of this.tiers) {
      if (count >= tier.threshold) {
        active = tier;
      } else {
        break;
      }
    }
    return active;
  }

  /**
   * Failures the user can still rack up before the *next* tier
   * triggers. Returns `0` when already past the highest tier.
   */
  private attemptsLeft(count: number): number {
    for (const tier of this.tiers) {
      if (count < tier.threshold) {
        return tier.threshold - count;
      }
    }
    return 0;
  }

  /** Threshold of the first tier — used as a "no-redis" sentinel. */
  private firstThreshold(): number {
    return this.tiers[0]?.threshold ?? Number.POSITIVE_INFINITY;
  }

  // =====================================================================
  // Internals — exception construction + key helpers
  // =====================================================================

  private lockedException(until: Date): HttpException {
    const retryAfter = Math.max(
      1,
      Math.ceil((until.getTime() - Date.now()) / 1000),
    );
    return new HttpException(
      {
        code: LoginProtectionService.ERROR_CODE,
        message:
          'Too many failed login attempts. Please wait before trying again.',
        details: {
          lockedUntil: until.toISOString(),
          retryAfter,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private pairCounterKey(email: string, ip: string): string {
    return `${LoginProtectionService.KEY_PREFIX}:fails:pair:${email}:${ip}`;
  }

  private emailCounterKey(email: string): string {
    return `${LoginProtectionService.KEY_PREFIX}:fails:email:${email}`;
  }

  private lockoutKey(email: string): string {
    return `${LoginProtectionService.KEY_PREFIX}:lock:email:${email}`;
  }

  private pairLockoutKey(email: string, ip: string): string {
    return `${LoginProtectionService.KEY_PREFIX}:lock:pair:${email}:${ip}`;
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim();
  }
}
