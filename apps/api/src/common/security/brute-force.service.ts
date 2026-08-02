import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { AdminAuditService } from '../../modules/admin/admin-audit.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Snapshot of the lockout / credential-stuffing state for a single
 * `(email, ip)` pair, returned by every `BruteForceService` mutator
 * so the caller (typically `AuthService.login`) can decide what to
 * surface back to the client.
 */
export interface BruteForceState {
  /** Cumulative failures recorded against this email. */
  emailFailureCount: number;
  /** Cumulative failures recorded against this IP. */
  ipFailureCount: number;
  /** Whether this email is currently locked. */
  emailLocked: boolean;
  /** Whether this IP is currently locked (rate or credential stuffing). */
  ipLocked: boolean;
  /** Email lockout expiry, or `null` when not locked. */
  emailLockoutUntil: Date | null;
  /** IP lockout expiry, or `null` when not locked. */
  ipLockoutUntil: Date | null;
  /** Whether credential stuffing was detected for this IP in the window. */
  suspectedCredentialStuffing: boolean;
}

/** One configurable progressive-lockout tier (per-email). */
export interface LockoutTier {
  /** Inclusive lower bound on the failure counter. */
  readonly threshold: number;
  /** Lockout duration in seconds. */
  readonly durationSec: number;
}

/**
 * Why an IP block was applied — surfaced both in the audit log and
 * in the 429 response details so the SOC can triage quickly.
 */
export type IpLockoutReason = 'IP_RATE' | 'CREDENTIAL_STUFFING';

/**
 * Progressive brute-force lockout + credential-stuffing detection
 * (Task 27.2, Requirements 27.4 / 27.5 / 27.9, Property 16).
 *
 * Counters and flags live in Redis so policy is enforced uniformly
 * across every API instance. Every storage hit is wrapped in
 * `try/catch` and **fails open** — a Redis outage MUST NOT lock every
 * account out (self-DoS is worse than the brute-force window we'd
 * otherwise cover). Failures are logged at `warn` level so SREs have
 * a signal.
 *
 * ## Storage layout
 *
 * | Key                          | Type    | TTL        | Purpose |
 * |------------------------------|---------|------------|---------|
 * | `auth:failed:email:{email}`  | counter | 24 h       | Per-email failure count, drives the progressive tier table |
 * | `auth:failed:ip:{ip}`        | counter | 10 min     | Per-IP failure count, drives the rate-based IP block |
 * | `auth:lockout:email:{email}` | string  | tier-based | Lockout marker storing the expiry timestamp |
 * | `auth:lockout:ip:{ip}`       | string  | 1 h        | Marker for `IP_RATE` or `CREDENTIAL_STUFFING` blocks |
 * | `auth:cs-detect:ip:{ip}`     | set     | 5 min      | Distinct emails attempted from this IP (credential-stuffing heuristic) |
 * | `auth:bf:captcha:{email}`    | string  | 24 h       | Backwards-compatible flag — captcha required on next attempt |
 *
 * ## Per-email progressive tiers (`EMAIL_LOCKOUT_TIERS`)
 *
 * | Failures | Lockout | Notes |
 * |----------|---------|-------|
 * | 1–4      | none    | typo tolerance |
 * | 5        | 1 min   | first lockout |
 * | 10       | 5 min   | escalation |
 * | 15       | 30 min  | escalation |
 * | 20+      | 24 h    | terminal — emit user alert via outbox |
 *
 * The thresholds and durations are exposed as a single static table
 * so they can be tuned in one place. Tests reach for the same table
 * to avoid hard-coding numbers in two places.
 *
 * ## Per-IP rate-based block
 *
 * `IP_RATE_THRESHOLD` failures inside `IP_RATE_WINDOW_SEC` from the
 * same IP → 1-hour block (`IP_LOCKOUT_DURATION_SEC`). The IP counter
 * is intentionally NOT cleared on a successful login — a credential
 * stuffer who occasionally guesses correctly should not erase their
 * tracks.
 *
 * ## Credential-stuffing heuristic
 *
 * `CRED_STUFFING_DISTINCT_EMAILS` distinct email addresses attempted
 * from the same IP inside `CRED_STUFFING_WINDOW_SEC` → 1-hour block.
 * Detected by tracking each attempted email in a Redis SET.
 *
 * ## Audit logging
 *
 * Every applied lockout writes one `AdminAuditLog` row via
 * `AdminAuditService` with action `auth.lockout.email` (per-user) or
 * `auth.lockout.ip` (per-IP), payload `{ threshold, attemptCount,
 * durationSec, reason }`. The audit row has `actorId = null` because
 * the platform itself initiated the action.
 *
 * ## Wiring
 *
 * `AuthService.login` calls `assertNotLocked` at the very top of the
 * flow — before any DB lookup — so the lockout response time does
 * not leak whether the account exists. After the password check we
 * either `recordFailure` (wrong password / unknown user) or
 * `recordSuccess` (clean login resets only the email counter).
 */
