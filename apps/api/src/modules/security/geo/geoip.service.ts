import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { RedisService } from '../../../infra/redis/redis.service';

/**
 * Resolved geolocation for a single IP. `null` when the IP cannot be
 * located (private / loopback / database miss).
 */
export interface GeoIpLookup {
  /** ISO-3166-1 alpha-2 country code, uppercase. */
  country: string;
  /** WGS-84 latitude in decimal degrees, range [-90, 90]. */
  latitude: number;
  /** WGS-84 longitude in decimal degrees, range [-180, 180]. */
  longitude: number;
  /**
   * Approximate radius (km) within which the actual location lies.
   * MaxMind GeoLite2 surfaces this — when missing we default to 50km
   * which roughly matches the city-level accuracy of the free DB.
   */
  accuracyRadius: number;
}

/**
 * Static city → coordinate fallback used when no MaxMind DB is
 * configured. The platform serves Uzbekistan first so the table
 * covers the major IP→country signals we expect at the edge plus a
 * handful of common origins.
 *
 * The values are publicly documented city centres — they are precise
 * enough for impossible-travel detection (we look at >500km deltas)
 * without coupling the runtime to a binary `mmdb` ship. Real
 * deployments still drop in a `GeoLite2-City.mmdb` and let MaxMind
 * take over.
 */
const COUNTRY_FALLBACK: Readonly<Record<string, [number, number]>> = {
  UZ: [41.3111, 69.2797], // Tashkent
  KZ: [51.1605, 71.4704], // Astana
  KG: [42.8746, 74.5698], // Bishkek
  TJ: [38.5598, 68.787], // Dushanbe
  TM: [37.9601, 58.3261], // Ashgabat
  RU: [55.7558, 37.6176], // Moscow
  TR: [39.9334, 32.8597], // Ankara
  CN: [39.9042, 116.4074], // Beijing
  US: [38.8951, -77.0364], // Washington DC
  GB: [51.5074, -0.1278], // London
  DE: [52.52, 13.405], // Berlin
  FR: [48.8566, 2.3522], // Paris
  IN: [28.6139, 77.209], // New Delhi
  JP: [35.6762, 139.6503], // Tokyo
  KR: [37.5665, 126.978], // Seoul
};

/**
 * Lazy MaxMind reader — `Reader` is loaded dynamically so the
 * `@maxmind/geoip2-node` dependency stays optional. Operators install
 * the package + drop in a `mmdb` file when they want full
 * IP-resolution; everyone else keeps running on the header / fallback
 * path.
 */
type CityResponse = {
  country?: { iso_code?: string };
  registered_country?: { iso_code?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    accuracy_radius?: number;
  };
};
type MaxMindReader = {
  city: (ip: string) => CityResponse;
};

/**
 * GeoIP resolver — Task 27.3 (Req 27.3).
 *
 * Resolves an IP to `{ country, latitude, longitude, accuracyRadius }`
 * so `ImpossibleTravelService` can apply the haversine threshold.
 *
 * ## Resolution order
 *
 *   1. **Redis cache** (`geo:lookup:<ip>`, 1h TTL) — geolocation is
 *      stable per IP, so we hit Redis first to avoid touching the
 *      mmdb / falling back to headers on every login. Cache values
 *      are JSON-encoded `GeoIpLookup`s. A `MISS` sentinel is also
 *      stored so a private IP doesn't keep walking the full chain
 *      every minute.
 *   2. **MaxMind GeoLite2 City DB** when `MAXMIND_GEOIP_DB_PATH` is
 *      configured. The reader is loaded lazily — the
 *      `@maxmind/geoip2-node` package is optional and not bundled by
 *      default. If `require()` fails (package missing) or the file
 *      can not be opened, we log once and fall back.
 *   3. **`cf-ipcountry` header** — Cloudflare sets it on every
 *      request that traverses our edge. We map the country to a
 *      country-centre coordinate from `COUNTRY_FALLBACK`. The
 *      accuracyRadius is intentionally large (`500 km`) so the
 *      caller knows the location is country-precision.
 *   4. **null** — every signal failed, fail-open.
 *
 * ## Fail-open posture
 *
 * Every external dependency is wrapped in `try/catch`. A Redis
 * outage, a missing mmdb, or a malformed header MUST NOT lock every
 * user out — that would be self-DoS worse than the geo-anomaly we
 * cover. Failures are logged at `warn` level so SREs notice.
 */
