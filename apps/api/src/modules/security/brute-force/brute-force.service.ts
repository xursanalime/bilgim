import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';
import { isNonBlockableIp } from '../../../common/security/ip-classification';
import { AdminAuditService } from '../../admin/admin-audit.service';
import { SiemService } from '../siem/siem.service';

/**
 * Result of `recordFailedAttempt` — surfaced back to the caller (typically
 * `AuthService.login`) so the 401/403 response can carry the lockout
 * state and the captcha-required flag.
 */
export interface BruteForceFailureResult {
  /**
   * Coarse-grained account state after recording the attempt.
   *  - `NORMAL`        — under threshold, attempt counts but no lock.
   *  - `TEMP_LOCKED`   — 5+ failures in the rolling 15 min window
   *                      → account is temp-locked for 30 min.
   *  - `PERM_LOCKED`   — 3 more failures while temp-locked
   *                      → account is permanently locked, admins paged.
   */
  status: 'NORMAL' | 'TEMP_LOCKED' | 'PERM_LOCKED';
  /** Milliseconds remaining on the active lock (when `status !== NORMAL`). */
  remainingMs?: number;
  /**
   * Whether the next login attempt for this email must include a valid
   * hCaptcha solution. Set the moment a TEMP_LOCKED is applied (Req 27.4).
   */
  captchaRequired: boolean;
}

/** Result of a status read — same shape but without the side-effects. */
export interface BruteForceAccountStatus {
  status: 'NORMAL' | 'TEMP_LOCKED' | 'PERM_LOCKED';
  remainingMs?: number;
  captchaRequired: boolean;
}

/** Result of an IP status read — `IP_BLOCKED` for credential stuffing. */
export interface BruteForceIpStatus {
  blocked: boolean;
  remainingMs?: number;
  /** Distinct accounts attempted from this IP inside the rolling window. */
  distinctAccounts?: number;
}

/**
 * Optional admin notifier — kept abstract so the brute-force service
 * does not need to depend on the notifications module / Prisma.
 * `SecurityModule` wires a concrete adapter (`AdminNotificationAdapter`)
 * that paginates over admin users and emits a `Notification` row plus a
 * fan-out outbox event. Tests can pass a tiny stub.
 */
export interface AdminNotifier {
  notifyAdmins(payload: {
    email: string;
    reason: string;
    emittedAt: Date;
  }): Promise<void>;
}

/** DI token for the optional admin notifier. */
export const ADMIN_NOTIFIER = 'BRUTE_FORCE_ADMIN_NOTIFIER';

/**
 * `BruteForceService` — Task 27.2 (Requirements 27.4, 27.5, 27.9).
 *
 * Per-account brute-force protection plus per-IP credential-stuffing
 * detection. Counters live in Redis so the policy is enforced
 * uniformly across every API instance.
 *
 * ## State machine (per account)
 *
 * ```
 *           failures < 5            failures >= 5
 *   NORMAL ─────────────────────►  TEMP_LOCKED (30 min, captcha required)
 *      ▲                                  │
 *      │ recordSuccessfulLogin            │ 3 more failures while locked
 *      │                                  ▼
 *      └──────────────────────  PERM_LOCKED (admins notified)
 * ```
 *
 *   - **NORMAL → TEMP_LOCKED**:  5 failed attempts in the 15-minute
 *     sliding window flip the account to `TEMP_LOCKED` for 30 min.
 *     hCaptcha becomes mandatory on the next attempt.
 *   - **TEMP_LOCKED → PERM_LOCKED**:  while the temp-lock is active,
 *     3 more failed attempts trip a permanent lock. Admins are paged
 *     via `notifyAdmins()`.
 *   - **TEMP_LOCKED / PERM_LOCKED → NORMAL**:  only via
 *     `recordSuccessfulLogin`. A successful login resets every
 *     counter and clears both locks.
 *
 * ## Credential stuffing (per IP)
 *
 * The service also tracks the cardinality of distinct accounts an
 * IP has attempted inside a rolling 1-hour window. **>= 10** distinct
 * accounts trips a 24-hour `IP_BLOCKED` (Req 27.9). This is independent
 * of the per-account state machine — both run on every failed
 * attempt.
 *
 * ## Storage layout (Redis)
 *
 * | Key                              | Type | TTL       | Purpose |
 * |----------------------------------|------|-----------|---------|
 * | `bf:account:<email>:fails`       | str  | 15 min    | Sliding-window failure counter |
 * | `bf:account:<email>:lock`        | str  | 30 min    | TEMP_LOCKED marker (ISO expiry) |
 * | `bf:account:<email>:perm`        | str  | none      | PERM_LOCKED marker |
 * | `bf:account:<email>:locked_fails`| str  | 30 min    | Failures during TEMP_LOCKED |
 * | `bf:account:<email>:captcha`     | str  | 30 min    | hCaptcha required flag |
 * | `bf:ip:<ip>:accounts`            | set  | 1 h       | Distinct accounts attempted from IP |
 * | `bf:ip:<ip>:block`               | str  | 24 h      | IP_BLOCKED marker |
 *
 * ## Fail-open posture
 *
 * Every Redis hit is wrapped in `try/catch`. A Redis outage MUST NOT
 * lock every account out — that would be self-DoS worse than the
 * brute-force window we'd otherwise cover. Failures are logged at
 * `warn` level so SREs notice.
 */
