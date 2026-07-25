import { Injectable, Logger, Optional } from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Status returned by `getBlockReason`. Distinguishes "not blocked"
 * from "blocked, here's why" so callers can drive structured 403
 * envelopes without reading raw Redis values.
 */
export interface IpBlockStatus {
  blocked: boolean;
  reason?: string | undefined;
  /** Source label — `honeypot`, `threat_intel`, `manual`, etc. */
  source?: string | undefined;
  /** Epoch ms expiry (when finite TTL). */
  expiresAt?: number | null | undefined;
}

/** One row of `listBlocked()` — status plus the IP it belongs to. */
export interface IpBlockListEntry extends IpBlockStatus {
  ip: string;
}

/**
 * `IpBlocklistService` — Task 27.5, Req 27.8 / 27.10.
 *
 * Single source of truth for "this IP must be rejected at the edge".
 * Backed by Redis with two layers:
 *
 *   - `security:blocklist:ip:<ip>` — a per-IP key holding the
 *     `{ reason, source }` payload with a TTL that expires the
 *     block. The key is the authoritative answer for `isBlocked`.
 *   - `security:blocklist:ips` — a Redis SET with every currently
 *     blocked IP, kept for ops dashboards (`SCARD`, `SMEMBERS`).
 *     The SET is best-effort — TTL expiry only invalidates the
 *     per-IP key, not the SET membership, so callers MUST verify
 *     the per-IP key when iterating.
 *
 * Used by:
 *   - `IpBlocklistGuard` — global gate that rejects every blocked
 *     IP with `403 IP_BLOCKED` before any other guard runs.
 *   - `HoneypotController` — adds the source IP on first hit.
 *   - `ThreatIntelService` — bulk-imports known-bad IPs from
 *     external feeds.
 *   - `BruteForceService` (existing) — adds IPs flagged for
 *     credential stuffing.
 *
 * Fail-open posture: every Redis call is wrapped in try/catch and
 * defaults to "not blocked" so a Redis outage cannot lock the
 * platform out of itself.
 */
@Injectable()
export class IpBlocklistService {
  private readonly logger = new Logger(IpBlocklistService.name);

  static readonly SET_KEY = 'security:blocklist:ips';
  static readonly KEY_PREFIX = 'security:blocklist:ip';

  /** Default block durations exposed for callers that don't pin one. */
  static readonly DEFAULT_HONEYPOT_TTL_SEC = 24 * 60 * 60; // 24h
  static readonly DEFAULT_THREAT_INTEL_TTL_SEC = 7 * 24 * 60 * 60; // 7d
  static readonly DEFAULT_MANUAL_TTL_SEC = 24 * 60 * 60; // 24h

