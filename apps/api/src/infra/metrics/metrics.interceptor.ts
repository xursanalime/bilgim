import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { MetricsService } from './metrics.service';

/**
 * MetricsInterceptor — observes one
 * `http_request_duration_seconds{method,route,status_code}` sample
 * per HTTP request (Task 24.3, Req 26.2 RED metrics).
 *
 * Wired globally via `APP_INTERCEPTOR` in `MetricsModule` so every
 * controller route is recorded — including the `/metrics` scrape
 * itself, which is fine: Prometheus scrape latency is part of the
 * service's RED budget.
 *
 * Route resolution: NestJS attaches the resolved express route to
 * `request.route.path` after routing. We prefer that over `request.url`
 * because the latter contains the path params (e.g. `/lessons/abc-123`)
 * which would explode label cardinality. When the route can't be
 * resolved (404, before-routing errors) we fall back to `unmatched`,
 * normalised in `MetricsService.observeHttpRequest`.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const start = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const observe = (statusCode: number) => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      const seconds = elapsedNs / 1e9;
      const method = (request?.method as string) ?? 'UNKNOWN';
      const route = resolveRouteLabel(request);
      this.metrics.observeHttpRequest(method, route, statusCode, seconds);
    };

    return next.handle().pipe(
      tap({
        next: () => observe(response.statusCode ?? 200),
        error: (error: { status?: number; getStatus?: () => number }) => {
          // Status may be on the exception (HttpException.getStatus)
          // or on the in-flight response. Default to 500 so unhandled
          // throws still show up under the right bucket.
          const status =
            typeof error?.getStatus === 'function'
              ? error.getStatus()
              : (error?.status ?? response?.statusCode ?? 500);
          observe(status);
        },
      }),
    );
  }
}

function resolveRouteLabel(request: {
  route?: { path?: string };
  baseUrl?: string;
  url?: string;
}): string {
  const routePath = request?.route?.path;
  if (routePath) {
    const base = request?.baseUrl ?? '';
    return `${base}${routePath}` || routePath;
  }
  // Fallback — strip query string and obvious id-shaped segments so
  // unmatched requests don't explode cardinality.
  const url = request?.url ?? '';
  const noQuery = url.split('?')[0] ?? '';
  return noQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id') || 'unmatched';
}
