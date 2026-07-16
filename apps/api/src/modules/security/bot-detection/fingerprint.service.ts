import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { RedisService } from '../../../infra/redis/redis.service';
import type {
  DeviceFingerprintPayload,
  FingerprintAnomalyResult,
} from './types';

/**
 * `FingerprintService` — Task 27.4 (Req 27.6) device fingerprint
 * tracker.
 *
 * The client sends a small JSON blob describing the browser /
 * hardware (canvas hash, font list, screen size, timezone, language)
 * either via the `X-Device-Fingerprint` header or by POSTing to
 * `/security/fingerprint/report`. This service:
 *
 *   1. Hashes the payload so we never store the raw fingerprint
 *      (it's PII-adjacent — the canvas hash + font list can identify
 *      a specific machine across sessions).
 *   2. Tracks the set of `(userId | anon-IP)` pairs seen for that
 *      hash inside a 30-day window in Redis (`fp:<hash>:identities`).
 *   3. Tracks the set of distinct IPs seen for that hash so we can
 *      flag fingerprint-stable / IP-rotating bots.
 *   4. Surfaces a structured anomaly result (`distinctIdentities`,
 *      `distinctIps`, `suspicious`) for `BotDetectionService` to
 *      fold into its score.
 *
 * ## Storage layout (Redis)
 *
 * | Key                        | Type | TTL       | Purpose |
 * |----------------------------|------|-----------|---------|
 * | `fp:<hash>:users`          | set  | 30 d      | Distinct user / anon identities |
 * | `fp:<hash>:ips`            | set  | 30 d      | Distinct IPs |
 *
 * The `fp:<hash>:users` key is the one the task body calls out
 * explicitly. We also track IPs because the spec asks for "same
 * fingerprint switches IPs frequently" detection (Requirements 27.6).
 *
 * ## Fail-open posture
 *
 * Every Redis hit is wrapped in `try/catch`. A Redis outage MUST NOT
 * surface 5xx to legitimate users — the worst case is we return
 * "no anomaly" and the bot-detection score stays low, which is
 * exactly the same posture as the rest of the security stack.
 */
@Injectable()
export class FingerprintService {
  private readonly logger = new Logger(FingerprintService.name);

  /** TTL applied to fingerprint sets — 30 days, per task body. */
  static readonly TTL_SECONDS = 30 * 24 * 60 * 60;

  /**
   * Distinct identities for a single fingerprint that flips the
   * `suspicious` bit. Five different users sharing the same browser
   * fingerprint inside 30 days is much more likely to be a botnet
   * than a family.
   */
  static readonly SUSPICIOUS_DISTINCT_IDENTITIES = 5;

  /**
   * Distinct IPs for a single fingerprint that flips `suspicious`.
   * Stable fingerprint + many IPs is the canonical "rotating proxy"
   * pattern.
   */
  static readonly SUSPICIOUS_DISTINCT_IPS = 5;

  /** Redis key prefix — centralised so operators can grep them. */
  static readonly KEY_PREFIX = 'fp';

