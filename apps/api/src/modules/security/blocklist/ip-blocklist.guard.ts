import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { isNonBlockableIp } from '../../../common/security/ip-classification';
import { SiemService } from '../siem/siem.service';
import { IpBlocklistService } from './ip-blocklist.service';

interface BlocklistRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  traceId?: string;
}

/**
 * Path prefixes that bypass the guard. Health and metrics endpoints
 * are kept open so kubelet probes / Prometheus scrapes are never
 * rejected — same exclusion list used by the WAF and rate-limit
 * guards.
 */
const SKIP_PATH_PREFIXES = [
  '/health',
  '/metrics',
  '/api/v1/health',
  '/api/v1/metrics',
];

/**
 * `IpBlocklistGuard` — Task 27.5, Req 27.8 / 27.10.
 *
 * Global guard that rejects every request from a blocklisted IP
 * with `403 IP_BLOCKED` before any other guard does work. Wired as
 * the very first APP_GUARD in `AppModule` so the dispatcher avoids
 * spending cycles on:
 *
 *   - DDoS sliding-window arithmetic
 *   - Rate-limit token-bucket calls
 *   - Threat-protection pattern matching
 *   - JWT validation
 *
 * The guard short-circuits health and metrics paths so kubelet probes
 * and Prometheus scrapes never get caught by an over-eager block.
 *
 * **Fail-open posture**: when `IpBlocklistService` itself is unable
 * to read Redis (and therefore returns `blocked=false`), the guard
 * lets the request through — preventing a Redis outage from locking
 * every caller out of the platform.
 */
@Injectable()
export class IpBlocklistGuard implements CanActivate {
  private readonly logger = new Logger(IpBlocklistGuard.name);

  /**
   * Break-glass allow-list from `IP_BLOCKLIST_ALLOWLIST`. Read once at
   * construction — recovering from a bad block is a redeploy, and a
   * per-request env read would only hide that.
   */
  private readonly allowList: ReadonlySet<string>;

  constructor(
    private readonly blocklist: IpBlocklistService,
    @Optional() private readonly siem?: SiemService,
    @Optional() configService?: ConfigService,
  ) {
    const raw =
      (configService?.get('IP_BLOCKLIST_ALLOWLIST') as string | undefined) ??
      process.env.IP_BLOCKLIST_ALLOWLIST ??
      '';
    this.allowList = new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    );
    if (this.allowList.size > 0) {
      this.logger.log(
        `IP blocklist break-glass allow-list loaded: ${this.allowList.size} entr${this.allowList.size === 1 ? 'y' : 'ies'}`,
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<BlocklistRequest>();
    if (this.shouldSkip(request)) return true;

    const ip = extractClientIp(request);
    if (!ip || ip === 'unknown') return true;

    // Never *enforce* a block against shared infrastructure, even if one
    // is already sitting in Redis from before the write-side guard
    // existed. `IpBlocklistService.block()` refuses to create these, but
    // enforcement has to refuse independently: a stale entry on the BFF's
    // private address would otherwise keep the entire platform — and the
    // admin unblock UI, which needs `/auth/login` — locked out for the
    // full TTL, up to 7 days for a threat-intel import.
    if (isNonBlockableIp(ip)) return true;

    // Break-glass: an operator locked out by a legitimate block on a
    // public address can restore access with an env var + redeploy,
    // without needing a Redis shell they may not have.
    if (this.allowList.has(ip.toLowerCase())) return true;

    const status = await this.blocklist.getBlockStatus(ip);
    if (!status.blocked) return true;

    // Emit a SIEM event for visibility — the actual block decision
    // is made here, but the record gives the SOC a way to count
    // rejected attempts per source.
    if (this.siem) {
      try {
        await this.siem.recordEvent({
          type: 'security.blocklist.ip.rejected',
          severity: 'MEDIUM',
          ip,
          traceId: request.traceId ?? null,
          payload: {
            reason: status.reason ?? 'unknown',
            source: status.source ?? 'unknown',
            method: request.method ?? 'GET',
            path: sanitisePath(request),
          },
        });
      } catch (err) {
        // Telemetry is best-effort — never fail the rejection on it.
        this.logger.warn(
          `canActivate: SIEM emit failed: ${(err as Error).message}`,
        );
      }
    }

    const response = http.getResponse<{
      setHeader?: (name: string, value: string) => unknown;
    }>();
    if (response && typeof response.setHeader === 'function') {
      try {
        if (status.expiresAt) {
          const retryAfterSec = Math.max(
            1,
            Math.ceil((status.expiresAt - Date.now()) / 1000),
          );
          response.setHeader('Retry-After', String(retryAfterSec));
        }
      } catch {
        /* socket already gone */
      }
    }

    throw new HttpException(
      {
        code: 'IP_BLOCKED',
        message: 'This network has been blocked due to suspicious activity.',
        details: {
          source: status.source,
          ...(status.expiresAt
            ? {
                retryAfter: Math.max(
                  1,
                  Math.ceil((status.expiresAt - Date.now()) / 1000),
                ),
              }
            : {}),
        },
      },
      HttpStatus.FORBIDDEN,
    );
  }

  private shouldSkip(req: BlocklistRequest): boolean {
    const raw = req.originalUrl ?? req.url ?? req.path ?? '';
    if (!raw) return false;
    const pathOnly = raw.split('?')[0] ?? '';
    return SKIP_PATH_PREFIXES.some((prefix) => pathOnly.startsWith(prefix));
  }
}

function extractClientIp(req: BlocklistRequest): string {
  // SECURITY: trust ONLY the IP Express derived under `trust proxy =
  // 'loopback'` (req.ip), plus the raw socket address as a fallback. A
  // client-supplied `X-Forwarded-For` must never override this, or a
  // blocked attacker could set the header to any unblocked value and walk
  // straight past their own block. The header is consulted only when no
  // connection IP exists at all (non-Express unit-test stubs).
  const direct =
    req.ip ?? req.connection?.remoteAddress ?? req.socket?.remoteAddress;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return 'unknown';
}

function sanitisePath(req: BlocklistRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
