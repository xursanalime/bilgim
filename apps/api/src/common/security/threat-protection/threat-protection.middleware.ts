import {
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';

import { EnvConfig } from '../../../config/config.module';
import { resolveTraceId } from '../../observability/trace-context';
import {
  detectSuspiciousRequest,
  type InspectableRequest,
  type SuspiciousRequestMatch,
} from './suspicious-request.detector';
import {
  GeoBlockerService,
  type GeoLookupRequest,
} from './geo-blocker.service';
import {
  TieredRateLimiterService,
  type RateLimitReason,
} from './tiered-rate-limiter.service';

/**
 * Lightweight Express response surface. We avoid pulling in
 * `@types/express` here so the file remains easy to test with a stub.
 */
export interface ThreatResponse {
  headersSent?: boolean;
  status: (code: number) => ThreatResponse;
  json: (body: unknown) => ThreatResponse;
  setHeader?: (name: string, value: string) => unknown;
}

export type ThreatNext = (err?: unknown) => void;

/**
 * Combined Express request shape — picks up the `user` payload that
 * downstream auth middleware may have set, plus the trace id and the
 * client IP fields the rest of the stack uses.
 */
export interface ThreatRequest extends InspectableRequest, GeoLookupRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
  traceId?: string;
  user?: { sub?: string; id?: string } | null;
}

/**
 * Audit-logger surface — kept narrow so the middleware can be wired
 * to either the canonical `AdminAuditService` or a Prisma client
 * directly.
 */
export interface ThreatAuditLogger {
  log(event: ThreatAuditEvent): Promise<void>;
}

/**
 * Event payload flushed to the audit log. Stored in `AdminAuditLog`
 * as `{ action: 'waf.blocked' | 'waf.geo_blocked' | 'waf.rate_limited',
 *      target: clientIp, ip: clientIp, payload: {...} }`.
 *
 * The `sample` slice on a `WAF_BLOCKED` event is sanitised by the
 * detector — it never echoes raw request payload back into structured
 * storage.
 */
export type ThreatAuditEvent =
  | {
      type: 'WAF_BLOCKED';
      ip: string;
      ruleName: string;
      category: string;
      surface: string;
      sample: string;
      method: string;
      path: string;
      traceId: string;
    }
  | {
      type: 'GEO_BLOCKED';
      ip: string;
      countryCode: string;
      method: string;
      path: string;
      traceId: string;
    }
  | {
      type: 'RATE_LIMITED';
      ip: string;
      reason: RateLimitReason;
      retryAfterSeconds: number;
      method: string;
      path: string;
      userId: string | null;
      traceId: string;
    };

/**
 * Default audit-logger that writes to the existing `AdminAuditLog`
 * table. Action strings are kept stable so SIEM exports + the admin
 * UI can group events.
 */
@Injectable()
export class PrismaThreatAuditLogger implements ThreatAuditLogger {
  private readonly logger = new Logger(PrismaThreatAuditLogger.name);
  constructor(@Optional() private readonly prisma?: PrismaClient) {}

