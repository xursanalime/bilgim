import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import {
  applyTraceResponseHeaders,
  attachTraceIdToRequest,
} from '../observability';

/**
 * LoggingInterceptor — emits one structured log record per HTTP
 * request and attaches a correlation id (`traceId`) to the request,
 * the response headers (`X-Request-Id` + `X-Trace-Id`) and the
 * authenticated user id when available (Task 24.3, Req 26.1).
 *
 * Output format:
 *   - In production (`NODE_ENV=production` or `LOG_FORMAT=json`)
 *     `StructuredLogger` serialises every record to a single-line
 *     JSON envelope. The fields below are then directly indexable
 *     by Loki — no per-line regex parsing in the pipeline.
 *   - In dev / test the default Nest console output is preserved.
 *
 * The fields written by this interceptor are stable and consumed by
 * the production log pipeline (Loki) — adding new keys is fine, but
 * renaming `traceId`, `requestId`, `method`, `path`, `status`,
 * `durationMs`, or `userId` requires a coordinated dashboard / alert
 * update.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Resolve the correlation id (X-Request-Id, falling back to X-Trace-Id,
    // falling back to a freshly generated UUIDv4) and stamp it onto the
    // request so downstream code (services, BullMQ enqueues) can read it.
    const traceId = attachTraceIdToRequest(request);

    // Echo the trace back to the caller so frontend / Sentry / log
    // correlation can stitch the same call across systems.
    applyTraceResponseHeaders(response, traceId);

    const { method, url, ip } = request;
    const path = request?.route?.path
      ? `${request.baseUrl ?? ''}${request.route.path}`
      : (typeof url === 'string' ? url.split('?')[0] : url);
    const userAgent = request.headers['user-agent'] || '-';
    const startTime = Date.now();

    this.logger.log({
      message: 'Incoming request',
      traceId,
      requestId: traceId,
      method,
      url,
      path,
      ip,
      userAgent,
      userId: this.resolveUserId(request),
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.log({
            message: 'Request completed',
            traceId,
            requestId: traceId,
            method,
            url,
            path,
            status: statusCode,
            statusCode,
            duration,
            durationMs: duration,
            userId: this.resolveUserId(request),
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const status =
            typeof (error as { getStatus?: () => number })?.getStatus ===
            'function'
              ? (error as { getStatus: () => number }).getStatus()
              : ((error as { status?: number })?.status ??
                response?.statusCode ??
                500);

          this.logger.error({
            message: 'Request failed',
            traceId,
            requestId: traceId,
            method,
            url,
            path,
            status,
            error: (error as Error)?.message ?? String(error),
            duration,
            durationMs: duration,
            userId: this.resolveUserId(request),
          });
        },
      }),
    );
  }

  /**
   * Resolve the authenticated user id from the request, when
   * available. Both Passport (`request.user.sub`) and our manual
   * decorator paths (`request.user.id`) are tolerated so the field
   * is populated regardless of the auth strategy in play.
   */
  private resolveUserId(request: {
    user?: { sub?: string; id?: string } | null;
  }): string | null {
    const user = request?.user;
    if (!user) return null;
    return user.sub ?? user.id ?? null;
  }
}
