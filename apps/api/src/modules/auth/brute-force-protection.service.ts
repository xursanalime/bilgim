import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service';
import { AdminAuditService } from '../admin/admin-audit.service';

/**
 * One step on the progressive lockout ladder. Counters are kept on a
 * per-(email, IP) basis with a fresh window; if `window` failures
 * occur inside `windowSec`, the next attempt is rejected for
 * `lockoutSec`.
 */
export interface BruteForceTier {
  /** Inclusive failure threshold that triggers this tier. */
  readonly threshold: number;
  /** Window over which the threshold is evaluated, in seconds. */
  readonly windowSec: number;
  /** Lockout duration applied when the threshold is crossed. */
  readonly lockoutSec: number;
  /** Stable id used in keys / audit payloads (`tier1`, `tier2`, …). */
  readonly id: string;
}

/**
 * Result of `recordFailure` — surfaced back to `AuthService.login`
 * so the 401 response can carry the lockout state alongside the
 * generic message.
 */
export interface BruteForceFailureResult {
  /** `true` once a tier has been crossed and the lockout is in effect. */
  readonly locked: boolean;
  /** Lockout expiry when locked, otherwise omitted. */
  readonly lockedUntil?: Date;
}

/**
 * Result of the credential-stuffing detection sweep — exposed
 * mostly for unit tests / dashboards. The detector itself is
 * passive: it logs to AdminAuditLog and returns the signal so the
 * caller can decide whether to block.
 */
export interface CredentialStuffingResult {
  /** Distinct IPs the email has been targeted from in the window. */
  readonly distinctIps: number;
  /** `true` once the cardinality strictly exceeds the threshold. */
  readonly detected: boolean;
}

/**
 * `BruteForceProtectionService` — Task 27.2, Property 16
 * (Requirements 27.4, 27.5, 27.9).
 *
 * Per-(email, IP) progressive lockout that protects the login
 * endpoint from password spraying and credential stuffing.
 *
 * ## Tier table (from the task)
 *
 * | Tier | Threshold | Window | Lockout |
 * |------|-----------|--------|---------|
 * | 1    | 5         | 15 min | 5 min   |
 * | 2    | 10        | 1 h    | 1 h     |
 * | 3    | 20        | 24 h   | 24 h    |
 *
 * The tiers are evaluated in order on every failed attempt, so a
 * burst that races past the lower thresholds still applies the
 * highest one. The lockout is reset on a successful login.
 *
 * ## Storage layout (Redis)
 *
 * | Key                          | Type    | TTL          | Purpose |
 * |------------------------------|---------|--------------|---------|
 * | `bf:{email}:{ip}:{tier}`     | counter | tier window  | Failure counter for that tier's window |
 * | `bf:lock:{email}:{ip}`       | string  | tier lockout | Lockout expiry (ISO timestamp) |
 * | `bf:cs:{email}` (set)        | set     | 5 min        | Distinct IPs targeting this email (credential stuffing) |
 * | `bf:cs:detected:{email}`     | string  | 5 min        | Debounce marker — one audit row per window |
 *
 * Each tier counter has its own TTL equal to the tier's window.
 * That keeps the per-tier semantics independent: failures that
 * happened more than 15 minutes ago naturally drop out of tier 1
 * but still count toward tier 2 (1h window) until the 1h boundary
 * passes, and so on.
 *
 * ## Fail-open semantics
 *
 * Every Redis hit is wrapped in `try/catch`. A Redis outage MUST
 * NOT lock every account out — that would be self-inflicted DoS
 * worse than the brute-force window we'd otherwise cover. Failures
 * are logged at `warn` level so SREs notice.
 */
@Injectable()
export class BruteForceProtectionService {
  private readonly logger = new Logger(BruteForceProtectionService.name);

  /**
   * Progressive tier ladder. Ordered ascending by `threshold` so
   * `tierForCount` can stop on the first tier whose counter has
   * not crossed yet.
   */
  static readonly TIERS: readonly BruteForceTier[] = [
    {
      id: 'tier1',
      threshold: 5,
      windowSec: 15 * 60, // 15 min
      lockoutSec: 5 * 60, // 5 min
    },
    {
      id: 'tier2',
      threshold: 10,
      windowSec: 60 * 60, // 1 h
      lockoutSec: 60 * 60, // 1 h
    },
    {
      id: 'tier3',
      threshold: 20,
      windowSec: 24 * 60 * 60, // 24 h
      lockoutSec: 24 * 60 * 60, // 24 h
    },
  ];

  /** Window over which credential stuffing is detected. */
  static readonly CS_WINDOW_SEC = 5 * 60;

  /** Distinct-IP threshold for credential stuffing (strictly greater). */
  static readonly CS_DISTINCT_IPS = 10;

  /** Audit action emitted on credential-stuffing detection. */
  static readonly CS_AUDIT_ACTION = 'auth.credential_stuffing.detected';

  /** Error code surfaced by `assertNotLocked`. */
  static readonly LOCKED_ERROR_CODE = 'ACCOUNT_LOCKED';

