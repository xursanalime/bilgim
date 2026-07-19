import {
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { EnvConfig } from '../../config/config.module';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * One signature category recognised by the WAF. The `pattern` is run
 * against the joined attack-surface string (URL + query + headers + raw
 * body) so a single regex is all that's needed per rule.
 */
export interface WafSignature {
  /** Stable identifier mirrored into the audit log + alert payloads. */
  readonly id: string;
  /** Human-readable category for logs / dashboards. */
  readonly category:
    | 'SQL_INJECTION'
    | 'XSS'
    | 'PATH_TRAVERSAL'
    | 'SUSPICIOUS_USER_AGENT';
  /** Compiled regex run against the inspection target. */
  readonly pattern: RegExp;
}

/**
 * Result of inspecting a single request. Either `null` (clean) or a
 * structured detection that the guard converts into a 403.
 */
export interface WafDetection {
  signatureId: string;
  category: WafSignature['category'];
  matchedAgainst: string;
  /** Truncated sample of the matched substring (no PII, header-name only). */
  sample: string;
}

/**
 * Reason a request was blocked at the WAF layer. Stored verbatim in the
 * Redis blocklist value and surfaced through the admin endpoint.
 */
export type WafBlockReason =
  | 'SIGNATURE_MATCH'
  | 'RATE_LIMIT_BURST'
  | 'CONNECTION_FLOOD'
  | 'MANUAL_BLOCK';

export interface WafBlockEntry {
  ip: string;
  reason: WafBlockReason;
  signatureId?: string;
  blockedAt: string;
  /** ISO timestamp when the blocklist TTL expires. */
  expiresAt: string;
}

/**
 * Subset of an Express-style request the WAF service inspects. Defined
 * here (instead of importing express types) so the service is easy to
 * unit-test.
 */
export interface InspectableRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: unknown;
}

/**
 * Tunables surfaced as constants so tests + monitoring share the same
 * numbers. The values mirror the spec wording in `tasks.md` 27.1.
 */
export const THREAT_PROTECTION_CONSTANTS = {
  /** Burst window — same IP making this many requests inside the window
   *  triggers a hot-IP block. */
  BURST_REQUESTS: 100,
  BURST_WINDOW_SEC: 60,
  /** TTL applied to a hot-IP block. */
  HOT_BLOCK_TTL_SEC: 10 * 60,
  /** TTL applied when a WAF signature fires repeatedly from the same IP. */
  SIGNATURE_BLOCK_TTL_SEC: 30 * 60,
  /** Repeat-offender threshold — N signature hits in the window blocks the IP. */
  REPEAT_OFFENDER_THRESHOLD: 3,
  REPEAT_OFFENDER_WINDOW_SEC: 60 * 60,
  /** Concurrent-connection cap per IP. */
  MAX_CONCURRENT_CONNECTIONS: 50,
  /** TTL applied to the connection counter — fail-safe in case of leaks. */
  CONNECTION_COUNTER_TTL_SEC: 60,
} as const;

/**
 * ThreatProtectionService — application-side WAF + DDoS mitigation
 * helpers (Task 27.1, Requirements 27.1, 27.2).
 *
 * What lives here:
 *   - The signature table used by `ThreatProtectionGuard` to inspect
 *     incoming requests for SQLi / XSS / path-traversal / hostile UAs.
 *   - Redis-backed counters (`waf:burst:{ip}`, `waf:offender:{ip}`,
 *     `waf:conn:{ip}`) implementing rate-based IP blocking, repeat
 *     offender detection, and connection-flood protection.
 *   - The persistent blocklist (`waf:blocked:{ip}`) and the helpers
 *     used by both the guard ("am I blocked?") and the admin endpoint
 *     ("list / unblock").
 *   - The trusted-CIDR allow-list parsed once from `WAF_ALLOWLIST`.
 *
 * What does NOT live here:
 *   - Edge / network-level WAF (Cloudflare). That belongs at the
 *     infra layer; this module is the in-app safety net.
 *   - Rate limiting for normal traffic — that's the
 *     `RateLimitInterceptor`. The burst counter here is intentionally
 *     much higher (100/60s) than the per-route limiter (default
 *     100/min). Hitting this limit means you're behaving like an
 *     attacker, not just a chatty client.
 *
 * Storage / fail-open posture:
 *   - Every Redis call is wrapped in try/catch and falls back to "no
 *     block" on error. A Redis outage MUST NOT lock everybody out.
 *   - The blocklist key uses `waf:blocked:{ip}` with TTL — Redis
 *     auto-expires entries; we never need a sweeper.
 *   - Audit logging is performed by the *guard* (which holds the
 *     PrismaClient + admin audit service); this service stays Redis-
 *     only so it remains cheap to call from the request hot path.
 */
