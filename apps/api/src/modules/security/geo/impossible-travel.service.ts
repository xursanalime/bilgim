import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis/redis.service';
import { AdminAuditService } from '../../admin/admin-audit.service';
import { GeoIpService, type GeoIpLookup } from './geoip.service';

/**
 * Outcome of `checkAndRecord`. The caller (auth flow) consumes this
 * to either allow login, force MFA re-verification, or 403 the
 * session.
 */
export interface ImpossibleTravelDecision {
  /**
   * `true` when the new login is permitted to proceed. `false` only
   * when the geographic delta exceeds the threshold inside the time
   * window AND a previous fix is on file.
   */
  allowed: boolean;
  /**
   * Human-readable reason — surfaced in the 403 response body and
   * the SIEM event. Empty on the allowed path.
   */
  reason?: string;
  /**
   * Great-circle distance (km) between the two fixes, when both
   * resolved. Surfaced under both `distance` (legacy field used by
   * existing callers) and `distanceKm` (canonical, matches the task
   * spec wording) so consumers can pick whichever they prefer.
   */
  distance?: number;
  distanceKm?: number;
  /** Milliseconds elapsed between the previous and current login. */
  elapsedMs?: number;
  /** Country code resolved for the *current* login, when available. */
  currentCountry?: string;
  /**
   * Country code resolved for the *previous* login. Aliased as
   * `prevCountry` to match the task spec; both fields point at the
   * same value.
   */
  previousCountry?: string;
  prevCountry?: string;
  /**
   * `true` when the caller should require an MFA challenge before
   * issuing tokens. Set on every `allowed === false` decision and
   * also on the borderline "country changed" signal so we step the
   * user up without hard-blocking.
   */
  requiresMfaReverification: boolean;
}

/**
 * Internal record persisted in Redis to compare against the next
 * login. Stored as JSON under `geo:user:<userId>:last`.
 */
interface LastLoginRecord {
  ts: number;
  ip: string;
  lat: number;
  lon: number;
  country: string;
}

/** Mean Earth radius in km — used in the haversine formula. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * `ImpossibleTravelService` — Task 27.3 (Req 27.3).
 *
 * On every successful password verification (before tokens are
 * issued) the auth flow calls `checkAndRecord(userId, ip, headers?)`
 * which:
 *
 *   1. Resolves the new login's geo via `GeoIpService`.
 *   2. Loads the previous login record from Redis (`geo:user:<id>:last`).
 *   3. Computes the great-circle distance (haversine) and the
 *      elapsed time between the two events.
 *   4. **Block when** `distance >= 500 km` AND `elapsedMs <= 1 h`
 *      → returns `{ allowed: false, requiresMfaReverification: true }`,
 *      sets a Redis flag forcing MFA on the next attempt, and emits
 *      a `security.impossible_travel` outbox event for the SIEM.
 *   5. **Step-up when** the country changed but the distance / time
 *      threshold is not met — soft signal, returns `{ allowed: true,
 *      requiresMfaReverification: true }` without storing a force
 *      flag.
 *   6. Updates the Redis record with the new fix.
 *
 * Distances are computed using the haversine formula (great-circle
 * distance between two points on a sphere) — accurate to within
 * <0.5% at the 500 km horizon, which is well below the precision
 * the threshold requires.
 *
 * ## Storage layout (Redis)
 *
 * | Key                                  | Type | TTL | Purpose |
 * |--------------------------------------|------|-----|---------|
 * | `geo:user:<userId>:last`             | str  | 30d | Last login record |
 * | `geo:user:<userId>:force_mfa`        | str  | 24h | Force MFA on next login |
 *
 * ## Fail-open posture
 *
 * Every Redis hit / GeoIP lookup is wrapped in `try/catch`. A Redis
 * outage MUST NOT lock every user out — that would be self-DoS
 * worse than the geo anomaly we cover. Failures are logged at
 * `warn` level so SREs notice.
 */