  /** Centralised key prefix so operators can grep them. */
  static readonly KEY_PREFIX = 'bf';

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAuditService?: AdminAuditService,
  ) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Reject the request with `429 ACCOUNT_LOCKED` if a lockout
   * marker is currently active for `(email, ip)`. Call at the top
   * of the login flow — before any DB lookup — so the response
   * time of a locked-out attempt does not leak whether the email
   * exists.
   */
  async assertNotLocked(email: string, ip: string): Promise<void> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    const lockedUntil = await this.readLockMarker(normEmail, normIp);
    if (lockedUntil) {
      throw this.buildLockedException(lockedUntil);
    }
  }

  /**
   * Record one failed login attempt. Increments every tier counter
   * (each with its own window TTL) and applies the highest tier
   * whose threshold the failure crossed. The lockout expiry is
   * monotonic — a higher tier overwrites a lower one's marker so
   * the user never sees the lockout shrink without an explicit
   * `recordSuccess`.
   *
   * Returns `{ locked, lockedUntil? }` so callers can shape the
   * 401 response.
   */
  async recordFailure(
    email: string,
    ip: string,
  ): Promise<BruteForceFailureResult> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    // Track the IP for the credential-stuffing detector regardless of
    // whether Redis is available downstream — `recordCredentialStuffing`
    // is itself best-effort and Redis-aware.
    await this.recordCredentialStuffing(normEmail, normIp);

    if (!this.redis) {
      // Already-active lockout markers can still be honoured even
      // without Redis (no-op below); just return a neutral result.
      return { locked: false };
    }

    // Bump every tier counter in parallel — independent keys, no
    // ordering requirement. Each counter has its own TTL equal to
    // the tier's window.
    const counts = await Promise.all(
      BruteForceProtectionService.TIERS.map((tier) =>
        this.bumpCounter(this.tierCounterKey(normEmail, normIp, tier), tier.windowSec),
      ),
    );

    // Walk the ladder from the *top* tier down. The highest tier
    // whose counter has crossed the threshold wins. This means a
    // burst of 20 failures inside 15 minutes correctly applies the
    // 24-hour tier rather than getting stuck on the 5-minute one.
    let crossedTier: BruteForceTier | null = null;
    let crossedCount = 0;
    for (let i = BruteForceProtectionService.TIERS.length - 1; i >= 0; i--) {
      const tier = BruteForceProtectionService.TIERS[i]!;
      const count = counts[i] ?? 0;
      if (count >= tier.threshold) {
        crossedTier = tier;
        crossedCount = count;
        break;
      }
    }

    if (!crossedTier) {
      // Below the first tier — no lockout, surface any pre-existing
      // marker (defensive: a higher tier marker may still be live).
      const existing = await this.readLockMarker(normEmail, normIp);
      return existing
        ? { locked: true, lockedUntil: existing }
        : { locked: false };
    }

    // Apply the marker. We use a "monotonic" write — only overwrite
    // the existing marker if the new expiry would be later, so a
    // lower-tier write that happens to race after a higher-tier
    // crossing can never shorten the lockout.
    const lockedUntil = await this.applyMonotonicMarker(
      normEmail,
      normIp,
      crossedTier,
      crossedCount,
    );

    return lockedUntil
      ? { locked: true, lockedUntil }
      : { locked: false };
  }

  /**
   * Clear the per-(email, ip) failure counters and the lockout
   * marker after a successful login. The credential-stuffing
   * tracker (per-email distinct IPs) is intentionally NOT reset:
   * an attacker who happens to land on the right password should
   * not be able to erase their cross-IP footprint.
   *
   * Best-effort — never throws.
   */
  async recordSuccess(email: string, ip: string): Promise<void> {
    if (!this.redis) return;

    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    const keys = [
      this.lockMarkerKey(normEmail, normIp),
      ...BruteForceProtectionService.TIERS.map((tier) =>
        this.tierCounterKey(normEmail, normIp, tier),
      ),
    ];

    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.redis!.del(key);
        } catch (err) {
          this.logger.warn(
            `recordSuccess: Redis DEL failed for ${key}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  // =====================================================================
  // Credential stuffing — distinct IPs against a single email
  // =====================================================================

  /**
   * Record that `ip` has attempted `email` and check whether the
   * count of distinct IPs targeting this email inside the rolling
   * 5-minute window has crossed the threshold (>10 by default).
   *
   * On the first crossing inside a window we emit a single
   * `auth.credential_stuffing.detected` row to AdminAuditLog. The
   * debounce marker auto-expires with the window so a second wave
   * of activity gets its own audit row.
   */
  async recordCredentialStuffing(
    email: string,
    ip: string,
  ): Promise<CredentialStuffingResult> {
    if (!this.redis) {
      return { distinctIps: 0, detected: false };
    }

    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);
    if (!normEmail || !normIp) {
      return { distinctIps: 0, detected: false };
    }

    const distinctIps = await this.trackDistinctIp(normEmail, normIp);
    const detected = distinctIps > BruteForceProtectionService.CS_DISTINCT_IPS;

    if (detected) {
      const isFresh = await this.markCredentialStuffing(normEmail);
      if (isFresh) {
        await this.writeCredentialStuffingAudit(normEmail, normIp, distinctIps);
      }
    }

    return { distinctIps, detected };
  }

  /**
   * Read-only helper — current cardinality of distinct IPs against
   * `email` in the rolling window. Used by tests and dashboards.
   */
  async distinctIpsForEmail(email: string): Promise<number> {
    if (!this.redis) return 0;
    const normEmail = this.normalizeEmail(email);
    try {
      const client = this.redis.getClient();
      return (await client.scard(this.csIpsKey(normEmail))) ?? 0;
    } catch (err) {
      this.logger.warn(
        `distinctIpsForEmail: SCARD failed for ${normEmail}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // =====================================================================
  // Internals — counters & markers
  // =====================================================================

  private async bumpCounter(
    key: string,
    windowSec: number,
  ): Promise<number> {
    if (!this.redis) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        // First failure in this window — pin the TTL so the counter
        // naturally drops out at the boundary.
        await this.redis.expire(key, windowSec);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `bumpCounter: INCR failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Write the lockout marker only if the new expiry is later than
   * the existing one. This makes the lockout monotonic and lets us
   * skip the audit when nothing actually changed.
   */
  private async applyMonotonicMarker(
    email: string,
    ip: string,
    tier: BruteForceTier,
    crossedCount: number,
  ): Promise<Date | null> {
    if (!this.redis) return null;

    const newExpiry = new Date(Date.now() + tier.lockoutSec * 1000);
    const existing = await this.readLockMarker(email, ip);
    if (existing && existing.getTime() >= newExpiry.getTime()) {
      // A higher tier already has a longer lockout — keep it.
      return existing;
    }

    const key = this.lockMarkerKey(email, ip);
    try {
      await this.redis.set(key, newExpiry.toISOString(), tier.lockoutSec);
    } catch (err) {
      this.logger.warn(
        `applyMonotonicMarker: SET failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }

    void crossedCount; // reserved for future audit/observability hooks
    return newExpiry;
  }

  private async readLockMarker(
    email: string,
    ip: string,
  ): Promise<Date | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(this.lockMarkerKey(email, ip));
    } catch (err) {
      this.logger.warn(
        `readLockMarker: GET failed: ${(err as Error).message}`,
      );
      // Fail open — better to admit one extra request than DoS the
      // platform when Redis hiccups.
      return null;
    }
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  }

  // =====================================================================
  // Internals — credential stuffing
  // =====================================================================

  private async trackDistinctIp(
    email: string,
    ip: string,
  ): Promise<number> {
    if (!this.redis) return 0;
    const key = this.csIpsKey(email);
    try {
      const client = this.redis.getClient();
      const added = await client.sadd(key, ip);
      if (added === 1) {
        // Pin TTL with NX so we don't keep refreshing the rolling
        // window every time a new IP joins.
        await client.expire(
          key,
          BruteForceProtectionService.CS_WINDOW_SEC,
          'NX',
        );
      }
      return await client.scard(key);
    } catch (err) {
      this.logger.warn(
        `trackDistinctIp: SADD/SCARD failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /** Returns `true` exactly once per window — used to debounce audits. */
  private async markCredentialStuffing(email: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.setnx(
        this.csDetectedKey(email),
        new Date().toISOString(),
        BruteForceProtectionService.CS_WINDOW_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `markCredentialStuffing: SETNX failed for ${email}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async writeCredentialStuffingAudit(
    email: string,
    triggeringIp: string,
    distinctIps: number,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        BruteForceProtectionService.CS_AUDIT_ACTION,
        email,
        {
          email,
          distinctIps,
          threshold: BruteForceProtectionService.CS_DISTINCT_IPS,
          windowSec: BruteForceProtectionService.CS_WINDOW_SEC,
          triggeringIp,
          detectedAt: new Date().toISOString(),
        },
        { ip: triggeringIp },
      );
    } catch (err) {
      this.logger.warn(
        `writeCredentialStuffingAudit: failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals — helpers
  // =====================================================================

  private buildLockedException(until: Date): HttpException {
    const retryAfter = Math.max(
      1,
      Math.ceil((until.getTime() - Date.now()) / 1000),
    );
    return new HttpException(
      {
        code: BruteForceProtectionService.LOCKED_ERROR_CODE,
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

  private tierCounterKey(
    email: string,
    ip: string,
    tier: BruteForceTier,
  ): string {
    return `${BruteForceProtectionService.KEY_PREFIX}:${email}:${ip}:${tier.id}`;
  }

  private lockMarkerKey(email: string, ip: string): string {
    return `${BruteForceProtectionService.KEY_PREFIX}:lock:${email}:${ip}`;
  }

  private csIpsKey(email: string): string {
    return `${BruteForceProtectionService.KEY_PREFIX}:cs:${email}`;
  }

  private csDetectedKey(email: string): string {
    return `${BruteForceProtectionService.KEY_PREFIX}:cs:detected:${email}`;
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim();
  }
}