  constructor(@Optional() private readonly redis?: RedisService) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Add `ip` to the blocklist with the given TTL. Idempotent — if
   * the IP is already blocked the TTL and reason are refreshed.
   *
   * Best-effort: returns `false` if Redis is unreachable. Callers
   * should not gate the response on the result; they should treat a
   * failed write as "we'll try again next time".
   */
  async block(
    ip: string,
    ttlSec: number,
    reason: string,
    source = 'manual',
  ): Promise<boolean> {
    const normalized = this.normalizeIp(ip);
    if (!normalized || normalized === 'unknown') return false;
    if (!this.redis) return false;
    const ttl = Math.max(1, Math.floor(ttlSec));
    const payload = JSON.stringify({
      reason,
      source,
      blockedAt: new Date().toISOString(),
    });
    try {
      const client = this.redis.getClient();
      await client.set(this.ipKey(normalized), payload, 'EX', ttl);
      await client.sadd(IpBlocklistService.SET_KEY, normalized);
      return true;
    } catch (err) {
      this.logger.warn(
        `block: failed for ${normalized}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Remove `ip` from the blocklist. */
  async unblock(ip: string): Promise<boolean> {
    const normalized = this.normalizeIp(ip);
    if (!normalized) return false;
    if (!this.redis) return false;
    try {
      const client = this.redis.getClient();
      await client.del(this.ipKey(normalized));
      await client.srem(IpBlocklistService.SET_KEY, normalized);
      return true;
    } catch (err) {
      this.logger.warn(
        `unblock: failed for ${normalized}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Quick yes/no check — used by the global guard. */
  async isBlocked(ip: string): Promise<boolean> {
    const status = await this.getBlockStatus(ip);
    return status.blocked;
  }

  /**
   * Read the full block status. Returns `{ blocked: false }` when
   * the IP is not blocked, otherwise the reason, source, and the
   * absolute epoch ms expiry.
   */
  async getBlockStatus(ip: string): Promise<IpBlockStatus> {
    const normalized = this.normalizeIp(ip);
    if (!normalized || normalized === 'unknown' || !this.redis)
      return { blocked: false };
    try {
      const client = this.redis.getClient();
      const [raw, ttl] = await Promise.all([
        client.get(this.ipKey(normalized)),
        client.ttl(this.ipKey(normalized)),
      ]);
      if (!raw) {
        // SET membership is the lazily-cleaned shadow — drop it so
        // the dashboard doesn't keep showing a stale entry.
        await client.srem(IpBlocklistService.SET_KEY, normalized).catch(() => 0);
        return { blocked: false };
      }
      let parsed: { reason?: string; source?: string } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Tolerate legacy entries written without JSON.
        parsed = { reason: raw, source: 'unknown' };
      }
      return {
        blocked: true,
        reason: parsed.reason,
        source: parsed.source,
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
      };
    } catch (err) {
      this.logger.warn(
        `getBlockStatus: failed for ${normalized}: ${(err as Error).message}`,
      );
      return { blocked: false };
    }
  }

  /**
   * Bulk-add a list of IPs in a single pipeline. Used by the threat
   * intel sync to onboard thousands of feed entries efficiently.
   * Returns the count of IPs successfully written.
   */
  async blockBulk(
    ips: ReadonlyArray<string>,
    ttlSec: number,
    reason: string,
    source: string,
  ): Promise<number> {
    if (!this.redis) return 0;
    if (ips.length === 0) return 0;
    const ttl = Math.max(1, Math.floor(ttlSec));
    const payload = JSON.stringify({
      reason,
      source,
      blockedAt: new Date().toISOString(),
    });
    let count = 0;
    try {
      const client = this.redis.getClient();
      const pipeline = client.pipeline();
      for (const raw of ips) {
        const ip = this.normalizeIp(raw);
        if (!ip || ip === 'unknown') continue;
        pipeline.set(this.ipKey(ip), payload, 'EX', ttl);
        pipeline.sadd(IpBlocklistService.SET_KEY, ip);
        count++;
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `blockBulk: failed: ${(err as Error).message}`,
      );
      return 0;
    }
    return count;
  }

  /**
   * List currently-blocked IPs for the admin unblock UI. Reads the
   * `SET_KEY` shadow index, then re-checks each member's per-IP key
   * so an entry that expired since it was added to the set is
   * dropped rather than shown as still-blocked (see the class doc —
   * the SET is best-effort and only lazily cleaned).
   */
  async listBlocked(limit = 200): Promise<IpBlockListEntry[]> {
    if (!this.redis) return [];
    try {
      const client = this.redis.getClient();
      const members = await client.smembers(IpBlocklistService.SET_KEY);
      const capped = members.slice(0, Math.max(1, Math.floor(limit)));
      const statuses = await Promise.all(
        capped.map(async (ip) => ({ ip, status: await this.getBlockStatus(ip) })),
      );
      return statuses
        .filter((entry) => entry.status.blocked)
        .map(({ ip, status }) => ({ ip, ...status }));
    } catch (err) {
      this.logger.warn(`listBlocked: failed: ${(err as Error).message}`);
      return [];
    }
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private ipKey(ip: string): string {
    return `${IpBlocklistService.KEY_PREFIX}:${ip}`;
  }

  private normalizeIp(ip: string | undefined | null): string {
    return (ip ?? '').trim();
  }
}