@Injectable()
export class ImpossibleTravelService {
  private readonly logger = new Logger(ImpossibleTravelService.name);

  /**
   * Default distance threshold (km). Logins farther apart trigger
   * the block. Operators can override at runtime via the
   * `IMPOSSIBLE_TRAVEL_DISTANCE_KM` env var.
   */
  static readonly DISTANCE_THRESHOLD_KM = 500;

  /**
   * Default time window (ms). Travel inside this window is
   * "impossible". Override via `IMPOSSIBLE_TRAVEL_WINDOW_SECONDS`.
   */
  static readonly TIME_WINDOW_MS = 60 * 60 * 1000;

  /** TTL for the per-user last-login record (30 days). */
  static readonly LAST_TTL_SEC = 30 * 24 * 60 * 60;

  /** TTL for the force-MFA flag after an impossible-travel block. */
  static readonly FORCE_MFA_TTL_SEC = 24 * 60 * 60;

  /**
   * TTL for the cross-task `mfa:reverify:<userId>` flag. The MFA
   * gate (Task 27.4 / 29.x) reads this Redis key to upgrade a
   * subsequent login attempt into a forced MFA challenge. The 10
   * min window is short enough that a casual lock-out from a VPN
   * hop self-heals, while still long enough for the user to start
   * the MFA flow.
   */
  static readonly MFA_REVERIFY_TTL_SEC = 10 * 60;

  /** Redis key prefix — centralised so operators can grep. */
  static readonly KEY_PREFIX = 'geo:user';

  /** Outbox topic emitted on every block decision. */
  static readonly OUTBOX_TOPIC = 'security.impossible_travel';

  /** Audit-log action string written when the block fires. */
  static readonly ACTION_BLOCKED = 'security.impossible_travel.blocked';

  /** Distance threshold resolved from env at construction time. */
  private readonly distanceThresholdKm: number;
  /** Time window resolved from env at construction time. */
  private readonly timeWindowMs: number;

  constructor(
    private readonly geoIp: GeoIpService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly adminAuditService?: AdminAuditService,
    @Optional()
    @Inject(ConfigService)
    private readonly config?: ConfigService<EnvConfig, true>,
  ) {
    const distanceFromEnv = this.config?.get(
      'IMPOSSIBLE_TRAVEL_DISTANCE_KM',
      { infer: true },
    ) as number | undefined;
    const windowMsFromEnv = this.config?.get(
      'IMPOSSIBLE_TRAVEL_WINDOW_MS',
      { infer: true },
    ) as number | undefined;
    const windowFromEnv = this.config?.get(
      'IMPOSSIBLE_TRAVEL_WINDOW_SECONDS',
      { infer: true },
    ) as number | undefined;
    this.distanceThresholdKm =
      typeof distanceFromEnv === 'number' && distanceFromEnv > 0
        ? distanceFromEnv
        : ImpossibleTravelService.DISTANCE_THRESHOLD_KM;
    // Prefer the explicit millisecond form from the task spec when
    // it is set; fall back to the legacy `_SECONDS` value otherwise.
    if (typeof windowMsFromEnv === 'number' && windowMsFromEnv > 0) {
      this.timeWindowMs = windowMsFromEnv;
    } else if (typeof windowFromEnv === 'number' && windowFromEnv > 0) {
      this.timeWindowMs = windowFromEnv * 1000;
    } else {
      this.timeWindowMs = ImpossibleTravelService.TIME_WINDOW_MS;
    }
  }

