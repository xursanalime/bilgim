import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import { AdminAuditService } from '../../admin/admin-audit.service';

/**
 * Outcome of `CredentialStuffingDetector.recordAttempt` — surfaces
 * whether the attempt tripped the threshold so the caller can decide
 * to block / flag / no-op the rest of the login flow.
 */
export interface CredentialStuffingResult {
  /** Distinct emails attempted from this IP inside the window. */
  distinctEmails: number;
  /** `true` when the count strictly exceeds the configured threshold. */
  detected: boolean;
}

/**
 * `CredentialStuffingDetector` — Task 27.2 / Req 27.9.
 *
 * Tracks the distinct emails attempted from a single IP inside a
 * rolling 1-hour window. When the cardinality crosses the
 * configurable threshold (default 20) we flag the IP as a credential
 * stuffer and write one row into `AdminAuditLog` with action
 * `security.credential_stuffing_detected` so the SOC has an audit
 * trail and can correlate with rate-limit blocks.
 *
 * The detector is *passive* — it does not apply the IP block itself
 * (that's `LoginProtectionService` / `BruteForceService`'s job). It
 * only surfaces the signal so callers can compose detection with
 * blocking.
 *
 * ## Storage layout
 *
 * | Key                            | Type | TTL   |
 * |--------------------------------|------|-------|
 * | `credstuff:emails:{ip}`        | set  | 1 h   |
 * | `credstuff:detected:{ip}`      | str  | 1 h   |
 *
 * The `detected` marker debounces audit writes — once an IP is
 * flagged inside the window we don't emit another row for every
 * subsequent attempt. The marker auto-expires with the window so a
 * new audit row can fire when activity resumes after a quiet hour.
 */
@Injectable()
export class CredentialStuffingDetector {
  private readonly logger = new Logger(CredentialStuffingDetector.name);

  /** Length of the rolling window (1 hour). */
  static readonly WINDOW_SEC = 60 * 60;

  /** Default distinct-emails threshold per IP per hour. */
  static readonly DEFAULT_THRESHOLD = 20;

  /** Audit action constant — kept centralised for grep-ability. */
  static readonly AUDIT_ACTION = 'security.credential_stuffing_detected';

  /** Key prefix for every credential-stuffing tracker key. */
  static readonly KEY_PREFIX = 'credstuff';

  /** Resolved threshold (env-driven, with `DEFAULT_THRESHOLD` fallback). */
  private readonly threshold: number;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAuditService?: AdminAuditService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.threshold = CredentialStuffingDetector.loadThreshold(
      this.configService,
    );
  }

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Record a login attempt for `(email, ip)` and check whether the
   * IP has crossed the credential-stuffing threshold inside the
   * current window. When the threshold is crossed for the first
   * time we emit a single `security.credential_stuffing_detected`
   * audit row.
   *
   * Returns `{ distinctEmails, detected }` so the caller can compose
   * the response.
   */
  async recordAttempt(
    email: string,
    ip: string,
  ): Promise<CredentialStuffingResult> {
    const normEmail = this.normalizeEmail(email);
    const normIp = this.normalizeIp(ip);

    if (!this.redis || !normEmail || !normIp) {
      return { distinctEmails: 0, detected: false };
    }

    const distinctEmails = await this.trackDistinctEmail(normIp, normEmail);
    const detected = distinctEmails > this.threshold;

    if (detected) {
      const isFresh = await this.markDetected(normIp);
      if (isFresh) {
        await this.writeAudit(normIp, distinctEmails);
      }
    }

    return { distinctEmails, detected };
  }

  /**
   * Read the current cardinality of distinct emails for `ip` without
   * recording a new attempt. Useful for monitoring dashboards and
   * tests.
   */
  async distinctEmailsForIp(ip: string): Promise<number> {
    if (!this.redis) return 0;
    const normIp = this.normalizeIp(ip);
    try {
      const client = this.redis.getClient();
      return (await client.scard(this.emailsKey(normIp))) ?? 0;
    } catch (err) {
      this.logger.warn(
        `CredentialStuffingDetector.distinctEmailsForIp: SCARD failed for ${normIp}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /** Configured threshold — exposed for tests and observability. */
  getThreshold(): number {
    return this.threshold;
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * Add `email` to the per-IP set and return the new cardinality.
   * Sets the TTL with `NX` so we don't keep refreshing the rolling
   * window on every email.
   */
  private async trackDistinctEmail(
    ip: string,
    email: string,
  ): Promise<number> {
    if (!this.redis) return 0;
    const key = this.emailsKey(ip);
    try {
      const client = this.redis.getClient();
      const added = await client.sadd(key, email);
      if (added === 1) {
        await client.expire(
          key,
          CredentialStuffingDetector.WINDOW_SEC,
          'NX',
        );
      }
      return await client.scard(key);
    } catch (err) {
      this.logger.warn(
        `CredentialStuffingDetector.trackDistinctEmail: SADD/SCARD failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Set the "already-detected-this-window" marker exactly once. Returns
   * `true` only the first call inside the window so the audit log fires
   * exactly once per IP per window.
   */
  private async markDetected(ip: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.setnx(
        this.detectedKey(ip),
        new Date().toISOString(),
        CredentialStuffingDetector.WINDOW_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `CredentialStuffingDetector.markDetected: SETNX failed for ${ip}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Write a single audit row. Failures are logged but never thrown —
   * a flaky audit DB MUST NOT break the login pipeline.
   */
  private async writeAudit(
    ip: string,
    distinctEmails: number,
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        CredentialStuffingDetector.AUDIT_ACTION,
        ip,
        {
          ip,
          attemptedEmails: distinctEmails,
          threshold: this.threshold,
          windowSec: CredentialStuffingDetector.WINDOW_SEC,
          detectedAt: new Date().toISOString(),
        },
        { ip },
      );
    } catch (err) {
      this.logger.warn(
        `CredentialStuffingDetector.writeAudit: failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  private static loadThreshold(configService?: ConfigService): number {
    if (!configService) {
      return CredentialStuffingDetector.DEFAULT_THRESHOLD;
    }
    const raw = configService.get<string | number>(
      'CREDENTIAL_STUFFING_DISTINCT_EMAILS_PER_HOUR',
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : CredentialStuffingDetector.DEFAULT_THRESHOLD;
  }

  private emailsKey(ip: string): string {
    return `${CredentialStuffingDetector.KEY_PREFIX}:emails:${ip}`;
  }

  private detectedKey(ip: string): string {
    return `${CredentialStuffingDetector.KEY_PREFIX}:detected:${ip}`;
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeIp(ip: string): string {
    return (ip ?? '').trim();
  }
}