@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);

  /**
   * Progressive per-email lockout tiers, ordered by ascending
   * `threshold`. Looked up via `tierForEmailCount` so the table is
   * the single source of truth.
   */
  static readonly EMAIL_LOCKOUT_TIERS: readonly LockoutTier[] = [
    { threshold: 5, durationSec: 60 }, //   1 min
    { threshold: 10, durationSec: 5 * 60 }, //   5 min
    { threshold: 15, durationSec: 30 * 60 }, //  30 min
    { threshold: 20, durationSec: 24 * 60 * 60 }, //  24 h
  ];

  /** TTL for the per-email failure counter — survives the 24h tier. */
  static readonly EMAIL_FAILURE_COUNTER_TTL_SEC = 24 * 60 * 60;

  /** Failures from the same IP inside the window that trigger a block. */
  static readonly IP_RATE_THRESHOLD = 50;

  /** Window over which the per-IP failures are counted. */
  static readonly IP_RATE_WINDOW_SEC = 10 * 60;

  /**
   * Lockout duration applied to either kind of IP block (rate-based
   * OR credential-stuffing). Both reasons share the same TTL so the
   * SOC can reason about IP suspensions uniformly.
   */
  static readonly IP_LOCKOUT_DURATION_SEC = 60 * 60; // 1 h

  /**
   * Distinct-email threshold within `CRED_STUFFING_WINDOW_SEC` that
   * marks the IP as credential stuffing. ">10" in the spec = strictly
   * greater, so we use `>` in the check.
   */
  static readonly CRED_STUFFING_DISTINCT_EMAILS = 10;

  /** Window for credential-stuffing detection. */
  static readonly CRED_STUFFING_WINDOW_SEC = 5 * 60;

  /**
   * TTL for the captcha-required flag — preserved for the existing
   * frontend integration. Cleared by a successful login.
   */
  static readonly CAPTCHA_REQUIRED_TTL_SEC = 24 * 60 * 60;

  /** Outbox topic for the 24-hour terminal-tier user alert. */
  static readonly EMAIL_LOCKOUT_ALERT_TOPIC = 'security.account_locked';

  /** Action strings written into AdminAuditLog. */
  static readonly AUDIT_EMAIL_ACTION = 'auth.lockout.email';
  static readonly AUDIT_IP_ACTION = 'auth.lockout.ip';

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() private readonly prisma?: PrismaClient,
    @Optional() private readonly adminAuditService?: AdminAuditService,
  ) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Throw `429 ACCOUNT_LOCKED` or `429 IP_LOCKED` if either marker
   * is currently active. Call this at the very top of the login
   * flow so the response time is independent of whether the account
   * exists.
   */
  async assertNotLocked(email: string, ip: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedIp = this.normalizeIp(ip);

    // IP block has higher priority in the spec — credential stuffing
    // / abusive IPs are the most serious bucket.
    const ipLockoutUntil = await this.readIpLockoutMarker(normalizedIp);
    if (ipLockoutUntil) {
      throw this.lockedException(
        'IP_LOCKED',
        'Too many failed login attempts from this IP. Please try again later.',
        ipLockoutUntil,
      );
    }

    const emailLockoutUntil =
      await this.readEmailLockoutMarker(normalizedEmail);
    if (emailLockoutUntil) {
      throw this.lockedException(
        'ACCOUNT_LOCKED',
        'Too many failed login attempts on this account. Please wait before trying again.',
        emailLockoutUntil,
      );
    }
  }

  /**
   * Record one failed login attempt. Increments both the per-email
   * and per-IP counters, escalates the lockout tier when a threshold
   * is crossed, and updates the credential-stuffing tracker. Returns
   * the resulting state. Best-effort — never throws on a Redis
   * outage.
   */
  async recordFailure(email: string, ip: string): Promise<BruteForceState> {
    const state = this.emptyState();
    if (!this.redis) {
      return state;
    }

    const normalizedEmail = this.normalizeEmail(email);
    const normalizedIp = this.normalizeIp(ip);

    // Bump both counters in parallel — they're independent keys so
    // there's no ordering requirement and the round-trip cost is
    // halved on a hot login endpoint.
    const [emailCount, ipCount] = await Promise.all([
      this.bumpEmailCounter(normalizedEmail),
      this.bumpIpCounter(normalizedIp),
    ]);
    state.emailFailureCount = emailCount;
    state.ipFailureCount = ipCount;

    // Per-email progressive tier check.
    const tier = BruteForceService.tierForEmailCount(emailCount);
    if (tier && tier.threshold === emailCount) {
      // Apply lockout exactly when the threshold is hit so the audit
      // log gets one row per escalation rather than one per failed
      // attempt past the threshold.
      const lockoutUntil = await this.applyEmailLockout(normalizedEmail, tier);
      state.emailLocked = lockoutUntil !== null;
      state.emailLockoutUntil = lockoutUntil;
      if (lockoutUntil) {
        await this.writeEmailAudit(normalizedEmail, tier, emailCount);
        // Set captcha flag so the frontend can render hCaptcha on the
        // next attempt (Req 27.4).
        await this.setCaptchaRequired(normalizedEmail);
        // 24h tier — terminal escalation. Notify the user.
        if (tier.durationSec >= 24 * 60 * 60) {
          await this.emitEmailLockoutAlert(
            normalizedEmail,
            tier,
            emailCount,
            'TERMINAL',
          );
        }
      }
    } else if (tier) {
      // Already past the threshold — surface the current lockout in
      // the returned state but do not re-apply / re-audit.
      const existing = await this.readEmailLockoutMarker(normalizedEmail);
      state.emailLocked = existing !== null;
      state.emailLockoutUntil = existing;
    }

    // Per-IP rate-based block — fires the first time we cross the
    // threshold inside the rolling 10-minute window.
    if (ipCount === BruteForceService.IP_RATE_THRESHOLD) {
      const ipLockoutUntil = await this.applyIpLockout(normalizedIp, 'IP_RATE');
      state.ipLocked = ipLockoutUntil !== null;
      state.ipLockoutUntil = ipLockoutUntil;
      if (ipLockoutUntil) {
        await this.writeIpAudit(normalizedIp, 'IP_RATE', ipCount);
      }
    } else if (ipCount > BruteForceService.IP_RATE_THRESHOLD) {
      const existing = await this.readIpLockoutMarker(normalizedIp);
      state.ipLocked = existing !== null;
      state.ipLockoutUntil = existing;
    }

    // Credential-stuffing tracker — distinct emails attempted from
    // this IP inside the window.
    const suspected = await this.trackDistinctEmail(
      normalizedIp,
      normalizedEmail,
    );
    if (suspected && !state.ipLocked) {
      const ipLockoutUntil = await this.applyIpLockout(
        normalizedIp,
        'CREDENTIAL_STUFFING',
      );
      state.ipLocked = ipLockoutUntil !== null;
      state.ipLockoutUntil = ipLockoutUntil;
      state.suspectedCredentialStuffing = ipLockoutUntil !== null;
      if (ipLockoutUntil) {
        await this.writeIpAudit(
          normalizedIp,
          'CREDENTIAL_STUFFING',
          BruteForceService.CRED_STUFFING_DISTINCT_EMAILS + 1,
        );
      }
    } else {
      state.suspectedCredentialStuffing = suspected;
    }

    return state;
  }

  /**
   * Clear the per-email failure counter, lockout marker, and
   * captcha-required flag after a successful login. The per-IP
   * counter is intentionally **NOT** cleared — it tracks abuse
   * across the whole IP, not just this user, so wiping it would
   * help a credential stuffer who happened to land on a real
   * password.
   */
  async recordSuccess(email: string, ip: string): Promise<void> {
    if (!this.redis) return;

    const normalizedEmail = this.normalizeEmail(email);
    void ip; // ip not used — see method docstring.

    const keys = [
      this.emailCounterKey(normalizedEmail),
      this.emailLockoutKey(normalizedEmail),
      this.captchaRequiredKey(normalizedEmail),
    ];

    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.redis!.del(key);
        } catch (err) {
          this.logger.warn(
            `BruteForceService.recordSuccess: Redis DEL failed for key="${key}": ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Returns whether the next login attempt for `email` must include
   * a captcha solution. Set when a per-email lockout is applied and
   * cleared on the next successful login.
   */
  async isCaptchaRequired(email: string): Promise<boolean> {
    if (!this.redis) return false;
    const normalizedEmail = this.normalizeEmail(email);
    try {
      return await this.redis.exists(this.captchaRequiredKey(normalizedEmail));
    } catch (err) {
      this.logger.warn(
        `BruteForceService.isCaptchaRequired: Redis EXISTS failed for ${normalizedEmail}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Tier lookup helper — returns the highest tier whose threshold is
   * `<= count`, or `null` for counts below the first threshold.
   * Exposed as a static so tests reuse the same table.
   */
  static tierForEmailCount(count: number): LockoutTier | null {
    let active: LockoutTier | null = null;
    for (const tier of BruteForceService.EMAIL_LOCKOUT_TIERS) {
      if (count >= tier.threshold) {
        active = tier;
      } else {
        break;
      }
    }
    return active;
  }

  // =====================================================================
  // Internals — counters
  // =====================================================================

  private async bumpEmailCounter(email: string): Promise<number> {
    if (!this.redis) return 0;
    const key = this.emailCounterKey(email);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(
          key,
          BruteForceService.EMAIL_FAILURE_COUNTER_TTL_SEC,
        );
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `BruteForceService.bumpEmailCounter: Redis INCR failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  private async bumpIpCounter(ip: string): Promise<number> {
    if (!this.redis) return 0;
    const key = this.ipCounterKey(ip);
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(
          key,
          BruteForceService.IP_RATE_WINDOW_SEC,
        );
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `BruteForceService.bumpIpCounter: Redis INCR failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // =====================================================================
  // Internals — lockout markers
  // =====================================================================

  private async readEmailLockoutMarker(email: string): Promise<Date | null> {
    return this.readLockoutMarker(this.emailLockoutKey(email));
  }

  private async readIpLockoutMarker(ip: string): Promise<Date | null> {
    return this.readLockoutMarker(this.ipLockoutKey(ip));
  }

  private async readLockoutMarker(key: string): Promise<Date | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `BruteForceService.readLockoutMarker: Redis GET failed for ${key}: ${(err as Error).message}`,
      );
      // Fail open — better to let the attempt through than DoS the
      // whole platform when Redis hiccups.
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
    tier: LockoutTier,
  ): Promise<Date | null> {
    return this.applyLockout(this.emailLockoutKey(email), tier.durationSec);
  }

  private async applyIpLockout(
    ip: string,
    reason: IpLockoutReason,
  ): Promise<Date | null> {
    void reason; // reason is forwarded to the audit log, not the marker payload.
    return this.applyLockout(
      this.ipLockoutKey(ip),
      BruteForceService.IP_LOCKOUT_DURATION_SEC,
    );
  }

  private async applyLockout(
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
        `BruteForceService.applyLockout: Redis SET failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // =====================================================================
  // Internals — credential-stuffing tracker
  // =====================================================================

  /**
   * Add `email` to the per-IP distinct-emails set. Returns `true`
   * when the new cardinality crosses the credential-stuffing
   * threshold so the caller knows to apply the IP block.
   */
  private async trackDistinctEmail(
    ip: string,
    email: string,
  ): Promise<boolean> {
    if (!this.redis) return false;
    const key = this.distinctEmailsKey(ip);
    let distinct = 0;
    try {
      const client = this.redis.getClient();
      const added = await client.sadd(key, email);
      if (added === 1) {
        // First member added in this window — set the TTL with NX so
        // we don't keep refreshing the window on every new email.
        await client.expire(
          key,
          BruteForceService.CRED_STUFFING_WINDOW_SEC,
          'NX',
        );
      }
      distinct = await client.scard(key);
    } catch (err) {
      this.logger.warn(
        `BruteForceService.trackDistinctEmail: SADD/SCARD failed for ${key}: ${(err as Error).message}`,
      );
      return false;
    }
    return distinct > BruteForceService.CRED_STUFFING_DISTINCT_EMAILS;
  }

  // =====================================================================
  // Internals — captcha flag
  // =====================================================================

  private async setCaptchaRequired(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.captchaRequiredKey(email),
        '1',
        BruteForceService.CAPTCHA_REQUIRED_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `BruteForceService.setCaptchaRequired: failed to set captcha flag for ${email}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals — audit + alerting
  // =====================================================================

  private async writeEmailAudit(
    email: string,
    tier: LockoutTier,
    attemptCount: number,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        BruteForceService.AUDIT_EMAIL_ACTION,
        email,
        {
          threshold: tier.threshold,
          attemptCount,
          durationSec: tier.durationSec,
        },
      );
    } catch (err) {
      this.logger.warn(
        `BruteForceService.writeEmailAudit: failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  private async writeIpAudit(
    ip: string,
    reason: IpLockoutReason,
    attemptCount: number,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        BruteForceService.AUDIT_IP_ACTION,
        ip,
        {
          reason,
          threshold:
            reason === 'IP_RATE'
              ? BruteForceService.IP_RATE_THRESHOLD
              : BruteForceService.CRED_STUFFING_DISTINCT_EMAILS,
          attemptCount,
          durationSec: BruteForceService.IP_LOCKOUT_DURATION_SEC,
        },
        { ip },
      );
    } catch (err) {
      this.logger.warn(
        `BruteForceService.writeIpAudit: failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Emit a single outbox event for the 24-hour terminal email
   * lockout. The notifications worker turns this into an
   * "unusual activity / account locked" email to the user.
   */
  private async emitEmailLockoutAlert(
    email: string,
    tier: LockoutTier,
    attemptCount: number,
    severity: 'TERMINAL',
  ): Promise<void> {
    if (!this.outboxService || !this.prisma) return;
    try {
      const detectedAt = new Date().toISOString();
      await this.prisma.$transaction(async (tx) => {
        await this.outboxService!.create(tx, {
          topic: BruteForceService.EMAIL_LOCKOUT_ALERT_TOPIC,
          payload: {
            email,
            severity,
            threshold: tier.threshold,
            attemptCount,
            durationSec: tier.durationSec,
            detectedAt,
          },
          // Per-tier per-email idempotency — replays land on the same
          // key and are skipped by `OutboxService.create`.
          idempotencyKey: `${BruteForceService.EMAIL_LOCKOUT_ALERT_TOPIC}:${email}:${tier.threshold}`,
        });
      });
    } catch (err) {
      this.logger.warn(
        `BruteForceService.emitEmailLockoutAlert: failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals — exception construction + helpers
  // =====================================================================

  /**
   * Construct the 429 HttpException. Includes the standard
   * `Retry-After`-style hint inside `details` so the client can
   * render a countdown without parsing the response date header.
   */
  private lockedException(
    code: 'ACCOUNT_LOCKED' | 'IP_LOCKED',
    message: string,
    until: Date,
  ): HttpException {
    const retryAfter = Math.max(
      1,
      Math.ceil((until.getTime() - Date.now()) / 1000),
    );
    return new HttpException(
      {
        code,
        message,
        details: {
          retryAfter,
          retryAfterUntil: until.toISOString(),
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private emptyState(): BruteForceState {
    return {
      emailFailureCount: 0,
      ipFailureCount: 0,
      emailLocked: false,
      ipLocked: false,
      emailLockoutUntil: null,
      ipLockoutUntil: null,
      suspectedCredentialStuffing: false,
    };
  }

  // =====================================================================
  // Internals — key helpers (centralised so naming is single-sourced)
  // =====================================================================

  private emailCounterKey(email: string): string {
    return `auth:failed:email:${email}`;
  }

  private ipCounterKey(ip: string): string {
    return `auth:failed:ip:${ip}`;
  }

  private emailLockoutKey(email: string): string {
    return `auth:lockout:email:${email}`;
  }

  private ipLockoutKey(ip: string): string {
    return `auth:lockout:ip:${ip}`;
  }

  private distinctEmailsKey(ip: string): string {
    return `auth:cs-detect:ip:${ip}`;
  }

  private captchaRequiredKey(email: string): string {
    return `auth:bf:captcha:${email}`;
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim();
  }
}