@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);

  // ----- Tunables (exported as static for tests / dashboards) -------

  /** Failures within `FAIL_WINDOW_SEC` that flip account to TEMP_LOCKED. */
  static readonly TEMP_LOCK_THRESHOLD = 5;

  /** Sliding-window length for the failure counter (15 minutes). */
  static readonly FAIL_WINDOW_SEC = 15 * 60;

  /** TEMP_LOCKED duration (30 minutes). */
  static readonly TEMP_LOCK_DURATION_SEC = 30 * 60;

  /** Failures during TEMP_LOCKED that escalate to PERM_LOCKED. */
  static readonly PERM_LOCK_THRESHOLD = 3;

  /** PERM_LOCKED has no TTL — only `recordSuccessfulLogin` clears it. */
  static readonly PERM_LOCK_DURATION_SEC = 0;

  /** Distinct accounts per IP per 1h that triggers credential-stuffing. */
  static readonly CS_DISTINCT_ACCOUNTS = 10;

  /** Sliding window for credential-stuffing detection (1 hour). */
  static readonly CS_WINDOW_SEC = 60 * 60;

  /** IP block duration when credential stuffing is detected (24 hours). */
  static readonly IP_BLOCK_DURATION_SEC = 24 * 60 * 60;

  /** Redis key prefix — centralised so operators can grep them. */
  static readonly KEY_PREFIX = 'bf';

  /** Audit-log action strings. */
  static readonly ACTION_TEMP_LOCKED = 'security.brute_force.temp_locked';
  static readonly ACTION_PERM_LOCKED = 'security.brute_force.perm_locked';
  static readonly ACTION_IP_BLOCKED = 'security.brute_force.ip_blocked';

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAuditService?: AdminAuditService,
    @Optional()
    @Inject(ADMIN_NOTIFIER)
    private readonly adminNotifier?: AdminNotifier,
    @Optional() private readonly siem?: SiemService,
  ) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Record one failed login attempt for `(email, ip)`. Drives both the
   * per-account state machine and the per-IP credential-stuffing
   * tracker. Returns the post-attempt state so the caller can shape
   * the 401/403 response.
   */
  async recordFailedAttempt(
    email: string,
    ip: string,
  ): Promise<BruteForceFailureResult> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    // Track the IP for credential-stuffing regardless of the
    // per-account flow — both signals are independent.
    await this.trackIpAttempt(normEmail, normIp);

    if (!this.redis) {
      // Redis unreachable — fail open. Already-active locks can't be
      // honoured here either, but the assertion path will catch them
      // when Redis comes back.
      return { status: 'NORMAL', captchaRequired: false };
    }

    // Already permanently locked — every further failure stays in
    // PERM_LOCKED. Don't re-emit notifications for repeat attempts.
    if (await this.isPermLocked(normEmail)) {
      return {
        status: 'PERM_LOCKED',
        captchaRequired: true,
      };
    }

    // Already temp-locked — count this as one of the 3 escalation
    // failures that trip PERM_LOCKED (Req 27.5).
    if (await this.isTempLocked(normEmail)) {
      const lockedFails = await this.bumpCounter(
        this.lockedFailsKey(normEmail),
        BruteForceService.TEMP_LOCK_DURATION_SEC,
      );
      if (lockedFails >= BruteForceService.PERM_LOCK_THRESHOLD) {
        await this.applyPermLock(normEmail);
        await this.writeAccountAudit(
          BruteForceService.ACTION_PERM_LOCKED,
          normEmail,
          { lockedFails, threshold: BruteForceService.PERM_LOCK_THRESHOLD },
        );
        await this.emitSiemEvent({
          type: 'security.brute_force.perm_locked',
          severity: 'CRITICAL',
          ip: normIp,
          payload: {
            email: normEmail,
            lockedFails,
            threshold: BruteForceService.PERM_LOCK_THRESHOLD,
          },
        });
        await this.notifyAdmins(
          normEmail,
          'Account permanently locked after repeated failed attempts during temporary lockout.',
        );
        return {
          status: 'PERM_LOCKED',
          captchaRequired: true,
        };
      }
      // Still inside the 3-failure escalation window — surface the
      // remaining temp-lock TTL so the client can show a countdown.
      const remainingMs = await this.tempLockRemainingMs(normEmail);
      return {
        status: 'TEMP_LOCKED',
        ...(remainingMs !== null ? { remainingMs } : {}),
        captchaRequired: true,
      };
    }

    // Normal path — bump the sliding-window failure counter and check
    // whether the threshold has been crossed.
    const fails = await this.bumpCounter(
      this.failsKey(normEmail),
      BruteForceService.FAIL_WINDOW_SEC,
    );
    if (fails >= BruteForceService.TEMP_LOCK_THRESHOLD) {
      const lockedUntil = await this.applyTempLock(normEmail);
      await this.setCaptchaRequired(normEmail);
      await this.writeAccountAudit(
        BruteForceService.ACTION_TEMP_LOCKED,
        normEmail,
        {
          fails,
          threshold: BruteForceService.TEMP_LOCK_THRESHOLD,
          windowSec: BruteForceService.FAIL_WINDOW_SEC,
          lockoutSec: BruteForceService.TEMP_LOCK_DURATION_SEC,
        },
      );
      await this.emitSiemEvent({
        type: 'security.brute_force.temp_locked',
        severity: 'HIGH',
        ip: normIp,
        payload: {
          email: normEmail,
          fails,
          threshold: BruteForceService.TEMP_LOCK_THRESHOLD,
          windowSec: BruteForceService.FAIL_WINDOW_SEC,
          lockoutSec: BruteForceService.TEMP_LOCK_DURATION_SEC,
        },
      });
      const remainingMs = lockedUntil
        ? Math.max(1, lockedUntil.getTime() - Date.now())
        : BruteForceService.TEMP_LOCK_DURATION_SEC * 1000;
      return {
        status: 'TEMP_LOCKED',
        remainingMs,
        captchaRequired: true,
      };
    }

    // Below threshold — counter recorded, no lock. The captcha flag
    // could already be set from a previous (now-expired) lock — we
    // honour it so the next attempt still requires a solved challenge
    // until a successful login clears it.
    return {
      status: 'NORMAL',
      captchaRequired: await this.readCaptchaRequired(normEmail),
    };
  }

  /**
   * Reset the per-account counters and clear both locks after a
   * successful login. The per-IP credential-stuffing tracker is
   * **not** reset — an attacker who happens to land on the right
   * password should not be able to erase their cross-account
   * footprint (Req 27.9).
   *
   * Best-effort — never throws.
   */
  async recordSuccessfulLogin(email: string, ip: string): Promise<void> {
    if (!this.redis) return;
    const normEmail = this.normalizeEmail(email);
    void ip; // ip not used — see method docstring.

    const keys = [
      this.failsKey(normEmail),
      this.lockKey(normEmail),
      this.permLockKey(normEmail),
      this.lockedFailsKey(normEmail),
      this.captchaKey(normEmail),
    ];

    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.redis!.del(key);
        } catch (err) {
          this.logger.warn(
            `recordSuccessfulLogin: DEL failed for ${key}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  /**
   * Read the current account state without recording a new attempt.
   * Used by the auth flow to gate the request *before* the password
   * check so the response time is independent of whether the
   * account exists.
   */
  async checkAccountStatus(email: string): Promise<BruteForceAccountStatus> {
    const normEmail = this.normalizeEmail(email);

    if (await this.isPermLocked(normEmail)) {
      return { status: 'PERM_LOCKED', captchaRequired: true };
    }

    const tempRemaining = await this.tempLockRemainingMs(normEmail);
    if (tempRemaining !== null) {
      return {
        status: 'TEMP_LOCKED',
        remainingMs: tempRemaining,
        captchaRequired: true,
      };
    }

    return {
      status: 'NORMAL',
      captchaRequired: await this.readCaptchaRequired(normEmail),
    };
  }

  /**
   * Read the current IP block state. Returns `{ blocked, remainingMs }`
   * plus the cardinality of distinct accounts attempted from this IP
   * for dashboards.
   */
  async checkIpStatus(ip: string): Promise<BruteForceIpStatus> {
    const normIp = this.normalizeIp(ip);
    if (!this.redis) {
      return { blocked: false };
    }
    // Mirror of the write-side guard in `trackIpAttempt`: never enforce
    // against infrastructure, so a marker written before that guard
    // existed cannot keep the platform locked out for its full 24h.
    if (isNonBlockableIp(normIp)) {
      return { blocked: false };
    }

    const blockExpiry = await this.readMarker(this.ipBlockKey(normIp));
    if (blockExpiry) {
      const distinctAccounts = await this.distinctAccountsForIp(normIp);
      return {
        blocked: true,
        remainingMs: Math.max(1, blockExpiry.getTime() - Date.now()),
        distinctAccounts,
      };
    }
    const distinctAccounts = await this.distinctAccountsForIp(normIp);
    return distinctAccounts > 0 ? { blocked: false, distinctAccounts } : { blocked: false };
  }

  /**
   * Throw `403 ACCOUNT_LOCKED` / `403 IP_BLOCKED` when the gate is
   * already closed for `(email, ip)`. Call at the very top of the
   * login flow, before any DB lookup, so the response time of a
   * blocked attempt does not leak whether the email exists.
   */
  async assertNotBlocked(email: string, ip: string): Promise<void> {
    // IP block has higher priority — credential stuffing is the most
    // serious bucket and gates every account from the same source.
    const ipStatus = await this.checkIpStatus(ip);
    if (ipStatus.blocked) {
      throw this.buildBlockedException(
        'IP_BLOCKED',
        'This network has been temporarily blocked due to suspicious activity.',
        ipStatus.remainingMs ?? 0,
      );
    }

    const accStatus = await this.checkAccountStatus(email);
    if (accStatus.status === 'PERM_LOCKED') {
      throw this.buildBlockedException(
        'ACCOUNT_LOCKED',
        'This account has been locked. Please contact support.',
        Number.POSITIVE_INFINITY,
        true,
      );
    }
    if (accStatus.status === 'TEMP_LOCKED') {
      throw this.buildBlockedException(
        'ACCOUNT_LOCKED',
        'Too many failed login attempts. Please wait before trying again.',
        accStatus.remainingMs ?? 0,
        true,
      );
    }
  }

  /**
   * Best-effort admin notification fan-out. Public so callers can
   * page admins for other security events without re-implementing
   * the lookup logic. The actual delivery is delegated to the
   * optional `AdminNotifier` (kept abstract so this module does not
   * depend on Notifications/Prisma directly — see `security.module.ts`).
   */
  async notifyAdmins(email: string, reason: string): Promise<void> {
    if (!this.adminNotifier) return;
    try {
      await this.adminNotifier.notifyAdmins({
        email,
        reason,
        emittedAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `notifyAdmins: failed for ${email}: ${(err as Error).message}`,
      );
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

  private async applyTempLock(email: string): Promise<Date | null> {
    if (!this.redis) return null;
    const expiresAt = new Date(
      Date.now() + BruteForceService.TEMP_LOCK_DURATION_SEC * 1000,
    );
    try {
      await this.redis.set(
        this.lockKey(email),
        expiresAt.toISOString(),
        BruteForceService.TEMP_LOCK_DURATION_SEC,
      );
      return expiresAt;
    } catch (err) {
      this.logger.warn(
        `applyTempLock: SET failed for ${email}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async applyPermLock(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      // No TTL — only `recordSuccessfulLogin` clears it.
      await this.redis.set(this.permLockKey(email), new Date().toISOString());
    } catch (err) {
      this.logger.warn(
        `applyPermLock: SET failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  private async applyIpBlock(ip: string): Promise<Date | null> {
    if (!this.redis) return null;
    const expiresAt = new Date(
      Date.now() + BruteForceService.IP_BLOCK_DURATION_SEC * 1000,
    );
    try {
      await this.redis.set(
        this.ipBlockKey(ip),
        expiresAt.toISOString(),
        BruteForceService.IP_BLOCK_DURATION_SEC,
      );
      return expiresAt;
    } catch (err) {
      this.logger.warn(
        `applyIpBlock: SET failed for ${ip}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async setCaptchaRequired(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.captchaKey(email),
        '1',
        BruteForceService.TEMP_LOCK_DURATION_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `setCaptchaRequired: SET failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  private async readCaptchaRequired(email: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.exists(this.captchaKey(email));
    } catch (err) {
      this.logger.warn(
        `readCaptchaRequired: EXISTS failed for ${email}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async isPermLocked(email: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.exists(this.permLockKey(email));
    } catch (err) {
      this.logger.warn(
        `isPermLocked: EXISTS failed for ${email}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async isTempLocked(email: string): Promise<boolean> {
    return (await this.tempLockRemainingMs(email)) !== null;
  }

  private async tempLockRemainingMs(email: string): Promise<number | null> {
    const expiry = await this.readMarker(this.lockKey(email));
    if (!expiry) return null;
    return Math.max(1, expiry.getTime() - Date.now());
  }

  private async readMarker(key: string): Promise<Date | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `readMarker: GET failed for ${key}: ${(err as Error).message}`,
      );
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
  // Internals — credential-stuffing tracker
  // =====================================================================

  /**
   * Add `email` to the per-IP set of distinct accounts attempted.
   * When the cardinality reaches the threshold (>=10) the IP is
   * blocked for 24 hours. Already-blocked IPs short-circuit so we
   * don't keep auditing the same crossing.
   */
  private async trackIpAttempt(email: string, ip: string): Promise<void> {
    if (!this.redis || !ip) return;

    // Credential-stuffing detection buckets by IP, so it must not run
    // against shared infrastructure. Behind the BFF's private address
    // every user on the platform shares one bucket: ten *legitimate*
    // people signing in within the window crosses the distinct-account
    // threshold and blocks the address — and with it everyone, login
    // included. Attribution has to be fixed (BFF_PROXY_SECRET) before
    // this signal means anything. See `isNonBlockableIp`.
    if (isNonBlockableIp(ip)) return;

    // Skip when already blocked — no need to inflate the set further.
    const alreadyBlocked = await this.redis
      .exists(this.ipBlockKey(ip))
      .catch(() => false);
    if (alreadyBlocked) return;

    let distinctAccounts = 0;
    try {
      const client = this.redis.getClient();
      const added = await client.sadd(this.ipAccountsKey(ip), email);
      if (added === 1) {
        // First member added in this window — pin TTL with NX so we
        // don't keep refreshing the rolling window on every new
        // account.
        await client.expire(
          this.ipAccountsKey(ip),
          BruteForceService.CS_WINDOW_SEC,
          'NX',
        );
      }
      distinctAccounts = await client.scard(this.ipAccountsKey(ip));
    } catch (err) {
      this.logger.warn(
        `trackIpAttempt: SADD/SCARD failed for ${ip}: ${(err as Error).message}`,
      );
      return;
    }

    if (distinctAccounts >= BruteForceService.CS_DISTINCT_ACCOUNTS) {
      const blockedUntil = await this.applyIpBlock(ip);
      if (blockedUntil) {
        await this.writeIpAudit(ip, distinctAccounts);
        await this.emitSiemEvent({
          type: 'security.brute_force.ip_blocked',
          severity: 'HIGH',
          ip,
          payload: {
            email,
            distinctAccounts,
            threshold: BruteForceService.CS_DISTINCT_ACCOUNTS,
            windowSec: BruteForceService.CS_WINDOW_SEC,
            lockoutSec: BruteForceService.IP_BLOCK_DURATION_SEC,
          },
        });
        await this.notifyAdmins(
          email,
          `Credential stuffing detected from IP ${ip}: ${distinctAccounts} distinct accounts attempted within 1h.`,
        );
      }
    }
  }

  private async distinctAccountsForIp(ip: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const client = this.redis.getClient();
      return (await client.scard(this.ipAccountsKey(ip))) ?? 0;
    } catch (err) {
      this.logger.warn(
        `distinctAccountsForIp: SCARD failed for ${ip}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // =====================================================================
  // Internals — audit
  // =====================================================================

  private async writeAccountAudit(
    action: string,
    email: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(null, action, email, {
        email,
        ...payload,
        emittedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `writeAccountAudit: failed for ${email}: ${(err as Error).message}`,
      );
    }
  }

  private async writeIpAudit(
    ip: string,
    distinctAccounts: number,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        BruteForceService.ACTION_IP_BLOCKED,
        ip,
        {
          ip,
          distinctAccounts,
          threshold: BruteForceService.CS_DISTINCT_ACCOUNTS,
          windowSec: BruteForceService.CS_WINDOW_SEC,
          lockoutSec: BruteForceService.IP_BLOCK_DURATION_SEC,
          emittedAt: new Date().toISOString(),
        },
        { ip },
      );
    } catch (err) {
      this.logger.warn(
        `writeIpAudit: failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Best-effort SIEM emission. Used when escalating to TEMP_LOCKED /
   * PERM_LOCKED / IP_BLOCKED so the SIEM pipeline (Task 27.5) sees
   * the same auth-side signals it does the WAF / honeypot ones. The
   * service is `@Optional()` so unit tests that don't provide it
   * keep working unchanged.
   */
  private async emitSiemEvent(input: {
    type:
      | 'security.brute_force.temp_locked'
      | 'security.brute_force.perm_locked'
      | 'security.brute_force.ip_blocked';
    severity: 'HIGH' | 'CRITICAL';
    ip: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (!this.siem) return;
    try {
      await this.siem.recordEvent({
        type: input.type,
        severity: input.severity,
        ip: input.ip,
        payload: input.payload,
      });
    } catch (err) {
      this.logger.warn(
        `emitSiemEvent: SIEM emit failed for ${input.type}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals — keys & helpers
  // =====================================================================

  private failsKey(email: string): string {
    return `${BruteForceService.KEY_PREFIX}:account:${email}:fails`;
  }
  private lockKey(email: string): string {
    return `${BruteForceService.KEY_PREFIX}:account:${email}:lock`;
  }
  private permLockKey(email: string): string {
    return `${BruteForceService.KEY_PREFIX}:account:${email}:perm`;
  }
  private lockedFailsKey(email: string): string {
    return `${BruteForceService.KEY_PREFIX}:account:${email}:locked_fails`;
  }
  private captchaKey(email: string): string {
    return `${BruteForceService.KEY_PREFIX}:account:${email}:captcha`;
  }
  private ipAccountsKey(ip: string): string {
    return `${BruteForceService.KEY_PREFIX}:ip:${ip}:accounts`;
  }
  private ipBlockKey(ip: string): string {
    return `${BruteForceService.KEY_PREFIX}:ip:${ip}:block`;
  }

  private buildBlockedException(
    code: 'ACCOUNT_LOCKED' | 'IP_BLOCKED',
    message: string,
    remainingMs: number,
    captchaRequired = false,
  ): HttpException {
    const retryAfter = Number.isFinite(remainingMs)
      ? Math.max(1, Math.ceil(remainingMs / 1000))
      : null;
    return new HttpException(
      {
        code,
        message,
        details: {
          ...(retryAfter !== null ? { retryAfter } : {}),
          captchaRequired,
        },
      },
      HttpStatus.FORBIDDEN,
    );
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim();
  }
}
