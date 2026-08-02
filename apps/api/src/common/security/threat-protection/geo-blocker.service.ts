import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';

/**
 * Geo-blocker — Task 27.1.
 *
 * Stub of a country-level allow/deny check, hooked up so the platform
 * has a single point to flip on real GeoIP enforcement once we wire
 * up MaxMind / Cloudflare's `CF-IPCountry` header.
 *
 * Behaviour today:
 *   - Reads `BLOCKED_COUNTRIES` (comma-separated ISO-3166-1 alpha-2
 *     codes) from env. Defaults to empty — no IP gets blocked.
 *   - Resolves a country code from one of the following sources, in
 *     order of trust:
 *       1. The `cf-ipcountry` request header (set by Cloudflare on
 *          every request that traverses our edge).
 *       2. A static `GEO_OVERRIDES` env entry — a JSON map of
 *          `cidr|exact-ip → ISO_CODE`. Useful for tests and for
 *          deployments that don't run behind Cloudflare.
 *   - Returns `null` (= no decision possible) when neither source
 *     produces a country code. The middleware treats `null` as
 *     allowed — fail open, mirroring the rest of the module.
 *
 * Why a stub: the design doc earmarks Cloudflare WAF / GeoIP as the
 * authoritative geo-block layer. The application-side module exists
 * to (a) provide a hard backstop that survives a Cloudflare config
 * drift, and (b) offer the same enforcement surface for e2e tests
 * and on-prem deployments that bypass Cloudflare.
 */

export interface GeoLookupRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export type GeoDecision = {
  /** ISO country code, when we could resolve one. */
  countryCode: string | null;
  /** True when the resolved country is on the block list. */
  blocked: boolean;
};

@Injectable()
export class GeoBlockerService {
  private readonly logger = new Logger(GeoBlockerService.name);

  /** Uppercase ISO codes parsed from `BLOCKED_COUNTRIES`. */
  private readonly blockedCountries: ReadonlySet<string>;

  /**
   * Static overrides parsed from `GEO_OVERRIDES`. Format:
   *   `cidr_or_ip=ISO_CODE`, comma-separated.
   * Example: `203.0.113.0/24=KP,198.51.100.5=IR`.
   */
  private readonly overrides: ReadonlyArray<GeoOverrideEntry>;

  constructor(
    @Optional() configService?: ConfigService<EnvConfig, true>,
  ) {
    const rawBlocked =
      (configService?.get('BLOCKED_COUNTRIES', { infer: true }) as
        | string
        | undefined) ?? '';
    this.blockedCountries = parseCountries(rawBlocked);
    if (this.blockedCountries.size > 0) {
      this.logger.log(
        `Geo-block list loaded: ${Array.from(this.blockedCountries).join(', ')}`,
      );
    }

    const rawOverrides =
      (configService?.get('GEO_OVERRIDES', { infer: true }) as
        | string
        | undefined) ?? '';
    this.overrides = parseOverrides(rawOverrides);
  }

  /**
   * Whether `code` (case-insensitive) is on the configured block list.
   * Exposed for use in tests + for callers that have already resolved
   * the country via a different path.
   */
  isCountryBlocked(code: string | null | undefined): boolean {
    if (!code) return false;
    return this.blockedCountries.has(code.toUpperCase());
  }

  /**
   * Inspect the request, resolve a country code, and return a
   * decision. The decision is `{countryCode: null, blocked: false}`
   * when we couldn't resolve a country — geo-block stays optional /
   * fail-open by design.
   */
  evaluate(req: GeoLookupRequest): GeoDecision {
    const code = this.resolveCountry(req);
    if (!code) {
      return { countryCode: null, blocked: false };
    }
    return { countryCode: code, blocked: this.isCountryBlocked(code) };
  }

  /**
   * Resolve the country code from the available sources in order of
   * trust. Returns `null` when none apply.
   */
  resolveCountry(req: GeoLookupRequest): string | null {
    // 1) Cloudflare header — most trusted source. We sanity-check
    //    the value is a 2-letter alpha string before accepting it
    //    so a malformed header doesn't poison decisions.
    const cf = readHeader(req.headers, 'cf-ipcountry');
    if (cf && /^[a-zA-Z]{2}$/.test(cf)) {
      return cf.toUpperCase();
    }

    // 2) Static overrides.
    const ip = (req.ip ?? '').trim();
    if (ip && this.overrides.length > 0) {
      for (const entry of this.overrides) {
        if (entry.matches(ip)) return entry.country;
      }
    }

    return null;
  }

  /** Read-only view used by tests / diagnostics. */
  get blockedList(): string[] {
    return Array.from(this.blockedCountries);
  }
}

// =====================================================================
// Helpers
// =====================================================================

function parseCountries(raw: string): ReadonlySet<string> {
  if (!raw) return new Set<string>();
  const out = new Set<string>();
  for (const piece of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^[a-zA-Z]{2}$/.test(piece)) {
      out.add(piece.toUpperCase());
    }
  }
  return out;
}

function readHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      if (Array.isArray(v)) return v[0];
      return typeof v === 'string' ? v : undefined;
    }
  }
  return undefined;
}

function parseOverrides(raw: string): GeoOverrideEntry[] {
  if (!raw) return [];
  const out: GeoOverrideEntry[] = [];
  for (const piece of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const target = piece.slice(0, eq).trim();
    const country = piece.slice(eq + 1).trim();
    if (!/^[a-zA-Z]{2}$/.test(country)) continue;
    const entry = GeoOverrideEntry.tryParse(target, country.toUpperCase());
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Tiny IPv4-aware CIDR matcher mirroring the helpers used elsewhere
 * in the security module. IPv6 entries fall back to exact-string
 * matching, which is the safer default until v6 is properly tested.
 */
class GeoOverrideEntry {
  private constructor(
    private readonly raw: string,
    public readonly country: string,
    private readonly mode: 'ipv4-cidr' | 'exact',
    private readonly network?: number,
    private readonly mask?: number,
  ) {}

  static tryParse(value: string, country: string): GeoOverrideEntry | null {
    if (value.includes('/') && isIpv4Cidr(value)) {
      const [base, prefix] = value.split('/');
      if (!base) return null;
      const prefixLen = Number(prefix);
      if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
        return null;
      }
      const baseInt = ipv4ToInt(base);
      if (baseInt === null) return null;
      const mask =
        prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
      const network = baseInt & mask;
      return new GeoOverrideEntry(
        value,
        country,
        'ipv4-cidr',
        network,
        mask,
      );
    }
    return new GeoOverrideEntry(value, country, 'exact');
  }

  matches(ip: string): boolean {
    if (this.mode === 'exact') return this.raw === ip;
    const ipInt = ipv4ToInt(ip);
    if (
      ipInt === null ||
      this.mask === undefined ||
      this.network === undefined
    ) {
      return false;
    }
    return (ipInt & this.mask) === this.network;
  }
}

function isIpv4Cidr(value: string): boolean {
  const [base] = value.split('/');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(base ?? '');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0;
}