@Injectable()
export class ThreatProtectionService {
  private readonly logger = new Logger(ThreatProtectionService.name);

  /** Parsed allow-list from `WAF_ALLOWLIST` (CIDR or single IP). */
  private readonly allowList: ReadonlyArray<AllowListEntry>;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() configService?: ConfigService<EnvConfig, true>,
  ) {
    const raw =
      configService?.get('WAF_ALLOWLIST', { infer: true }) ?? '';
    this.allowList = parseAllowList(typeof raw === 'string' ? raw : '');
    if (this.allowList.length > 0) {
      this.logger.log(
        `WAF allow-list loaded: ${this.allowList.length} entries`,
      );
    }
  }

  // =================================================================
  // Signature inspection
  // =================================================================

  /**
   * Canonical signature table. Patterns are deliberately conservative
   * (false-positive-prone patterns like a bare `select` keyword are
   * paired with structural cues like punctuation) so we don't reject
   * benign content that happens to mention SQL / HTML.
   */
  static readonly SIGNATURES: ReadonlyArray<WafSignature> = [
    // ---- SQL injection -------------------------------------------------
    {
      id: 'sqli.union_select',
      category: 'SQL_INJECTION',
      pattern: /\bunion\s+(all\s+)?select\b/i,
    },
    {
      id: 'sqli.boolean_or',
      category: 'SQL_INJECTION',
      // Classic ' OR 1=1, " OR 'a'='a, etc.
      pattern: /['"`)\s]\s*or\s+['"`(\s]*\d+\s*=\s*\d+/i,
    },
    {
      id: 'sqli.tautology',
      category: 'SQL_INJECTION',
      pattern: /\b(?:and|or)\s+\d+=\d+\s*--/i,
    },
    {
      id: 'sqli.comment_termination',
      category: 'SQL_INJECTION',
      pattern: /(?:--\s|;\s*--|\/\*.*?\*\/)/,
    },
    {
      id: 'sqli.stacked_query',
      category: 'SQL_INJECTION',
      pattern:
        /;\s*(?:select|insert|update|delete|drop|alter|truncate)\b/i,
    },
    {
      id: 'sqli.function_call',
      category: 'SQL_INJECTION',
      pattern: /\b(?:sleep|benchmark|pg_sleep|load_file|extractvalue)\s*\(/i,
    },

    // ---- XSS -----------------------------------------------------------
    {
      id: 'xss.script_tag',
      category: 'XSS',
      pattern: /<\s*script\b[^>]*>/i,
    },
    {
      id: 'xss.javascript_uri',
      category: 'XSS',
      pattern: /javascript\s*:/i,
    },
    {
      id: 'xss.event_handler',
      category: 'XSS',
      // on{event}= e.g. onclick=, onerror=, onload=
      pattern: /\bon[a-z]{3,}\s*=\s*['"]?[^'">]+/i,
    },
    {
      id: 'xss.iframe_src',
      category: 'XSS',
      pattern: /<\s*iframe\b[^>]*src\s*=\s*['"]?(?:javascript:|data:)/i,
    },

    // ---- Path traversal ------------------------------------------------
    {
      id: 'traversal.dotdot_slash',
      category: 'PATH_TRAVERSAL',
      // ../ and ..\ — including URL-encoded variants
      pattern: /(?:\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%2e%2e%5c)/i,
    },
    {
      id: 'traversal.absolute_unix',
      category: 'PATH_TRAVERSAL',
      // /etc/passwd, /etc/shadow probes
      pattern: /\/etc\/(?:passwd|shadow|hosts)\b/i,
    },

    // ---- Suspicious user agents ---------------------------------------
    {
      id: 'ua.sqlmap',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bsqlmap\b/i,
    },
    {
      id: 'ua.nikto',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bnikto\b/i,
    },
    {
      id: 'ua.nessus',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bnessus\b/i,
    },
    {
      id: 'ua.masscan',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bmasscan\b/i,
    },
    {
      id: 'ua.acunetix',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bacunetix\b/i,
    },
    {
      id: 'ua.nmap',
      category: 'SUSPICIOUS_USER_AGENT',
      pattern: /\bnmap\b/i,
    },
  ];

  /**
   * Inspect a request for any WAF signature. The user-agent rules only
   * run against the UA header so harmless content that mentions
   * "sqlmap" inside a body (e.g. an article about pentesting) is not
   * flagged.
   *
   * Returns the first matching signature, or `null` for clean traffic.
   */
  inspect(request: InspectableRequest): WafDetection | null {
    const target = composeInspectionTarget(request);
    const userAgent = extractHeader(request.headers, 'user-agent');

    for (const sig of ThreatProtectionService.SIGNATURES) {
      if (sig.category === 'SUSPICIOUS_USER_AGENT') {
        if (userAgent && sig.pattern.test(userAgent)) {
          return {
            signatureId: sig.id,
            category: sig.category,
            matchedAgainst: 'user-agent',
            sample: truncate(userAgent),
          };
        }
        continue;
      }

      const match = sig.pattern.exec(target);
      if (match) {
        return {
          signatureId: sig.id,
          category: sig.category,
          matchedAgainst: classifyTarget(request),
          sample: truncate(match[0] ?? ''),
        };
      }
    }
    return null;
  }

  // =================================================================
  // Allow-list
  // =================================================================

  /**
   * `true` when the IP belongs to a trusted CIDR or is loopback. Used
   * by the guard to short-circuit every check (signatures, rate limit,
   * blocklist) for internal traffic.
   */
  isAllowed(ip: string): boolean {
    if (!ip) return false;
    if (isLoopback(ip)) return true;
    return this.allowList.some((entry) => entry.matches(ip));
  }

  // =================================================================
  // Blocklist
  // =================================================================

  /**
   * Persist a blocklist entry. The value is JSON so the admin endpoint
   * can return reason + expiry without an extra round-trip.
   */
  async blockIp(
    ip: string,
    reason: WafBlockReason,
    ttlSeconds: number,
    extra: { signatureId?: string } = {},
  ): Promise<WafBlockEntry | null> {
    if (!this.redis || !ip) return null;

    const blockedAt = new Date();
    const expiresAt = new Date(blockedAt.getTime() + ttlSeconds * 1000);
    const entry: WafBlockEntry = {
      ip,
      reason,
      ...(extra.signatureId !== undefined && {
        signatureId: extra.signatureId,
      }),
      blockedAt: blockedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    try {
      await this.redis.set(blocklistKey(ip), JSON.stringify(entry), ttlSeconds);
      return entry;
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.blockIp failed for ${ip}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Manually unblock an IP (used by the admin endpoint). */
  async unblockIp(ip: string): Promise<boolean> {
    if (!this.redis || !ip) return false;
    try {
      const removed = await this.redis.del(blocklistKey(ip));
      return removed > 0;
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.unblockIp failed for ${ip}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Return the current block entry for `ip`, or `null`. */
  async getBlockEntry(ip: string): Promise<WafBlockEntry | null> {
    if (!this.redis || !ip) return null;
    try {
      const raw = await this.redis.get(blocklistKey(ip));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WafBlockEntry;
      if (
        !parsed ||
        typeof parsed.ip !== 'string' ||
        typeof parsed.reason !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.getBlockEntry failed for ${ip}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * List active block entries. Iterates with SCAN so a large blocklist
   * (>10k IPs) does not stall Redis. Capped to `limit` entries.
   */
  async listBlockedIps(limit = 200): Promise<WafBlockEntry[]> {
    if (!this.redis) return [];
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const collected: WafBlockEntry[] = [];

    try {
      const client = this.redis.getClient();
      let cursor = '0';
      const matchPattern = `${BLOCKLIST_PREFIX}*`;

      do {
        const reply = await client.scan(
          cursor,
          'MATCH',
          matchPattern,
          'COUNT',
          200,
        );
        cursor = reply[0];
        const keys = reply[1] ?? [];
        if (keys.length > 0) {
          const values = await client.mget(...keys);
          for (const raw of values) {
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as WafBlockEntry;
              if (parsed && typeof parsed.ip === 'string') {
                collected.push(parsed);
                if (collected.length >= safeLimit) break;
              }
            } catch {
              // ignore corrupt entry — harmless on the read side
            }
          }
        }
        if (collected.length >= safeLimit) break;
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.listBlockedIps failed: ${(err as Error).message}`,
      );
    }

    return collected;
  }

  // =================================================================
  // Counters: burst, repeat-offender, connections
  // =================================================================

  /**
   * Increment the per-IP burst counter. Returns the post-increment
   * value so the caller can decide whether to apply the hot block.
   * On Redis outage returns 0 (fail-open).
   */
  async recordRequest(ip: string): Promise<number> {
    return this.bumpCounter(
      burstKey(ip),
      THREAT_PROTECTION_CONSTANTS.BURST_WINDOW_SEC,
    );
  }

  /**
   * Same shape as `recordRequest`, but for the longer-window
   * "repeat offender" counter that aggregates signature hits per IP.
   */
  async recordSignatureHit(ip: string): Promise<number> {
    return this.bumpCounter(
      offenderKey(ip),
      THREAT_PROTECTION_CONSTANTS.REPEAT_OFFENDER_WINDOW_SEC,
    );
  }

  /**
   * Increment connection count for `ip`, returning the new value.
   * Pair with `releaseConnection` in a request `finally` block.
   */
  async acquireConnection(ip: string): Promise<number> {
    return this.bumpCounter(
      connectionKey(ip),
      THREAT_PROTECTION_CONSTANTS.CONNECTION_COUNTER_TTL_SEC,
    );
  }

  /** Decrement (floor at 0) the connection count for `ip`. */
  async releaseConnection(ip: string): Promise<void> {
    if (!this.redis || !ip) return;
    try {
      const client = this.redis.getClient();
      const newValue = await client.decr(connectionKey(ip));
      if (newValue < 0) {
        // Reset to 0 if a misbehaving caller decrements without a prior
        // increment — keeps the counter sane.
        await client.set(connectionKey(ip), '0');
      }
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.releaseConnection failed for ${ip}: ${(err as Error).message}`,
      );
    }
  }

  // =================================================================
  // Internals
  // =================================================================

  private async bumpCounter(key: string, ttlSeconds: number): Promise<number> {
    if (!this.redis) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttlSeconds);
      }
      return count;
    } catch (err) {
      this.logger.warn(
        `ThreatProtectionService.bumpCounter failed for ${key}: ${(err as Error).message}`,
      );
      return 0;
    }
  }
}

// =====================================================================
// Module-private helpers
// =====================================================================

const BLOCKLIST_PREFIX = 'waf:blocked:';

function blocklistKey(ip: string): string {
  return `${BLOCKLIST_PREFIX}${ip}`;
}

function burstKey(ip: string): string {
  return `waf:burst:${ip}`;
}

function offenderKey(ip: string): string {
  return `waf:offender:${ip}`;
}

function connectionKey(ip: string): string {
  return `waf:conn:${ip}`;
}

/**
 * Parse the `WAF_ALLOWLIST` env variable. Accepts a comma-separated
 * list of CIDR ranges (`10.0.0.0/8`) or single IPs (`203.0.113.5`).
 * Invalid entries are logged-and-dropped so a typo never widens the
 * allow-list.
 */
function parseAllowList(raw: string): AllowListEntry[] {
  if (!raw) return [];
  const out: AllowListEntry[] = [];
  for (const piece of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const parsed = AllowListEntry.tryParse(piece);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Tiny CIDR matcher — no third-party dependency. Supports both IPv4
 * and IPv6. We bias the implementation toward IPv4 because that's
 * what the bulk of internal CIDRs look like; IPv6 entries fall back
 * to exact-IP matching which is the safer default if anybody ever
 * configures a v6 subnet without us testing it.
 */
class AllowListEntry {
  private constructor(
    private readonly raw: string,
    private readonly mode: 'ipv4-cidr' | 'exact',
    private readonly network?: number,
    private readonly mask?: number,
  ) {}

  static tryParse(value: string): AllowListEntry | null {
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
      return new AllowListEntry(value, 'ipv4-cidr', network, mask);
    }
    return new AllowListEntry(value, 'exact');
  }

  matches(ip: string): boolean {
    if (this.mode === 'exact') {
      return this.raw === ip;
    }
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null || this.mask === undefined || this.network === undefined) {
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

function isLoopback(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}

/**
 * Build the single string the signature regexes inspect. Combining
 * URL + query + body + headers means a single pass catches signatures
 * regardless of which surface they ride in on. The string is capped
 * at 16 KiB to avoid running regexes against runaway payloads.
 */
function composeInspectionTarget(request: InspectableRequest): string {
  const parts: string[] = [];
  if (request.originalUrl) parts.push(decodeMaybe(request.originalUrl));
  else if (request.url) parts.push(decodeMaybe(request.url));

  if (request.query) parts.push(stringifyShallow(request.query));
  if (request.body !== undefined && request.body !== null) {
    parts.push(stringifyShallow(request.body));
  }

  // We deliberately exclude Authorization / Cookie from the inspection
  // surface so secrets never end up in the audit-log sample.
  const headers = request.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie') continue;
    if (lower === 'user-agent') continue; // inspected separately
    if (Array.isArray(value)) parts.push(value.join(' '));
    else if (value) parts.push(String(value));
  }

  const joined = parts.join(' \n ');
  if (joined.length <= 16_384) return joined;
  return joined.slice(0, 16_384);
}

function classifyTarget(request: InspectableRequest): string {
  if (request.body && hasContent(request.body)) return 'body';
  if (request.query && hasContent(request.query)) return 'query';
  return 'url';
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

function decodeMaybe(value: string): string {
  try {
    // Decode once so URL-encoded payloads (`%3Cscript%3E`) match the
    // signature table.
    return `${value} ${decodeURIComponent(value)}`;
  } catch {
    return value;
  }
}

function stringifyShallow(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct.join(' ') : String(direct);
  }
  // Headers are sometimes preserved with original casing — fall back
  // to a case-insensitive scan.
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name) {
      return Array.isArray(v) ? v.join(' ') : v ? String(v) : undefined;
    }
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > 200 ? `${value.slice(0, 197)}...` : value;
}