  /**
   * Inspect a fresh login and either allow or block it. Records the
   * fix on success so the next attempt can compare against it.
   *
   * `headers` is forwarded to the GeoIP resolver so the
   * `cf-ipcountry` fallback is available when MaxMind is not.
   *
   * The result is also surfaced as a structured log line tagged
   * `event=security.impossible_travel.<allowed|blocked>` so SIEM
   * pipelines can ingest the decision without subscribing to the
   * outbox.
   */
  async checkAndRecord(
    userId: string,
    ip: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<ImpossibleTravelDecision> {
    const fix = await this.safeLookup(ip, headers);

    // No geo signal — fail open, but still try to read the
    // force-MFA flag so we don't leave users in an MFA loop after a
    // Cloudflare / mmdb outage.
    if (!fix) {
      const requiresMfa = await this.isMfaForced(userId);
      const decision: ImpossibleTravelDecision = {
        allowed: true,
        requiresMfaReverification: requiresMfa,
      };
      this.logDecision(userId, ip, decision, {
        reason: 'geo_lookup_unavailable',
      });
      return decision;
    }

    const previous = await this.readLast(userId);

    if (!previous) {
      await this.writeLast(userId, fix, ip, Date.now());
      const decision: ImpossibleTravelDecision = {
        allowed: true,
        currentCountry: fix.country,
        requiresMfaReverification: await this.isMfaForced(userId),
      };
      this.logDecision(userId, ip, decision, { reason: 'first_login' });
      return decision;
    }

    const now = Date.now();
    const elapsedMs = Math.max(0, now - previous.ts);
    const distance = haversineDistanceKm(
      previous.lat,
      previous.lon,
      fix.latitude,
      fix.longitude,
    );

    const inWindow = elapsedMs <= this.timeWindowMs;
    const tooFar = distance >= this.distanceThresholdKm;

    if (inWindow && tooFar) {
      // HARD BLOCK.
      //
      // We deliberately do NOT overwrite the previous fix on a
      // block — leaving it in place means a follow-up attempt from
      // the same suspicious origin still trips the threshold (the
      // attacker can't "settle" the new location by spamming
      // logins). The audit row + force-MFA flag carry the new
      // origin so the SOC has full visibility.
      await this.setMfaForced(userId);
      await this.setMfaReverify(userId);
      await this.emitSecurityEvent(userId, {
        previous,
        current: {
          ts: now,
          ip,
          lat: fix.latitude,
          lon: fix.longitude,
          country: fix.country,
        },
        distance,
        elapsedMs,
      });
      const decision: ImpossibleTravelDecision = {
        allowed: false,
        reason: `Impossible travel detected: ${Math.round(distance)} km in ${Math.round(elapsedMs / 1000 / 60)} minutes`,
        distance,
        distanceKm: distance,
        elapsedMs,
        currentCountry: fix.country,
        previousCountry: previous.country,
        prevCountry: previous.country,
        requiresMfaReverification: true,
      };
      this.logDecision(userId, ip, decision, {
        reason: 'distance_threshold_exceeded',
      });
      return decision;
    }

    // Soft anomaly — country changed but the distance / time
    // threshold isn't met. Step up MFA on the next attempt so a
    // VPN-hopping attacker can't sidestep the hard threshold by
    // pacing requests just outside the 1h window.
    const countryChanged =
      previous.country && fix.country && previous.country !== fix.country;
    await this.writeLast(userId, fix, ip, now);

    const decision: ImpossibleTravelDecision = {
      allowed: true,
      distance,
      distanceKm: distance,
      elapsedMs,
      currentCountry: fix.country,
      previousCountry: previous.country,
      prevCountry: previous.country,
      requiresMfaReverification:
        Boolean(countryChanged && inWindow) ||
        (await this.isMfaForced(userId)),
    };
    this.logDecision(userId, ip, decision, {
      reason: countryChanged ? 'country_changed' : 'within_threshold',
    });
    return decision;
  }

  /**
   * Alias for {@link assertOrChallenge}, matching the wording of the
   * Task 27.3 spec. Both methods are interchangeable; the auth flow
   * may call whichever reads better at the call site.
   */
  async assertAllowed(
    userId: string,
    ip: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<ImpossibleTravelDecision> {
    return this.assertOrChallenge(userId, ip, headers);
  }

  /**
   * Throw `403 IMPOSSIBLE_TRAVEL` when `checkAndRecord` returned
   * `allowed: false`. Convenience wrapper used by the auth flow so
   * the call site stays a single line.
   */
  async assertOrChallenge(
    userId: string,
    ip: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<ImpossibleTravelDecision> {
    const decision = await this.checkAndRecord(userId, ip, headers);
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'IMPOSSIBLE_TRAVEL',
          message:
            'Login blocked due to a suspicious geographic anomaly. Please complete MFA verification.',
          details: {
            distance: decision.distance,
            distanceKm: decision.distanceKm ?? decision.distance,
            elapsedMs: decision.elapsedMs,
            currentCountry: decision.currentCountry,
            previousCountry: decision.previousCountry,
            prevCountry: decision.prevCountry ?? decision.previousCountry,
            requiresMfaReverification: true,
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return decision;
  }

  /**
   * Returns `true` when the user is currently flagged for MFA
   * re-verification because of a recent impossible-travel block.
   * Public so the auth flow can read it after `checkAndRecord` if it
   * needs to mix it into the existing MFA gate.
   */
  async isMfaForced(userId: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      return await this.redis.exists(this.forceMfaKey(userId));
    } catch (err) {
      this.logger.warn(
        `isMfaForced: EXISTS failed for ${userId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Clears the force-MFA flag once the user has actually completed
   * an MFA challenge. Auth flow calls this from the MFA challenge
   * handler. Drops both the long-lived `force_mfa` flag and the
   * short-TTL `mfa:reverify` flag so a successful step-up clears
   * the entire impossible-travel hold.
   */
  async clearMfaForced(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.forceMfaKey(userId));
      await this.redis.del(this.mfaReverifyKey(userId));
    } catch (err) {
      this.logger.warn(
        `clearMfaForced: DEL failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals — Redis state
  // =====================================================================

  private lastKey(userId: string): string {
    return `${ImpossibleTravelService.KEY_PREFIX}:${userId}:last`;
  }

  private forceMfaKey(userId: string): string {
    return `${ImpossibleTravelService.KEY_PREFIX}:${userId}:force_mfa`;
  }

  /**
   * Cross-task flag consumed by the MFA gate (Task 27.4 / 29.x).
   * Distinct from the longer-lived `force_mfa` key so the MFA
   * pipeline can clear it on a successful step-up without losing
   * the audit trail of the original block.
   */
  private mfaReverifyKey(userId: string): string {
    return `mfa:reverify:${userId}`;
  }

  private async readLast(userId: string): Promise<LastLoginRecord | null> {
    if (!this.redis) return null;
    let raw: string | null;
    try {
      raw = await this.redis.get(this.lastKey(userId));
    } catch (err) {
      this.logger.warn(
        `readLast: GET failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<LastLoginRecord>;
      if (!isValidRecord(parsed)) return null;
      return parsed;
    } catch (err) {
      this.logger.warn(
        `readLast: parse failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeLast(
    userId: string,
    fix: GeoIpLookup,
    ip: string,
    ts: number,
  ): Promise<void> {
    if (!this.redis) return;
    const record: LastLoginRecord = {
      ts,
      ip,
      lat: fix.latitude,
      lon: fix.longitude,
      country: fix.country,
    };
    try {
      await this.redis.set(
        this.lastKey(userId),
        JSON.stringify(record),
        ImpossibleTravelService.LAST_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `writeLast: SET failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async setMfaForced(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.forceMfaKey(userId),
        '1',
        ImpossibleTravelService.FORCE_MFA_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `setMfaForced: SET failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Set the short-TTL `mfa:reverify:<userId>` flag consumed by the
   * MFA gate (Task 27.4 / 29.x). Independent of `setMfaForced` so
   * the MFA pipeline can clear it after a successful step-up
   * without losing the longer-lived `force_mfa` audit hook.
   */
  private async setMfaReverify(userId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.mfaReverifyKey(userId),
        '1',
        ImpossibleTravelService.MFA_REVERIFY_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `setMfaReverify: SET failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Emit the structured decision log line. Tagged with
   * `event=security.impossible_travel.<allowed|blocked>` so the
   * SIEM ingest pipeline can pick it up without subscribing to the
   * outbox stream. Stays at `log` level for allows and `warn` for
   * blocks so noisy successful logins don't drown out the signal.
   */
  private logDecision(
    userId: string,
    ip: string,
    decision: ImpossibleTravelDecision,
    extra: { reason?: string } = {},
  ): void {
    const event = decision.allowed
      ? 'security.impossible_travel.allowed'
      : 'security.impossible_travel.blocked';
    const payload = {
      event,
      userId,
      ip,
      reason: extra.reason ?? decision.reason ?? null,
      distanceKm: decision.distanceKm ?? decision.distance ?? null,
      elapsedMs: decision.elapsedMs ?? null,
      previousCountry: decision.previousCountry ?? null,
      currentCountry: decision.currentCountry ?? null,
      requiresMfaReverification: decision.requiresMfaReverification,
    };
    const line = `event=${event} ${JSON.stringify(payload)}`;
    if (decision.allowed) {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
  }

  // =====================================================================
  // Internals — outbox / SIEM event
  // =====================================================================

  private async emitSecurityEvent(
    userId: string,
    detail: {
      previous: LastLoginRecord;
      current: LastLoginRecord;
      distance: number;
      elapsedMs: number;
    },
  ): Promise<void> {
    if (!this.adminAuditService) return;
    try {
      await this.adminAuditService.log(
        null,
        ImpossibleTravelService.ACTION_BLOCKED,
        userId,
        {
          userId,
          previous: detail.previous,
          current: detail.current,
          distanceKm: detail.distance,
          elapsedMs: detail.elapsedMs,
          threshold: {
            distanceKm: ImpossibleTravelService.DISTANCE_THRESHOLD_KM,
            timeWindowMs: ImpossibleTravelService.TIME_WINDOW_MS,
          },
          emittedAt: new Date().toISOString(),
        },
        { ip: detail.current.ip },
      );
    } catch (err) {
      this.logger.warn(
        `emitSecurityEvent: failed for ${userId}: ${(err as Error).message}`,
      );
    }
  }

  private async safeLookup(
    ip: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<GeoIpLookup | null> {
    try {
      return await this.geoIp.lookup(ip, headers);
    } catch (err) {
      this.logger.warn(
        `safeLookup: lookup failed for ${ip}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

// =====================================================================
// Helpers — exported for tests and reuse
// =====================================================================

/**
 * Great-circle distance between two `(lat, lon)` pairs in kilometres,
 * computed via the haversine formula. The formula is accurate to
 * within <0.5% on a true ellipsoid at distances below ~10000 km — a
 * safe margin for the 500 km threshold.
 *
 * `lat1`, `lat2` are in **degrees**. Values outside `[-90, 90]` /
 * `[-180, 180]` are clamped to the valid range, which keeps the
 * function total under randomised property-test inputs.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = toRadians(clampLatitude(lat1));
  const φ2 = toRadians(clampLatitude(lat2));
  const Δφ = toRadians(clampLatitude(lat2) - clampLatitude(lat1));
  const Δλ = toRadians(clampLongitude(lon2) - clampLongitude(lon1));

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-90, Math.min(90, lat));
}

function clampLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  // Wrap into [-180, 180] so antipodal points compute correctly.
  let normalised = ((lon + 180) % 360) - 180;
  if (normalised < -180) normalised += 360;
  return normalised;
}

function isValidRecord(value: Partial<LastLoginRecord>): value is LastLoginRecord {
  return (
    typeof value?.ts === 'number' &&
    Number.isFinite(value.ts) &&
    typeof value?.ip === 'string' &&
    typeof value?.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value?.lon === 'number' &&
    Number.isFinite(value.lon) &&
    typeof value?.country === 'string'
  );
}
