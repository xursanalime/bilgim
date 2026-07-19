import {
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../../config/config.module';
import { resolveTraceId } from '../../observability/trace-context';

/**
 * Subset of an Express request the admin allowlist reads. Keeps the
 * file usable from non-express test stubs.
 */
export interface AdminAllowlistRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  traceId?: string;
}

export interface AdminAllowlistResponse {
  headersSent?: boolean;
  status: (code: number) => AdminAllowlistResponse;
  json: (body: unknown) => AdminAllowlistResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type AdminAllowlistNext = (err?: unknown) => void;

/**
 * Admin IP allowlist middleware (Task 27.1, requirement 3).
 *
 * Wired against `/admin/*` routes (and the `/api/v1/admin/*` form
 * Nest produces after the global prefix is applied). Reads the
 * comma-separated `ADMIN_IP_ALLOWLIST` env var; each entry is a
 * single IPv4 address or an IPv4 CIDR range (`10.0.0.0/8`).
 *
 * Behaviour:
 *
 *   - **Empty allowlist (default)** — middleware is a no-op. Useful
 *     for local development and for environments where access is
 *     gated at the network layer (VPN, bastion host, ingress ACLs).
 *   - **Populated allowlist** — request IP must match at least one
 *     entry; otherwise the middleware responds with `403 ADMIN_IP_NOT_ALLOWED`.
 *   - **Loopback** is always allowed — kubelet probes and local
 *     debugging never get locked out.
 *
 * The check runs early in the pipeline (before `JwtAuthGuard`), so a
 * leaked admin token presented from a non-allow-listed IP is still
 * rejected before any auth work runs. That makes the middleware a
 * compensating control for credential theft.
 */
@Injectable()
export class AdminIpAllowlistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminIpAllowlistMiddleware.name);
  private readonly entries: ReadonlyArray<AdminAllowlistEntry>;

  constructor(@Optional() configService?: ConfigService<EnvConfig, true>) {
    const raw =
      (configService?.get('ADMIN_IP_ALLOWLIST', { infer: true }) as
        | string
        | undefined) ?? '';
    this.entries = parseEntries(raw);
    if (this.entries.length > 0) {
      this.logger.log(
        `Admin IP allowlist loaded: ${this.entries.length} entries`,
      );
    }
  }

  use(
    req: AdminAllowlistRequest,
    res: AdminAllowlistResponse,
    next: AdminAllowlistNext,
  ): void {
    if (this.entries.length === 0) {
      return next();
    }

    const ip = extractClientIp(req);
    if (this.matches(ip)) {
      return next();
    }

    const traceId = req.traceId ?? resolveTraceId(req.headers ?? {});
    req.traceId = traceId;

    this.logger.warn({
      message: 'Admin IP allowlist violation',
      traceId,
      clientIp: ip,
      method: req.method ?? 'GET',
      path: sanitisePath(req),
    });

    if (res.headersSent) {
      // Response already started for some upstream reason — bail
      // out so we don't try to write a second envelope.
      return;
    }

    if (typeof res.setHeader === 'function') {
      try {
        res.setHeader('X-Trace-Id', traceId);
      } catch {
        /* socket already closed */
      }
    }

    res.status(403).json({
      error: {
        code: 'ADMIN_IP_NOT_ALLOWED',
        message: 'Request blocked by security policy',
        traceId,
      },
    });
  }

  /**
   * True when `ip` matches any allowlist entry or is loopback.
   * Exposed so the wiring tests can verify the matching shape
   * without simulating the full HTTP request.
   */
  isAllowed(ip: string): boolean {
    if (this.entries.length === 0) return true;
    return this.matches(ip);
  }

  /**
   * Number of parsed entries. Used by the wiring tests to verify
   * that a populated `ADMIN_IP_ALLOWLIST` was actually loaded.
   */
  get entryCount(): number {
    return this.entries.length;
  }

  private matches(ip: string): boolean {
    if (!ip) return false;
    if (isLoopback(ip)) return true;
    return this.entries.some((entry) => entry.matches(ip));
  }
}

// =====================================================================
// Helpers
// =====================================================================

function parseEntries(raw: string): AdminAllowlistEntry[] {
  if (!raw) return [];
  const out: AdminAllowlistEntry[] = [];
  for (const piece of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const parsed = AdminAllowlistEntry.tryParse(piece);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Tiny IPv4 / CIDR matcher. IPv6 entries fall back to exact-string
 * match because the platform's standard deployment is dual-stack
 * with IPv4 ingress; on-prem operators are expected to add the
 * canonical lowercase form when allow-listing IPv6 addresses.
 */
class AdminAllowlistEntry {
  private constructor(
    private readonly raw: string,
    private readonly mode: 'ipv4-cidr' | 'exact',
    private readonly network?: number,
    private readonly mask?: number,
  ) {}

  static tryParse(value: string): AdminAllowlistEntry | null {
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
      return new AdminAllowlistEntry(value, 'ipv4-cidr', network, mask);
    }
    return new AdminAllowlistEntry(value, 'exact');
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

function isLoopback(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}

function extractClientIp(req: AdminAllowlistRequest): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return (
    req.ip ??
    req.connection?.remoteAddress ??
    req.socket?.remoteAddress ??
    'unknown'
  );
}

function sanitisePath(req: AdminAllowlistRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
