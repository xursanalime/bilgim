import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  Req,
} from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import { isNonBlockableIp } from '../../../common/security/ip-classification';
import { IpBlocklistService } from '../blocklist/ip-blocklist.service';
import { SiemService } from '../siem/siem.service';

interface HoneypotRequest {
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
 * Decoy responses returned by the honeypot endpoints. Each looks
 * just plausible enough that a naive scanner will record a "hit"
 * and stop probing — but contains no real data, no version
 * fingerprints, and nothing exploitable.
 *
 * The decoy bodies intentionally vary by endpoint so a scanner
 * fingerprinting on response shape ends up with diverse, useless
 * captures.
 */
const HONEYPOT_DECOYS: Record<string, { body: string; contentType: string }> = {
  '/admin-backup': {
    body: 'admin-backup.zip not found',
    contentType: 'text/plain; charset=utf-8',
  },
  '/admin-backup.zip': {
    body: 'PK\x03\x04', // ZIP magic — looks real to fingerprinters.
    contentType: 'application/zip',
  },
  '/admin-backup.tar.gz': {
    body: '\x1f\x8b\x08\x00', // gzip magic.
    contentType: 'application/gzip',
  },
  '/wp-login.php': {
    body: '<html><head><title>Log In &lsaquo; WordPress</title></head><body><form id="loginform" action="" method="post"></form></body></html>',
    contentType: 'text/html; charset=utf-8',
  },
  '/wp-admin': {
    body: '<html><head><title>Dashboard &lsaquo; WordPress</title></head><body></body></html>',
    contentType: 'text/html; charset=utf-8',
  },
  '/wp-content/uploads': {
    body: '<html><body><pre>Index of /wp-content/uploads</pre></body></html>',
    contentType: 'text/html; charset=utf-8',
  },
  '/.env': {
    body: '# .env\nAPP_ENV=production\n',
    contentType: 'text/plain; charset=utf-8',
  },
  '/.git/config': {
    body: '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n',
    contentType: 'text/plain; charset=utf-8',
  },
  '/phpmyadmin': {
    body: '<html><head><title>phpMyAdmin</title></head><body></body></html>',
    contentType: 'text/html; charset=utf-8',
  },
  '/xmlrpc.php': {
    body: '<?xml version="1.0"?><methodResponse><params/></methodResponse>',
    contentType: 'text/xml; charset=utf-8',
  },
};

/**
 * Honeypot controller — Task 27.5, Req 27.8.
 *
 * Exposes well-known scanner-bait paths at the bare URL (no
 * `/api/v1` prefix) so the routes shadow the exact strings real
 * scanners use:
 *
 *   - `/admin-backup`, `/admin-backup.zip`, `/admin-backup.tar.gz`
 *   - `/wp-login.php`, `/wp-admin`, `/wp-content/uploads`
 *   - `/.env`, `/.git/config`, `/phpmyadmin`, `/xmlrpc.php`
 *
 * On every hit the controller:
 *
 *   1. Adds the source IP to the `IpBlocklistService` blocklist
 *      with a 24h TTL.
 *   2. Emits a `security.honeypot.hit` SIEM event at CRITICAL
 *      severity (auto-paged via Sentry forwarding).
 *   3. Returns a small, plausible decoy body so the scanner records
 *      "200 OK, content received" and moves on instead of probing
 *      harder.
 *
 * **Bypassing the global prefix** — the routes are listed in the
 * `app.setGlobalPrefix('api/v1', { exclude: [...] })` exclusion in
 * `main.ts`. The `@Controller()` decorator with no path means each
 * `@Get('/path')` resolves at the path written below, regardless of
 * any other prefix.
 *
 * **Auth bypass** — every route is `@Public()` so the global JWT
 * guard skips it. Honeypots must look identical to a public,
 * unauthenticated endpoint or the scanner will fingerprint the auth
 * challenge and skip the route.
 */
@Controller()
@Public()
export class HoneypotController {
  private readonly logger = new Logger(HoneypotController.name);

  constructor(
    private readonly blocklist: IpBlocklistService,
    @Optional() private readonly siem?: SiemService,
  ) {}