  async log(event: ThreatAuditEvent): Promise<void> {
    if (!this.prisma) return;
    try {
      const payload = payloadForEvent(event);
      await this.prisma.adminAuditLog.create({
        data: {
          actorId: null,
          action: actionForEvent(event),
          target: event.ip,
          payload: payload as unknown as Prisma.InputJsonValue,
          ip: event.ip,
        },
      });
    } catch (err) {
      this.logger.warn(
        `PrismaThreatAuditLogger.log failed: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Application-layer threat-protection middleware (Task 27.1).
 *
 * Wired as a global middleware in `main.ts`, it runs **before** any
 * controller, guard, or interceptor. Order of operations:
 *
 *   1. Skip when `THREAT_PROTECTION_ENABLED=false`.
 *   2. Geo-block — return `403 GEO_BLOCKED` when the resolved country
 *      is on `BLOCKED_COUNTRIES`.
 *   3. Suspicious-request detector — return `400 WAF_BLOCKED` on
 *      SQLi / XSS / path-traversal / oversized header signatures.
 *   4. Tiered rate limiter — return `429 RATE_LIMITED` (with
 *      `Retry-After`) on burst, global, or per-user overage.
 *
 * Every reject path emits a single audit-log entry asynchronously.
 * Failures in the audit pipeline never block the rejection — the
 * 4xx response is the source of truth.
 *
 * The detector is deliberately the first thing we run after geo
 * because a SQLi probe is cheaper to short-circuit than to count.
 * The rate limiter, in contrast, talks to Redis on every call —
 * we run it last so a clearly-malicious request never inflates the
 * counter.
 */
@Injectable()
export class ThreatProtectionMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ThreatProtectionMiddleware.name);

  constructor(
    private readonly geo: GeoBlockerService,
    private readonly rateLimiter: TieredRateLimiterService,
    private readonly audit: ThreatAuditLogger,
    @Optional() private readonly config?: ConfigService<EnvConfig, true>,
  ) {}

  async use(
    req: ThreatRequest,
    res: ThreatResponse,
    next: ThreatNext,
  ): Promise<void> {
    if (!this.isEnabled()) {
      next();
      return;
    }

    // The global LoggingInterceptor stamps `req.traceId` later; mint
    // one here so every audit entry is correlatable from this point on.
    const traceId = req.traceId ?? resolveTraceId(req.headers ?? {});
    req.traceId = traceId;

    const ip = extractClientIp(req);
    const userId =
      (req.user?.sub ?? req.user?.id ?? null) === ''
        ? null
        : req.user?.sub ?? req.user?.id ?? null;
    const method = req.method ?? 'GET';
    const path = sanitisePath(req);

    // 1) Geo-block
    const geoDecision = this.geo.evaluate({
      ip,
      headers: req.headers ?? {},
    });
    if (geoDecision.blocked && geoDecision.countryCode) {
      this.logger.warn({
        message: 'Geo-block enforced',
        ip,
        countryCode: geoDecision.countryCode,
        method,
        path,
        traceId,
      });
      void this.audit.log({
        type: 'GEO_BLOCKED',
        ip,
        countryCode: geoDecision.countryCode,
        method,
        path,
        traceId,
      });
      respond(res, traceId, 403, {
        error: {
          code: 'GEO_BLOCKED',
          message: 'Access from your region is not permitted',
          countryCode: geoDecision.countryCode,
          traceId,
        },
      });
      return;
    }

    // 2) Suspicious-request detector
    const suspicious = detectSuspiciousRequest(req);
    if (suspicious) {
      this.logger.warn({
        message: 'Suspicious request blocked',
        ip,
        ruleName: suspicious.rule.name,
        category: suspicious.rule.category,
        surface: suspicious.surface,
        method,
        path,
        traceId,
      });
      void this.audit.log({
        type: 'WAF_BLOCKED',
        ip,
        ruleName: suspicious.rule.name,
        category: suspicious.rule.category,
        surface: suspicious.surface,
        sample: suspicious.sample,
        method,
        path,
        traceId,
      });
      respond(res, traceId, 400, {
        error: {
          code: 'WAF_BLOCKED',
          message: 'Request blocked by Web Application Firewall',
          ruleName: suspicious.rule.name,
          category: suspicious.rule.category,
          traceId,
        },
      });
      return;
    }

    // 3) Tiered rate limiter
    const rl = await this.rateLimiter.consume({ ip, userId });
    if (!rl.allowed && rl.reason) {
      this.logger.warn({
        message: 'Tiered rate limit exceeded',
        ip,
        userId,
        reason: rl.reason,
        retryAfterSeconds: rl.retryAfterSeconds,
        method,
        path,
        traceId,
      });
      void this.audit.log({
        type: 'RATE_LIMITED',
        ip,
        reason: rl.reason,
        retryAfterSeconds: rl.retryAfterSeconds,
        method,
        path,
        userId,
        traceId,
      });
      if (typeof res.setHeader === 'function') {
        try {
          res.setHeader(
            'Retry-After',
            String(Math.max(1, rl.retryAfterSeconds)),
          );
        } catch {
          /* socket already closed */
        }
      }
      respond(res, traceId, 429, {
        error: {
          code: 'RATE_LIMITED',
          message: 'Request rate exceeded — please slow down',
          reason: rl.reason,
          retryAfterSeconds: rl.retryAfterSeconds,
          traceId,
        },
      });
      return;
    }

    next();
  }

  /**
   * Master toggle. Defaults are environment-aware so dev / test stays
   * frictionless while production is on out of the box.
   *
   *   - Explicit `THREAT_PROTECTION_ENABLED=true|false` always wins.
   *   - Otherwise, `NODE_ENV=production` enables the middleware and
   *     every other environment leaves it off.
   */
  private isEnabled(): boolean {
    if (!this.config) return false;
    const explicit = this.config.get('THREAT_PROTECTION_ENABLED', {
      infer: true,
    }) as boolean | undefined;
    if (typeof explicit === 'boolean') return explicit;
    const env = this.config.get('NODE_ENV', { infer: true });
    return env === 'production';
  }
}

// =====================================================================
// Helpers
// =====================================================================

function actionForEvent(event: ThreatAuditEvent): string {
  switch (event.type) {
    case 'WAF_BLOCKED':
      return 'waf.blocked';
    case 'GEO_BLOCKED':
      return 'waf.geo_blocked';
    case 'RATE_LIMITED':
      return 'waf.rate_limited';
  }
}

function payloadForEvent(event: ThreatAuditEvent): Record<string, unknown> {
  switch (event.type) {
    case 'WAF_BLOCKED':
      return {
        ruleName: event.ruleName,
        category: event.category,
        surface: event.surface,
        sample: event.sample,
        method: event.method,
        path: event.path,
        traceId: event.traceId,
      };
    case 'GEO_BLOCKED':
      return {
        countryCode: event.countryCode,
        method: event.method,
        path: event.path,
        traceId: event.traceId,
      };
    case 'RATE_LIMITED':
      return {
        reason: event.reason,
        retryAfterSeconds: event.retryAfterSeconds,
        method: event.method,
        path: event.path,
        userId: event.userId,
        traceId: event.traceId,
      };
  }
}

function extractClientIp(req: ThreatRequest): string {
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

function sanitisePath(req: ThreatRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}

/**
 * Write a 4xx response without calling `next()`. Sets `X-Trace-Id`
 * for client-side correlation.
 */
function respond(
  res: ThreatResponse,
  traceId: string,
  status: number,
  body: Record<string, unknown>,
): void {
  if (res.headersSent) return;
  if (typeof res.setHeader === 'function') {
    try {
      res.setHeader('X-Trace-Id', traceId);
    } catch {
      /* socket already closed */
    }
  }
  res.status(status).json(body);
}

/**
 * Helper used by the global wiring: builds an Express-compatible
 * request handler that delegates to a {@link ThreatProtectionMiddleware}
 * instance. Keeps `main.ts` free of `@types/express` imports.
 */
export function makeThreatProtectionRequestHandler(
  middleware: ThreatProtectionMiddleware,
): (req: ThreatRequest, res: ThreatResponse, next: ThreatNext) => void {
  return (req, res, next) => {
    Promise.resolve(middleware.use(req, res, next)).catch((err) => next(err));
  };
}
