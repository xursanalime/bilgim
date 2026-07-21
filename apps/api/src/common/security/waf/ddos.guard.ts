import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import { DdosProtectionService } from './ddos-protection.service';

/**
 * Subset of the Express request the guard reads. Kept narrow so we
 * don't have to import `@types/express` to test the guard.
 */
interface DdosRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { sub?: string; id?: string } | null;
}

/**
 * Subset of the Express response the guard mutates to set
 * `Retry-After` before NestJS serialises the exception.
 */
interface DdosResponse {
  setHeader?: (name: string, value: string) => unknown;
}

/**
 * Path prefixes that are exempt from the DDoS guard. The kubelet's
 * liveness / readiness probes hit `/health` repeatedly; Prometheus
 * scrapes `/metrics` once per scrape interval. Throttling either of
 * those would cause the platform to take itself down.
 *
 * The WAF middleware skips the same paths via `consumer.exclude(...)`
 * but the guard runs after the global prefix has been applied, so we
 * keep the exclusion redundantly here.
 */
const DDOS_EXEMPT_PREFIXES = [
  '/health',
  '/metrics',
  // The global prefix is `/api/v1`, but `health` is excluded from
  // it. We still check both the prefixed and unprefixed forms so
  // alternate ingress paths don't sneak past the exempt list.
  '/api/v1/health',
  '/api/v1/metrics',
];

/**
 * Global DDoS guard (Task 27.1).
 *
 * Runs BEFORE `JwtAuthGuard` (wired in `AppModule.providers` ordering)
 * so an unauthenticated flooder is throttled before we ever spend
 * cycles validating their token. The guard never short-circuits a
 * route based on its `@Public()` decorator — being unauthenticated
 * does not exempt you from rate limits, only from RBAC.
 *
 * Two checks run on every HTTP request:
 *
 *   1. **Token bucket** — `DDOS_IP_RATE_LIMIT` (default 200 req/min)
 *      tokens per IP, refilled at `capacity / window` per second.
 *      Allows short bursts up to the bucket's full capacity, while
 *      capping the long-run rate. Implemented via Redis hash on
 *      key `ddos:tb:{ip}`.
 *
 *   2. **Sliding window** — legacy fixed-window counter on key
 *      `ddos:{kind}:{ip}` with a TTL equal to `DDOS_WINDOW_SECONDS`.
 *      Provides per-kind (anonymous / authenticated) granularity that
 *      the bucket alone doesn't surface, and gives a second line of
 *      defense if the bucket arithmetic ever drifts.
 *
 * On throttle, the first failing check decides the response:
 *   - response body `{ code: DDOS_RATE_LIMITED, retryAfterSeconds }`
 *   - `Retry-After` header set on the underlying HTTP response so
 *     well-behaved clients back off without parsing the body.
 *
 * `request.user` may be populated by an upstream signal (mTLS, a
 * reverse-proxy header, a previously-cached session) even though
 * `JwtAuthGuard` runs after this guard in the chain. We honour it
 * when present so a service-to-service call with a known principal
 * gets the higher authenticated quota in the sliding-window check.
 */
@Injectable()
export class DdosGuard implements CanActivate {
  private readonly logger = new Logger(DdosGuard.name);

  constructor(private readonly ddos: DdosProtectionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<DdosRequest>();

    if (this.isExemptPath(request)) {
      return true;
    }

    const ip = extractClientIp(request);
    const kind = request.user?.sub || request.user?.id
      ? 'authenticated'
      : 'anonymous';

    // 1) Token bucket — gates the burst allowance.
    const tokenResult = await this.ddos.consumeToken(ip, { kind });
    if (!tokenResult.allowed) {
      this.applyRetryAfter(http, tokenResult.retryAfterSeconds);
      this.logger.warn({
        message: 'DDoS token bucket exhausted',
        clientIp: ip,
        kind,
        capacity: tokenResult.capacity,
        retryAfterSeconds: tokenResult.retryAfterSeconds,
        method: request.method ?? 'GET',
        path: sanitisePath(request),
      });
      throw new HttpException(
        {
          code: 'DDOS_RATE_LIMITED',
          message: 'Request rate exceeded — please slow down',
          retryAfterSeconds: tokenResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2) Sliding window — per-kind quota.
    const windowResult = await this.ddos.checkAndIncrement(ip, kind);
    if (windowResult.allowed) {
      return true;
    }

    this.applyRetryAfter(http, windowResult.retryAfterSeconds);
    this.logger.warn({
      message: 'DDoS rate limit exceeded',
      clientIp: ip,
      kind,
      observedCount: windowResult.observedCount,
      limit: windowResult.limit,
      retryAfterSeconds: windowResult.retryAfterSeconds,
      method: request.method ?? 'GET',
      path: sanitisePath(request),
    });

    throw new HttpException(
      {
        code: 'DDOS_RATE_LIMITED',
        message: 'Request rate exceeded — please slow down',
        retryAfterSeconds: windowResult.retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private applyRetryAfter(
    http: ReturnType<ExecutionContext['switchToHttp']>,
    retryAfterSeconds: number,
  ): void {
    const response = http.getResponse<DdosResponse>();
    if (response && typeof response.setHeader === 'function') {
      try {
        response.setHeader(
          'Retry-After',
          String(Math.max(1, retryAfterSeconds)),
        );
      } catch {
        /* socket already gone */
      }
    }
  }

  private isExemptPath(req: DdosRequest): boolean {
    const raw = req.originalUrl ?? req.url ?? req.path ?? '';
    if (!raw) return false;
    const path = raw.split('?')[0] ?? '';
    return DDOS_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
  }
}

/**
 * Extract the client IP using the same precedence as the
 * `RateLimitInterceptor` and `WafMiddleware` so the three layers
 * agree on which bucket a request lands in.
 */
function extractClientIp(req: DdosRequest & { connection?: { remoteAddress?: string }; socket?: { remoteAddress?: string } }): string {
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

function sanitisePath(req: DdosRequest): string {
  const raw = req.originalUrl ?? req.url ?? req.path ?? '';
  if (!raw) return '';
  const idx = raw.indexOf('?');
  return idx >= 0 ? raw.slice(0, idx) : raw;
}