  /**
   * The list of paths the honeypot owns. Re-exported so the
   * correlation-engine tests can synthesise hits against the same
   * vocabulary the controller writes.
   */
  static readonly HONEYPOT_PATHS = Object.keys(HONEYPOT_DECOYS);

  // ---- /admin-backup variants -------------------------------------

  @Get('/admin-backup')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async adminBackup(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/admin-backup', req);
  }

  @Get('/admin-backup.zip')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async adminBackupZip(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/admin-backup.zip', req);
  }

  @Get('/admin-backup.tar.gz')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async adminBackupTarGz(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/admin-backup.tar.gz', req);
  }

  // ---- WordPress bait ---------------------------------------------

  @Get('/wp-login.php')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async wpLogin(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/wp-login.php', req);
  }

  @Get('/wp-admin')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async wpAdmin(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/wp-admin', req);
  }

  @Get('/wp-content/uploads')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async wpUploads(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/wp-content/uploads', req);
  }

  // ---- Misconfiguration probes ------------------------------------

  @Get('/.env')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async envFile(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/.env', req);
  }

  @Get('/.git/config')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async gitConfig(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/.git/config', req);
  }

  @Get('/phpmyadmin')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async phpmyadmin(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/phpmyadmin', req);
  }

  @Get('/xmlrpc.php')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async xmlrpc(@Req() req: HoneypotRequest): Promise<string> {
    return this.handle('/xmlrpc.php', req);
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async handle(path: string, req: HoneypotRequest): Promise<string> {
    const ip = extractClientIp(req);

    // Never block infrastructure addresses. Behind correctly-configured
    // IP attribution the XFF/BFF-aware `req.ip` resolves real clients to
    // their public address, so genuine scanners are still blocked. A
    // loopback or private `ip` here means we could NOT attribute the
    // request to a caller — it is a health probe, a local smoke test, or
    // (the dangerous case) the shared BFF address standing in for every
    // user at once. Blocking that for 24h locked the whole platform out
    // on 2026-07-25, `/auth/login` included. See `isNonBlockableIp`.
    const isLocal = isNonBlockableIp(ip);

    // Block the IP for 24h. Best-effort — never let a Redis blip
    // suppress the decoy response, the scanner should still see a
    // plausible body.
    if (!isLocal) {
      try {
        await this.blocklist.block(
          ip,
          IpBlocklistService.DEFAULT_HONEYPOT_TTL_SEC,
          `Honeypot endpoint hit: ${path}`,
          'honeypot',
        );
      } catch (err) {
        this.logger.warn(
          `handle: blocklist write failed for ${ip} on ${path}: ${(err as Error).message}`,
        );
      }
    }

    if (this.siem) {
      try {
        await this.siem.recordEvent({
          type: 'security.honeypot.hit',
          severity: 'CRITICAL',
          ip,
          traceId: req.traceId ?? null,
          payload: {
            path,
            method: req.method ?? 'GET',
            userAgent: extractUserAgent(req),
            blockTtlSec: IpBlocklistService.DEFAULT_HONEYPOT_TTL_SEC,
          },
        });
      } catch (err) {
        this.logger.warn(
          `handle: SIEM emit failed for ${ip} on ${path}: ${(err as Error).message}`,
        );
      }
    }

    const decoy = HONEYPOT_DECOYS[path] ?? {
      body: 'Not Found',
      contentType: 'text/plain; charset=utf-8',
    };
    return decoy.body;
  }
}

function extractClientIp(req: HoneypotRequest): string {
  // SECURITY: trust ONLY the IP Express derived under `trust proxy =
  // 'loopback'` (req.ip), plus the raw socket address as a fallback. A
  // client-supplied `X-Forwarded-For` must never override this — otherwise
  // an attacker could forge their source IP to poison this blocklist (block
  // an arbitrary victim / a whole NAT gateway) or dodge their own block.
  // The header is consulted only when no connection IP exists at all
  // (non-Express unit-test stubs); a real request always has one.
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

function extractUserAgent(req: HoneypotRequest): string | null {
  const raw = req.headers?.['user-agent'];
  if (typeof raw === 'string') return raw.slice(0, 256);
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === 'string') return first.slice(0, 256);
  }
  return null;
}
