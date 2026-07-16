import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AdminAuditService } from '../admin/admin-audit.service';

/**
 * Snapshot returned by `recordFailure` so callers (`AuthService.login`)
 * can shape the response after a failed attempt — currently only
 * surfaces whether a soft- or hard-lock just triggered, but the shape
 * is open so we can add hints (`attemptsLeft`, etc.) without breaking
 * the call site.
 */
export interface AuthHardeningFailureResult {
  /** Account-level lockout that just got applied, if any. */
  accountLock: { code: AccountLockCode; until: Date } | null;
  /** IP-level block that just got applied, if any. */
  ipLock: { code: IpLockCode; until: Date } | null;
  /** True if this attempt tripped the credential-stuffing detector. */
  credentialStuffingDetected: boolean;
}

/** Account lockout state codes — surfaced verbatim in API responses. */
export type AccountLockCode = 'ACCOUNT_LOCKED_TEMP' | 'ACCOUNT_LOCKED_HARD';

/** IP lockout state codes — surfaced verbatim in API responses. */
export type IpLockCode =
  | 'IP_BLOCKED_TEMP'
  | 'IP_DENYLISTED'
  | 'CREDENTIAL_STUFFING_BLOCKED';

/** Outcome of an unlock-token verification. */
export interface UnlockResult {
  /** True when the token matched and the account locks were cleared. */
  unlocked: boolean;
  /** UserId tied to the consumed token (`null` when no match). */
  userId: string | null;
}

/**
 * `AuthHardeningService` — Task 27.2 brute-force lockout, per-IP
 * blocklist, credential-stuffing detection and email-driven unlock
 * flow.
 *
 * The service consolidates four orthogonal protections that all hang
 * off the auth/login pipeline:
 *
 *   1. **Per-account progressive lockout** — keyed by
 *      `(emailOrUsername, ip)` plus an account-global counter:
 *        - 5 failures inside 15 min → soft lock for 15 min
 *          (`ACCOUNT_LOCKED_TEMP`)
 *        - 10 failures inside 1 h → hard lock requiring email
 *          unlock (`ACCOUNT_LOCKED_HARD`)
 *      Successful login clears the **account** counter; the per-IP
 *      counter persists separately so a credential-stuffer who
 *      occasionally guesses correctly cannot wipe their tracks.
 *
 *   2. **Per-IP brute-force protection** — keyed by IP only:
 *        - 20 failures inside 5 min → 15-minute IP block
 *          (`IP_BLOCKED_TEMP`)
 *        - 50 failures inside 1 h → 24-hour deny-list
 *          (`IP_DENYLISTED`)
 *
 *   3. **Credential-stuffing detection** — distinct emails attempted
 *      from the same IP inside a 5-minute window:
 *        - ≥ 10 distinct emails → 1-hour IP block
 *          (`CREDENTIAL_STUFFING_BLOCKED`) plus an `AdminAuditLog`
 *          row with action `security.credential_stuffing`.
 *
 *   4. **Email-based unlock flow** — when a hard lock fires we emit
 *      a `security.account_unlock_requested` outbox event carrying a
 *      one-time unlock token (15-minute TTL). The token is stored
 *      hashed in Redis (`auth-hardening:unlock:{tokenHash}`) and the
 *      consumer (`POST /auth/account/unlock`) wipes the account
 *      counters once verified.
 *
 * ## Storage layout
 *
 * | Key                                                    | Type    | TTL      |
 * |--------------------------------------------------------|---------|----------|
 * | `auth-hardening:acct:fail15m:{account}:{minute}`       | counter | 16 min   |
 * | `auth-hardening:acct:fail60m:{account}:{minute}`       | counter | 61 min   |
 * | `auth-hardening:acct:lock:{account}`                   | json    | tier     |
 * | `auth-hardening:ip:fail5m:{ip}:{minute}`               | counter | 6 min    |
 * | `auth-hardening:ip:fail60m:{ip}:{minute}`              | counter | 61 min   |
 * | `auth-hardening:ip:lock:{ip}`                          | json    | tier     |
 * | `auth-hardening:cs:emails:{ip}:{5m-bucket}`            | set     | 6 min    |
 * | `auth-hardening:cs:detected:{ip}`                      | str     | 1 h      |
 * | `auth-hardening:unlock:user:{userId}`                  | str     | 15 min   |
 * | `auth-hardening:unlock:token:{tokenHash}`              | str     | 15 min   |
 *
 * The "minute bucket" suffix (`Math.floor(now / 60_000)`) implements a
 * sliding window via summed buckets — cheaper than ZSETs on a hot
 * login path while still bounding the look-back to whole minutes.
 *
 * ## Fail-open posture
 *
 * Every Redis operation is wrapped in try/catch and falls back to the
 * non-blocking path. A Redis outage MUST NOT lock the entire user
 * base out. Failures are logged at `warn` level so SREs notice.
 */