  constructor(@Optional() private readonly redis?: RedisService) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Compute the stable hash for a payload. Pure helper exposed so the
   * controller and the service can share the same implementation.
   *
   * The hash uses SHA-256 over a deterministic JSON serialisation;
   * fields that callers might forget to lowercase (timezone, fonts,
   * language) are normalised first so two clients posting the same
   * fingerprint always collapse to the same key.
   */
  static hash(payload: DeviceFingerprintPayload): string {
    const normalized = {
      canvasHash: (payload.canvasHash ?? '').trim(),
      fonts: (payload.fonts ?? '').trim().toLowerCase(),
      screen: (payload.screen ?? '').trim().toLowerCase(),
      timezone: (payload.timezone ?? '').trim(),
      language: (payload.language ?? '').trim().toLowerCase(),
    };
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  /**
   * Record a fingerprint observation. Adds the requesting identity
   * (`userId` if authenticated, otherwise the IP) and the IP to the
   * fingerprint's distinct-set, refreshes the 30-day TTL, and
   * returns the resulting anomaly snapshot for the caller.
   *
   * Best-effort — a Redis outage returns a clean "no anomaly" result
   * so we don't accidentally lock the user out.
   */
  async record(
    payload: DeviceFingerprintPayload,
    context: { userId?: string | null; ip?: string | null },
  ): Promise<FingerprintAnomalyResult> {
    const hash = FingerprintService.hash(payload);
    const identity = (context.userId ?? '').trim()
      ? `u:${(context.userId ?? '').trim()}`
      : `ip:${(context.ip ?? '').trim() || 'unknown'}`;
    const ip = (context.ip ?? '').trim() || 'unknown';

    if (!this.redis) {
      return {
        fingerprintHash: hash,
        distinctIdentities: 0,
        distinctIps: 0,
        suspicious: false,
      };
    }

    let distinctIdentities = 0;
    let distinctIps = 0;
    try {
      const client = this.redis.getClient();
      const usersKey = this.usersKey(hash);
      const ipsKey = this.ipsKey(hash);

      const [addedUser, addedIp] = await Promise.all([
        client.sadd(usersKey, identity),
        client.sadd(ipsKey, ip),
      ]);

      // Refresh TTL whenever a new member joins. We use plain EXPIRE
      // (no NX) so a busy fingerprint doesn't expire mid-window — the
      // TTL is the rolling distinctness window, not a one-shot.
      if (addedUser === 1) {
        await client.expire(usersKey, FingerprintService.TTL_SECONDS);
      }
      if (addedIp === 1) {
        await client.expire(ipsKey, FingerprintService.TTL_SECONDS);
      }

      [distinctIdentities, distinctIps] = await Promise.all([
        client.scard(usersKey),
        client.scard(ipsKey),
      ]);
    } catch (err) {
      this.logger.warn(
        `record: SADD/SCARD failed for fingerprint ${hash}: ${(err as Error).message}`,
      );
      return {
        fingerprintHash: hash,
        distinctIdentities: 0,
        distinctIps: 0,
        suspicious: false,
      };
    }

    return {
      fingerprintHash: hash,
      distinctIdentities,
      distinctIps,
      suspicious:
        distinctIdentities >= FingerprintService.SUSPICIOUS_DISTINCT_IDENTITIES ||
        distinctIps >= FingerprintService.SUSPICIOUS_DISTINCT_IPS,
    };
  }

  /**
   * Read-only anomaly check. Used by `BotDetectionService.evaluate`
   * on every request — we never want the score lookup to mutate the
   * fingerprint sets, that's `record()`'s job.
   */
  async check(hash: string): Promise<FingerprintAnomalyResult> {
    const fingerprintHash = (hash ?? '').trim();
    if (!fingerprintHash || !this.redis) {
      return {
        fingerprintHash,
        distinctIdentities: 0,
        distinctIps: 0,
        suspicious: false,
      };
    }

    let distinctIdentities = 0;
    let distinctIps = 0;
    try {
      const client = this.redis.getClient();
      [distinctIdentities, distinctIps] = await Promise.all([
        client.scard(this.usersKey(fingerprintHash)),
        client.scard(this.ipsKey(fingerprintHash)),
      ]);
    } catch (err) {
      this.logger.warn(
        `check: SCARD failed for fingerprint ${fingerprintHash}: ${(err as Error).message}`,
      );
      return {
        fingerprintHash,
        distinctIdentities: 0,
        distinctIps: 0,
        suspicious: false,
      };
    }

    return {
      fingerprintHash,
      distinctIdentities,
      distinctIps,
      suspicious:
        distinctIdentities >= FingerprintService.SUSPICIOUS_DISTINCT_IDENTITIES ||
        distinctIps >= FingerprintService.SUSPICIOUS_DISTINCT_IPS,
    };
  }

  // =====================================================================
  // Internal — Redis keys
  // =====================================================================

  private usersKey(hash: string): string {
    return `${FingerprintService.KEY_PREFIX}:${hash}:users`;
  }

  private ipsKey(hash: string): string {
    return `${FingerprintService.KEY_PREFIX}:${hash}:ips`;
  }
}
