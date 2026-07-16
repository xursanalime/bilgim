import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '../../../config/env.schema';

/**
 * Lightweight Express-style request shape consumed by the TLS
 * enforcement middleware. Defined locally (instead of importing
 * `@types/express`) so the file compiles cleanly under both real
 * Express and the unit-test stubs.
 */
export interface TlsEnforcementRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  protocol?: string;
  secure?: boolean;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { encrypted?: boolean; remoteAddress?: string };
  connection?: { encrypted?: boolean; remoteAddress?: string };
  traceId?: string;
}

export interface TlsEnforcementResponse {
  headersSent?: boolean;
  status: (code: number) => TlsEnforcementResponse;
  json: (body: unknown) => TlsEnforcementResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type TlsEnforcementNext = (err?: unknown) => void;

/**
 * Paths that bypass the TLS gate entirely. Kubelet probes and
 * Prometheus scrapers must keep working over plain HTTP inside the
 * cluster network even when the public ingress mandates TLS 1.3.
 */
const SKIP_PATH_PREFIXES = [
  '/health',
  '/metrics',
  '/api/v1/health',
  '/api/v1/metrics',
];

/**
 * `TlsEnforcementMiddleware` — guards the API process against
 * plaintext HTTP traffic when running behind a TLS-terminating
 * reverse proxy (Cloudflare / ingress / Nginx).
 *
 * **Scope** — Task 28.4, Req 28.2.
 *
 * The middleware runs AFTER `trust proxy` is enabled in `main.ts`
 * (Task 24.1) so `req.protocol` and the `X-Forwarded-Proto` header
 * already reflect the upstream hop. It interprets the request as
 * "secure" when ANY of:
 *
 *   - `req.secure === true` (Express resolves this from the trusted
 *     proxy hop's `X-Forwarded-Proto`).
 *   - `req.protocol === 'https'`.
 *   - `req.socket?.encrypted === true` (direct HTTPS bind, no proxy).
 *   - `X-Forwarded-Proto === 'https'` (defensive — covers older
 *     Express versions and bespoke proxy chains).
 *
 * If none of the above hold and enforcement is enabled, the
 * middleware short-circuits with `403 TLS_REQUIRED`. The matching
 * envelope shape is reused across the security stack so SOC
 * tooling can pivot on `code=TLS_REQUIRED`.
 *
 * **Toggle.** `TLS_ENFORCEMENT_ENABLED` (boolean) overrides the
 * default. When unset the middleware infers from `NODE_ENV`:
 *
 *   - `production`               → ON.
 *   - everywhere else            → OFF (dev, test, staging-debug).
 *
 * Health and metrics endpoints are excluded by path prefix even
 * when the gate is on, so kubelet probes never get rejected.
 */
@Injectable()
export class TlsEnforcementMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TlsEnforcementMiddleware.name);
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService<EnvConfig>) {
    const explicit = this.config.get('TLS_ENFORCEMENT_ENABLED' as never) as
      | boolean
      | undefined;
    const nodeEnv = (this.config.get('NODE_ENV' as never) as string) ?? 'development';
    this.enabled =
      explicit === true || explicit === false
        ? explicit
        : nodeEnv === 'production';

    if (this.enabled) {
      this.logger.log(
        `TLS enforcement enabled (NODE_ENV=${nodeEnv}). Plain HTTP requests will be rejected with 403 TLS_REQUIRED.`,
      );
    } else {
      this.logger.log(
        `TLS enforcement disabled (NODE_ENV=${nodeEnv}). Set TLS_ENFORCEMENT_ENABLED=true to force HTTPS.`,
      );
    }
  }

  use(
    req: TlsEnforcementRequest,
    res: TlsEnforcementResponse,
    next: TlsEnforcementNext,
  ): void {
    if (!this.enabled) {
      next();
      return;
    }

    const rawPath = (req.path ?? req.originalUrl ?? req.url ?? '/').split('?')[0];
    const path = rawPath ?? '/';
    if (SKIP_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      next();
      return;
    }

    if (this.isSecure(req)) {
      next();
      return;
    }

    this.logger.warn(
      `Rejected plaintext HTTP request: ${req.method ?? 'GET'} ${path} from ${
        req.ip ?? req.socket?.remoteAddress ?? 'unknown'
      }`,
    );

    if (res.headersSent) {
      // Headers already flushed — nothing safe to do but let the
      // request finish naturally.
      next();
      return;
    }

    res
      .status(403)
      .json({
        error: {
          code: 'TLS_REQUIRED',
          message:
            'Plaintext HTTP is not permitted; retry over HTTPS (TLS 1.3).',
          traceId: req.traceId,
        },
      });
  }

  /**
   * Resolve whether the request reached us over a secure hop. We
   * accept any of: Express's resolved `req.secure`, the protocol
   * field, the raw socket flag, or an explicit
   * `X-Forwarded-Proto: https` header.
   */
  private isSecure(req: TlsEnforcementRequest): boolean {
    if (req.secure === true) return true;
    if (typeof req.protocol === 'string' && req.protocol.toLowerCase() === 'https') {
      return true;
    }
    if (req.socket?.encrypted === true || req.connection?.encrypted === true) {
      return true;
    }

    const forwardedProto = headerValue(req.headers, 'x-forwarded-proto');
    if (forwardedProto && forwardedProto.toLowerCase() === 'https') {
      return true;
    }
    return false;
  }
}

function headerValue(
  headers: TlsEnforcementRequest['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    // Forwarded headers can carry a comma-separated chain
    // (`https, http`). The first hop is the closest to the client,
    // which is the one we want.
    const first = raw[0];
    if (typeof first !== 'string') return undefined;
    return first.split(',')[0]?.trim();
  }
  return typeof raw === 'string' ? raw.split(',')[0]?.trim() : undefined;
}