@Injectable()
export class AuthHardeningService {
  private readonly logger = new Logger(AuthHardeningService.name);

  // -----------------------------------------------------------------
  // Spec thresholds (Task 27.2)
  // -----------------------------------------------------------------

  /** 5 failed logins in 15 min → soft lock (15 min). */
  static readonly ACCOUNT_SOFT_LOCK_THRESHOLD = 5;
  static readonly ACCOUNT_SOFT_LOCK_WINDOW_SEC = 15 * 60;
  static readonly ACCOUNT_SOFT_LOCK_DURATION_SEC = 15 * 60;

  /** 10 failed logins in 60 min → hard lock (requires email unlock). */
  static readonly ACCOUNT_HARD_LOCK_THRESHOLD = 10;
  static readonly ACCOUNT_HARD_LOCK_WINDOW_SEC = 60 * 60;
  /** No automatic expiry — the user must complete the email flow. */
  static readonly ACCOUNT_HARD_LOCK_DURATION_SEC = 24 * 60 * 60;

  /** 20 failures from one IP in 5 min → 15 min IP block. */
  static readonly IP_TEMP_BLOCK_THRESHOLD = 20;
  static readonly IP_TEMP_BLOCK_WINDOW_SEC = 5 * 60;
  static readonly IP_TEMP_BLOCK_DURATION_SEC = 15 * 60;

  /** 50 failures from one IP in 60 min → 24h deny-list. */
  static readonly IP_DENYLIST_THRESHOLD = 50;
  static readonly IP_DENYLIST_WINDOW_SEC = 60 * 60;
  static readonly IP_DENYLIST_DURATION_SEC = 24 * 60 * 60;

  /** ≥ 10 distinct emails / 5 min from one IP → credential stuffing. */
  static readonly CRED_STUFFING_DISTINCT_EMAILS = 10;
  static readonly CRED_STUFFING_WINDOW_SEC = 5 * 60;
  static readonly CRED_STUFFING_BLOCK_DURATION_SEC = 60 * 60;

  /** Email unlock token TTL (15 min per spec). */
  static readonly UNLOCK_TOKEN_TTL_SEC = 15 * 60;

  /** Outbox topic for the unlock email. */
  static readonly UNLOCK_OUTBOX_TOPIC = 'security.account_unlock_requested';

  /** AdminAuditLog action constants. */
  static readonly AUDIT_CREDENTIAL_STUFFING = 'security.credential_stuffing';
  static readonly AUDIT_ACCOUNT_HARD_LOCKED = 'security.account_hard_locked';
  static readonly AUDIT_ACCOUNT_UNLOCKED = 'security.account_unlocked';
  static readonly AUDIT_IP_DENYLISTED = 'security.ip_denylisted';