@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name);

  /** Redis cache TTL for IP → location resolutions (1 hour). */
  static readonly CACHE_TTL_SEC = 60 * 60;

  /**
   * Redis key prefix — centralised so operators can grep. The task
   * spec standardised on `geo:ip:<ip>` (formerly `geo:lookup:<ip>`);
   * we cache under the new prefix and keep the legacy prefix as a
   * fallback read so an in-flight rolling deploy does not invalidate
   * the cache the moment it ships.
   */
  static readonly KEY_PREFIX = 'geo:ip';
  static readonly LEGACY_KEY_PREFIX = 'geo:lookup';

  /** Sentinel value cached when an IP cannot be resolved. */
  static readonly MISS_SENTINEL = '__MISS__';

  /** Default accuracy radius (km) when MaxMind doesn't report one. */
  static readonly DEFAULT_ACCURACY_RADIUS_KM = 50;

  /** Accuracy radius surfaced when we resolve via cf-ipcountry. */
  static readonly COUNTRY_ACCURACY_RADIUS_KM = 500;

  /** Lazily-loaded MaxMind reader. `null` once we've tried and given up. */
  private maxmindReader: MaxMindReader | null = null;
  private maxmindAttempted = false;

  constructor(
    @Optional() private readonly config?: ConfigService<EnvConfig, true>,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Resolve `ip` to a geolocation, or `null` when no signal applies.
   *
   * `headers` is consulted only when the upstream paths fail — pass
   * the raw `req.headers` from the auth controller so the
   * `cf-ipcountry` fallback is available.
   */
  async lookup(
    ip: string,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<GeoIpLookup | null> {
    const normalizedIp = (ip ?? '').trim();
    if (!normalizedIp || isPrivateIp(normalizedIp)) {
      return null;
    }

    // 1) Redis cache.
    const cached = await this.readCache(normalizedIp);
    if (cached === 'miss') return null;
    if (cached) return cached;

    // 2) MaxMind GeoLite2.
    const fromMaxmind = this.lookupMaxmind(normalizedIp);
    if (fromMaxmind) {
      await this.writeCache(normalizedIp, fromMaxmind);
      return fromMaxmind;
    }

    // 3) `cf-ipcountry` header.
    const fromHeader = lookupFromHeader(headers);
    if (fromHeader) {
      await this.writeCache(normalizedIp, fromHeader);
      return fromHeader;
    }

    // 4) Cache the miss so we don't keep walking the chain.
    await this.writeMiss(normalizedIp);
    return null;
  }

  /**
   * Drop the cached entry for `ip` — exposed so admin tooling can
   * force a re-resolution without bouncing Redis.
   */
  async invalidate(ip: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.cacheKey(ip));
    } catch (err) {
      this.logger.warn(
        `invalidate: DEL failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private cacheKey(ip: string): string {
    return `${GeoIpService.KEY_PREFIX}:${ip}`;
  }

  private async readCache(
    ip: string,
  ): Promise<GeoIpLookup | 'miss' | null> {
    if (!this.redis) return null;
    try {
      let raw = await this.redis.get(this.cacheKey(ip));
      // Fallback: tolerate the legacy `geo:lookup:<ip>` prefix during
      // rolling deploys so we don't double-resolve every IP for an
      // hour after the new code lands.
      if (!raw) {
        raw = await this.redis.get(
          `${GeoIpService.LEGACY_KEY_PREFIX}:${ip}`,
        );
      }
      if (!raw) return null;
      if (raw === GeoIpService.MISS_SENTINEL) return 'miss';
      const parsed = JSON.parse(raw) as Partial<GeoIpLookup>;
      if (!isValidLookup(parsed)) return null;
      return parsed;
    } catch (err) {
      this.logger.warn(
        `readCache: GET failed for ${ip}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(ip: string, value: GeoIpLookup): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.cacheKey(ip),
        JSON.stringify(value),
        GeoIpService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `writeCache: SET failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  private async writeMiss(ip: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        this.cacheKey(ip),
        GeoIpService.MISS_SENTINEL,
        GeoIpService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `writeMiss: SET failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Walk the MaxMind reader. Returns `null` when no DB is configured,
   * the package isn't installed, or the IP isn't in the DB. Lazy-load
   * keeps the optional dependency truly optional.
   */
  private lookupMaxmind(ip: string): GeoIpLookup | null {
    const reader = this.getMaxmindReader();
    if (!reader) return null;
    try {
      const response = reader.city(ip);
      const country =
        response?.country?.iso_code ??
        response?.registered_country?.iso_code ??
        null;
      const latitude = response?.location?.latitude;
      const longitude = response?.location?.longitude;
      if (
        !country ||
        typeof latitude !== 'number' ||
        typeof longitude !== 'number'
      ) {
        return null;
      }
      const accuracyRadius =
        typeof response?.location?.accuracy_radius === 'number' &&
        response.location.accuracy_radius > 0
          ? response.location.accuracy_radius
          : GeoIpService.DEFAULT_ACCURACY_RADIUS_KM;
      return {
        country: country.toUpperCase(),
        latitude,
        longitude,
        accuracyRadius,
      };
    } catch (err) {
      // AddressNotFoundError is normal for private / unreachable IPs.
      // Anything else we still log so the SOC can spot mmdb corruption.
      const message = (err as Error).message;
      if (!/not found/i.test(message)) {
        this.logger.warn(`lookupMaxmind: ${ip} → ${message}`);
      }
      return null;
    }
  }

  private getMaxmindReader(): MaxMindReader | null {
    if (this.maxmindReader) return this.maxmindReader;
    if (this.maxmindAttempted) return null;
    this.maxmindAttempted = true;

    const dbPath =
      ((this.config?.get('GEOIP_MMDB_PATH', { infer: true }) as
        | string
        | undefined) ??
        (this.config?.get('MAXMIND_GEOIP_DB_PATH', { infer: true }) as
          | string
          | undefined) ??
        (this.config?.get('MAXMIND_DB_PATH', { infer: true }) as
          | string
          | undefined)) ?? '';
    if (!dbPath) return null;

    try {
      // Lazy-require so the package stays optional. Use eval'd require
      // so the TypeScript / bundler tooling does not try to resolve
      // `@maxmind/geoip2-node` at build time.

      const dynamicRequire = eval('require') as NodeRequire;
      const geoip = dynamicRequire('@maxmind/geoip2-node') as {
        Reader: { openBuffer: (b: Buffer) => MaxMindReader };
      };

      const fs = dynamicRequire('fs') as typeof import('fs');
      const buffer = fs.readFileSync(dbPath);
      this.maxmindReader = geoip.Reader.openBuffer(buffer);
      this.logger.log(`MaxMind GeoLite2 DB loaded from ${dbPath}`);
      return this.maxmindReader;
    } catch (err) {
      this.logger.warn(
        `MaxMind DB unavailable (${dbPath}) — falling back to header: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

// =====================================================================
// Helpers — exported for unit tests
// =====================================================================

/**
 * Resolve `cf-ipcountry` → coordinate fallback. Returns `null` when
 * the header is missing, malformed, or maps to a country we don't
 * have a centroid for.
 */
export function lookupFromHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): GeoIpLookup | null {
  if (!headers) return null;
  let raw: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'cf-ipcountry') {
      raw = Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;
      break;
    }
  }
  if (!raw || !/^[a-zA-Z]{2}$/.test(raw)) return null;
  const code = raw.toUpperCase();
  const centre = COUNTRY_FALLBACK[code];
  if (!centre) return null;
  return {
    country: code,
    latitude: centre[0],
    longitude: centre[1],
    accuracyRadius: GeoIpService.COUNTRY_ACCURACY_RADIUS_KM,
  };
}

/**
 * RFC1918 / loopback / link-local check. We treat private IPs as
 * unresolvable so dev environments don't trigger spurious geo
 * anomalies on `127.0.0.1`-vs-`::1` deltas.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === '::1' || ip === 'unknown' || ip.startsWith('::ffff:127.')) {
    return true;
  }
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  // IPv6 unique-local fc00::/7
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}

function isValidLookup(value: Partial<GeoIpLookup>): value is GeoIpLookup {
  return (
    typeof value?.country === 'string' &&
    /^[A-Z]{2}$/.test(value.country) &&
    typeof value?.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    typeof value?.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180 &&
    typeof value?.accuracyRadius === 'number' &&
    value.accuracyRadius >= 0
  );
}