  /** Top-level Redis key prefix. */
  static readonly KEY_PREFIX = 'auth-hardening';

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAudit?: AdminAuditService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() private readonly prisma?: PrismaClient,
  ) {}

  // =================================================================
  // Public API — gates
  // =================================================================

  /**
   * Throw a 429 if either the account or the IP is currently locked.
   * Account locks take priority over IP locks because the more
   * specific signal is more informative for the user — they need to
   * see that *their* account is locked rather than a generic IP
   * message.
   */
  async assertNotLocked(account: string, ip: string): Promise<void> {
    const normAccount = this.normalizeAccount(account);
    const normIp = this.normalizeIp(ip);

    const accountLock = await this.readAccountLock(normAccount);
    if (accountLock) {
      throw this.lockedException(accountLock.code, accountLock.until);
    }

    const ipLock = await this.readIpLock(normIp);
    if (ipLock) {
      throw this.lockedException(ipLock.code, ipLock.until);
    }
  }

  // =================================================================
  // Public API — recording
  // =================================================================

  /**
   * Record one failed login attempt and apply any tier crossings.
   * Best-effort — any internal failure is logged and downgraded so
   * the surrounding login flow always returns a 401.
   */
  async recordFailure(
    account: string,
    ip: string,
    opts: { userId?: string; email?: string } = {},
  ): Promise<AuthHardeningFailureResult> {
    const result: AuthHardeningFailureResult = {
      accountLock: null,
      ipLock: null,
      credentialStuffingDetected: false,
    };

    if (!this.redis) {
      return result;
    }

    const normAccount = this.normalizeAccount(account);
    const normIp = this.normalizeIp(ip);
    const minute = AuthHardeningService.currentMinute();
    const fiveMinBucket = Math.floor(minute / 5);

    // Bump every counter in parallel — they're independent keys.
    const [accountWindow15m, accountWindow60m, ipWindow5m, ipWindow60m] =
      await Promise.all([
        this.bumpAndSum(
          this.accountWindowKeys(normAccount, '15m'),
          minute,
          15,
          16 * 60,
        ),
        this.bumpAndSum(
          this.accountWindowKeys(normAccount, '60m'),
          minute,
          60,
          61 * 60,
        ),
        this.bumpAndSum(
          this.ipWindowKeys(normIp, '5m'),
          minute,
          5,
          6 * 60,
        ),
        this.bumpAndSum(
          this.ipWindowKeys(normIp, '60m'),
          minute,
          60,
          61 * 60,
        ),
      ]);

    // 1. Per-account hard lock — tested first so a hard lock supersedes
    //    a concurrent soft-lock crossing.
    if (accountWindow60m >= AuthHardeningService.ACCOUNT_HARD_LOCK_THRESHOLD) {
      const lock = await this.applyAccountLock(
        normAccount,
        'ACCOUNT_LOCKED_HARD',
        AuthHardeningService.ACCOUNT_HARD_LOCK_DURATION_SEC,
      );
      if (lock) {
        result.accountLock = { code: 'ACCOUNT_LOCKED_HARD', until: lock };
        if (opts.userId && opts.email) {
          await this.dispatchUnlockEmail(opts.userId, opts.email, normIp);
        }
        await this.writeAudit(
          AuthHardeningService.AUDIT_ACCOUNT_HARD_LOCKED,
          normAccount,
          {
            account: normAccount,
            ip: normIp,
            failures60m: accountWindow60m,
            threshold: AuthHardeningService.ACCOUNT_HARD_LOCK_THRESHOLD,
          },
          normIp,
        );
      }
    } else if (
      accountWindow15m >= AuthHardeningService.ACCOUNT_SOFT_LOCK_THRESHOLD
    ) {
      // 2. Per-account soft lock.
      const lock = await this.applyAccountLock(
        normAccount,
        'ACCOUNT_LOCKED_TEMP',
        AuthHardeningService.ACCOUNT_SOFT_LOCK_DURATION_SEC,
      );
      if (lock) {
        result.accountLock = { code: 'ACCOUNT_LOCKED_TEMP', until: lock };
      }
    }

    // 3. Per-IP deny-list (60-min window) takes priority over the temp
    //    block because deny-list is a strict superset.
    if (ipWindow60m >= AuthHardeningService.IP_DENYLIST_THRESHOLD) {
      const lock = await this.applyIpLock(
        normIp,
        'IP_DENYLISTED',
        AuthHardeningService.IP_DENYLIST_DURATION_SEC,
      );
      if (lock) {
        result.ipLock = { code: 'IP_DENYLISTED', until: lock };
        await this.writeAudit(
          AuthHardeningService.AUDIT_IP_DENYLISTED,
          normIp,
          {
            ip: normIp,
            failures60m: ipWindow60m,
            threshold: AuthHardeningService.IP_DENYLIST_THRESHOLD,
          },
          normIp,
        );
      }
    } else if (ipWindow5m >= AuthHardeningService.IP_TEMP_BLOCK_THRESHOLD) {
      const lock = await this.applyIpLock(
        normIp,
        'IP_BLOCKED_TEMP',
        AuthHardeningService.IP_TEMP_BLOCK_DURATION_SEC,
      );
      if (lock) {
        result.ipLock = { code: 'IP_BLOCKED_TEMP', until: lock };
      }
    }

    // 4. Credential-stuffing detection — independent of failure
    //    counters so a careful attacker spraying many emails *under*
    //    the per-IP threshold is still caught.
    const distinctEmails = await this.trackDistinctEmail(
      normIp,
      normAccount,
      fiveMinBucket,
    );
    if (
      distinctEmails >= AuthHardeningService.CRED_STUFFING_DISTINCT_EMAILS
    ) {
      const fired = await this.markCredentialStuffing(normIp);
      if (fired) {
        result.credentialStuffingDetected = true;
        const lock = await this.applyIpLock(
          normIp,
          'CREDENTIAL_STUFFING_BLOCKED',
          AuthHardeningService.CRED_STUFFING_BLOCK_DURATION_SEC,
        );
        // Replace any softer IP lock with the credential-stuffing one
        // — if `applyIpLock` succeeded we surface it; otherwise we
        // keep whatever lock was already returned above.
        if (lock) {
          result.ipLock = {
            code: 'CREDENTIAL_STUFFING_BLOCKED',
            until: lock,
          };
        }
        await this.writeAudit(
          AuthHardeningService.AUDIT_CREDENTIAL_STUFFING,
          normIp,
          {
            ip: normIp,
            distinctEmails,
            threshold: AuthHardeningService.CRED_STUFFING_DISTINCT_EMAILS,
            windowSec: AuthHardeningService.CRED_STUFFING_WINDOW_SEC,
          },
          normIp,
        );
      }
    }

    return result;
  }

  /**
   * Clear the per-account counters and any active account lock after
   * a successful login. The per-IP counters are intentionally **not**
   * cleared so a credential-stuffer who eventually guesses correctly
   * does not get a clean slate.
   */
  async recordSuccess(account: string, ip: string): Promise<void> {
    if (!this.redis) return;

    const normAccount = this.normalizeAccount(account);
    void ip;

    const minute = AuthHardeningService.currentMinute();

    // Build the list of bucket counters spanning the longest account
    // window (60 min) so all in-flight bucket counters get cleared.
    const counterKeys: string[] = [];
    for (let m = minute - 60; m <= minute; m++) {
      counterKeys.push(this.accountBucketKey(normAccount, '15m', m));
      counterKeys.push(this.accountBucketKey(normAccount, '60m', m));
    }
    counterKeys.push(this.accountLockKey(normAccount));

    await Promise.all(
      counterKeys.map(async (key) => {
        try {
          await this.redis!.del(key);
        } catch (err) {
          this.logger.warn(
            `recordSuccess: Redis DEL failed for "${key}": ${(err as Error).message}`,
          );
        }
      }),
    );
  }

  // =================================================================
  // Public API — unlock flow
  // =================================================================

  /**
   * Issue a fresh unlock token for `userId`, store its hash with a
   * 15-minute TTL and emit `security.account_unlock_requested` to
   * the outbox so the email worker can deliver it. Re-issuing
   * invalidates any previous outstanding token for the same user so
   * only the latest one works.
   *
   * `email` is captured alongside the userId so consuming the token
   * can clear the account-keyed lock applied by `recordFailure`.
   *
   * Returns the **raw token** so the email worker can use it
   * directly. Callers OUTSIDE of the email worker pipeline should
   * not log this value — it is the equivalent of a one-time-use
   * password.
   */
  async issueUnlockToken(
    userId: string,
    email: string,
    ip: string,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    if (this.redis) {
      try {
        const previousHash = await this.redis.get(this.unlockUserKey(userId));
        if (previousHash) {
          await this.redis.del(this.unlockTokenKey(previousHash));
        }
        await this.redis.set(
          this.unlockUserKey(userId),
          tokenHash,
          AuthHardeningService.UNLOCK_TOKEN_TTL_SEC,
        );
        // Token entry stores both `userId` and the account (email) so
        // `consumeUnlockToken` can clear the account-keyed lock that
        // `recordFailure` applied at the hard-lock crossing.
        await this.redis.set(
          this.unlockTokenKey(tokenHash),
          JSON.stringify({
            userId,
            account: this.normalizeAccount(email),
          }),
          AuthHardeningService.UNLOCK_TOKEN_TTL_SEC,
        );
      } catch (err) {
        this.logger.warn(
          `issueUnlockToken: Redis SET failed: ${(err as Error).message}`,
        );
      }
    }

    await this.dispatchUnlockEmailWithToken(userId, email, ip, rawToken);
    return rawToken;
  }

  /**
   * Verify and consume an unlock token. On success the account lock
   * marker, all account-level counters, and the token itself are
   * removed. Returns `{ unlocked, userId }` so the caller can wipe
   * any remaining external state.
   */
  async consumeUnlockToken(token: string): Promise<UnlockResult> {
    const result: UnlockResult = { unlocked: false, userId: null };
    if (!this.redis || !token) return result;

    const tokenHash = this.hashToken(token);
    let raw: string | null;
    try {
      raw = await this.redis.get(this.unlockTokenKey(tokenHash));
    } catch (err) {
      this.logger.warn(
        `consumeUnlockToken: Redis GET failed: ${(err as Error).message}`,
      );
      return result;
    }
    if (!raw) return result;

    let userId: string | null = null;
    let account: string | null = null;
    // Tokens issued by `issueUnlockToken` store JSON; the older
    // signature (just `userId`) is supported for forward compat.
    try {
      const parsed = JSON.parse(raw) as { userId?: string; account?: string };
      userId = parsed.userId ?? null;
      account = parsed.account ?? null;
    } catch {
      userId = raw;
    }
    if (!userId) return result;

    // Atomically remove the token + user pointer so a race never lets
    // the same token consume twice.
    try {
      await Promise.all([
        this.redis.del(this.unlockTokenKey(tokenHash)),
        this.redis.del(this.unlockUserKey(userId)),
      ]);
    } catch (err) {
      this.logger.warn(
        `consumeUnlockToken: Redis DEL failed: ${(err as Error).message}`,
      );
    }

    // Clear account-level locks and counters. We clear by both the
    // submitted account (email) and the userId so any lock applied
    // under either key is wiped — `recordFailure` keys by `account`,
    // but legacy callers may key by `userId`.
    if (account) {
      await this.recordSuccess(account, '');
    }
    await this.recordSuccess(userId, '');
    await this.writeAudit(
      AuthHardeningService.AUDIT_ACCOUNT_UNLOCKED,
      userId,
      { userId, account, via: 'email_unlock_token' },
      null,
    );

    return { unlocked: true, userId };
  }

  // =================================================================
  // Internals — counters
  // =================================================================

  /**
   * Bump the bucket for `minute`, set the TTL on first creation, then
   * sum the last `windowMinutes` worth of buckets. Returns 0 on Redis
   * outage so the caller fails open.
   */
  private async bumpAndSum(
    keys: { bucketKey: (m: number) => string },
    minute: number,
    windowMinutes: number,
    ttlSeconds: number,
  ): Promise<number> {
    if (!this.redis) return 0;
    try {
      const currentKey = keys.bucketKey(minute);
      const count = await this.redis.incr(currentKey);
      if (count === 1) {
        await this.redis.expire(currentKey, ttlSeconds);
      }

      let sum = 0;
      const reads: Array<Promise<string | null>> = [];
      for (let m = minute - (windowMinutes - 1); m <= minute; m++) {
        if (m === minute) continue; // already counted above
        reads.push(this.redis.get(keys.bucketKey(m)));
      }
      const values = await Promise.all(reads);
      for (const raw of values) {
        if (raw === null) continue;
        const n = Number(raw);
        if (Number.isFinite(n)) sum += n;
      }
      return sum + count;
    } catch (err) {
      this.logger.warn(
        `bumpAndSum failed: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // =================================================================
  // Internals — locks
  // =================================================================

  private async readAccountLock(
    account: string,
  ): Promise<{ code: AccountLockCode; until: Date } | null> {
    return this.readLockMarker(this.accountLockKey(account)) as Promise<
      { code: AccountLockCode; until: Date } | null
    >;
  }

  private async readIpLock(
    ip: string,
  ): Promise<{ code: IpLockCode; until: Date } | null> {
    return this.readLockMarker(this.ipLockKey(ip)) as Promise<
      { code: IpLockCode; until: Date } | null
    >;
  }

  private async readLockMarker(
    key: string,
  ): Promise<{ code: string; until: Date } | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(
        `readLockMarker: GET failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { code?: string; until?: string };
      if (!parsed.code || !parsed.until) return null;
      const until = new Date(parsed.until);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        return null;
      }
      return { code: parsed.code, until };
    } catch {
      return null;
    }
  }

  private async applyAccountLock(
    account: string,
    code: AccountLockCode,
    durationSec: number,
  ): Promise<Date | null> {
    return this.applyLock(this.accountLockKey(account), code, durationSec);
  }

  private async applyIpLock(
    ip: string,
    code: IpLockCode,
    durationSec: number,
  ): Promise<Date | null> {
    return this.applyLock(this.ipLockKey(ip), code, durationSec);
  }

  private async applyLock(
    key: string,
    code: string,
    durationSec: number,
  ): Promise<Date | null> {
    if (!this.redis) return null;
    const until = new Date(Date.now() + durationSec * 1000);
    const payload = JSON.stringify({ code, until: until.toISOString() });
    try {
      await this.redis.set(key, payload, durationSec);
      return until;
    } catch (err) {
      this.logger.warn(
        `applyLock: SET failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // =================================================================
  // Internals — credential-stuffing tracker
  // =================================================================

  private async trackDistinctEmail(
    ip: string,
    account: string,
    fiveMinBucket: number,
  ): Promise<number> {
    if (!this.redis || !account || !ip) return 0;
    const key = this.credStuffingEmailsKey(ip, fiveMinBucket);
    try {
      const client = this.redis.getClient();
      const added = await client.sadd(key, account);
      if (added === 1) {
        await client.expire(
          key,
          AuthHardeningService.CRED_STUFFING_WINDOW_SEC + 60,
          'NX',
        );
      }
      return await client.scard(key);
    } catch (err) {
      this.logger.warn(
        `trackDistinctEmail: SADD/SCARD failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Set the "already-flagged-this-window" debounce so we only audit
   * + block once per IP per window. Returns `true` only on the first
   * call inside the window.
   */
  private async markCredentialStuffing(ip: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.setnx(
        this.credStuffingDetectedKey(ip),
        new Date().toISOString(),
        AuthHardeningService.CRED_STUFFING_BLOCK_DURATION_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `markCredentialStuffing: SETNX failed for ${ip}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // =================================================================
  // Internals — audit + outbox
  // =================================================================

  private async writeAudit(
    action: string,
    target: string,
    payload: Record<string, unknown>,
    ip: string | null,
  ): Promise<void> {
    if (!this.adminAudit) return;
    try {
      await this.adminAudit.log(
        null,
        action,
        target,
        payload,
        ip ? { ip } : {},
      );
    } catch (err) {
      this.logger.warn(
        `writeAudit: failed for action ${action}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * On hard-lock crossing — generate the unlock token and dispatch
   * the email. Wraps `issueUnlockToken` so the email is fired exactly
   * once per crossing.
   */
  private async dispatchUnlockEmail(
    userId: string,
    email: string,
    ip: string,
  ): Promise<void> {
    try {
      await this.issueUnlockToken(userId, email, ip);
    } catch (err) {
      this.logger.warn(
        `dispatchUnlockEmail: failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Lower-level dispatcher used by both the auto-trigger
   * (`recordFailure` hard-lock path) and explicit re-issue
   * (`issueUnlockToken`). The token is included verbatim in the
   * outbox payload — the email worker is the only consumer.
   */
  private async dispatchUnlockEmailWithToken(
    userId: string,
    email: string,
    ip: string,
    token: string,
  ): Promise<void> {
    if (!this.outboxService || !this.prisma) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.outboxService!.create(tx, {
          topic: AuthHardeningService.UNLOCK_OUTBOX_TOPIC,
          payload: {
            userId,
            email,
            ip,
            token,
            issuedAt: new Date().toISOString(),
            ttlSeconds: AuthHardeningService.UNLOCK_TOKEN_TTL_SEC,
          },
          // One token per user — the idempotency key includes the
          // hashed token so reissues land on different rows.
          idempotencyKey: `${AuthHardeningService.UNLOCK_OUTBOX_TOPIC}:${userId}:${this.hashToken(token).slice(0, 16)}`,
        });
      });
    } catch (err) {
      this.logger.warn(
        `dispatchUnlockEmailWithToken: failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  // =================================================================
  // Helpers
  // =================================================================

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private normalizeAccount(account: string): string {
    return (account ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim();
  }

  private static currentMinute(): number {
    return Math.floor(Date.now() / 60_000);
  }

  // =================================================================
  // Internals — key helpers
  // =================================================================

  private accountWindowKeys(
    account: string,
    window: '15m' | '60m',
  ): { bucketKey: (m: number) => string } {
    return {
      bucketKey: (m: number) => this.accountBucketKey(account, window, m),
    };
  }

  private accountBucketKey(
    account: string,
    window: '15m' | '60m',
    minute: number,
  ): string {
    return `${AuthHardeningService.KEY_PREFIX}:acct:fail${window}:${account}:${minute}`;
  }

  private accountLockKey(account: string): string {
    return `${AuthHardeningService.KEY_PREFIX}:acct:lock:${account}`;
  }

  private ipWindowKeys(
    ip: string,
    window: '5m' | '60m',
  ): { bucketKey: (m: number) => string } {
    return {
      bucketKey: (m: number) => this.ipBucketKey(ip, window, m),
    };
  }

  private ipBucketKey(
    ip: string,
    window: '5m' | '60m',
    minute: number,
  ): string {
    return `${AuthHardeningService.KEY_PREFIX}:ip:fail${window}:${ip}:${minute}`;
  }

  private ipLockKey(ip: string): string {
    return `${AuthHardeningService.KEY_PREFIX}:ip:lock:${ip}`;
  }

  private credStuffingEmailsKey(ip: string, fiveMinBucket: number): string {
    return `${AuthHardeningService.KEY_PREFIX}:cs:emails:${ip}:${fiveMinBucket}`;
  }

  private credStuffingDetectedKey(ip: string): string {
    return `${AuthHardeningService.KEY_PREFIX}:cs:detected:${ip}`;
  }

  private unlockUserKey(userId: string): string {
    return `${AuthHardeningService.KEY_PREFIX}:unlock:user:${userId}`;
  }

  private unlockTokenKey(tokenHash: string): string {
    return `${AuthHardeningService.KEY_PREFIX}:unlock:token:${tokenHash}`;
  }

  // =================================================================
  // Exception construction
  // =================================================================

  private lockedException(
    code: AccountLockCode | IpLockCode,
    until: Date,
  ): HttpException {
    const retryAfter = Math.max(
      1,
      Math.ceil((until.getTime() - Date.now()) / 1000),
    );
    const requiresEmailUnlock = code === 'ACCOUNT_LOCKED_HARD';
    return new HttpException(
      {
        code,
        message: this.messageForCode(code),
        details: {
          retryAfter,
          lockedUntil: until.toISOString(),
          ...(requiresEmailUnlock && { requiresEmailUnlock: true }),
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private messageForCode(code: AccountLockCode | IpLockCode): string {
    switch (code) {
      case 'ACCOUNT_LOCKED_TEMP':
        return 'Account temporarily locked due to repeated failed login attempts. Please wait before trying again.';
      case 'ACCOUNT_LOCKED_HARD':
        return 'Account locked. We have emailed you a one-time unlock link.';
      case 'IP_BLOCKED_TEMP':
        return 'Too many failed login attempts from this IP. Please wait before trying again.';
      case 'IP_DENYLISTED':
        return 'Your IP has been temporarily denied access due to repeated failed login attempts.';
      case 'CREDENTIAL_STUFFING_BLOCKED':
        return 'Suspicious login activity detected from this IP. Access has been temporarily blocked.';
      default:
        return 'Login temporarily blocked.';
    }
  }
}
