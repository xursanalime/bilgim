import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Reflector key used by the {@link HttpCache} decorator to attach
 * cache-policy metadata to a route handler. Kept as a plain string so
 * tests can inspect the metadata without needing the decorator
 * itself.
 */
export const HTTP_CACHE_METADATA = 'edubridge:http-cache';

export interface HttpCacheOptions {
  /** `Cache-Control` `max-age` directive (seconds). */
  maxAge: number;
  /** Optional `stale-while-revalidate` directive (seconds). */
  staleWhileRevalidate?: number;
  /**
   * Cache scope. Defaults to `public` because the discovery endpoints
   * are unauthenticated; routes that vary by user MUST set
   * `scope: 'private'`.
   */
  scope?: 'public' | 'private';
}

/**
 * `@HttpCache({ maxAge, staleWhileRevalidate })` — opt-in cache-control
 * decorator for idempotent GET endpoints. Used by the discovery feed
 * and the public course listing today; can be added to any other
 * read-only route once it has been audited as safe to cache.
 *
 * The decorator only attaches metadata — the actual `Cache-Control`
 * header is written by `HttpCacheInterceptor`, which is registered
 * globally so the decorator works on any controller.
 */
export const HttpCache = (options: HttpCacheOptions): MethodDecorator =>
  SetMetadata(HTTP_CACHE_METADATA, options);

/**
 * Build the `Cache-Control` header value from the decorator metadata.
 * Exposed for tests so we don't have to round-trip through Nest.
 */
export function buildCacheControlHeader(options: HttpCacheOptions): string {
  const parts: string[] = [];
  parts.push(options.scope ?? 'public');
  parts.push(`max-age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (
    options.staleWhileRevalidate !== undefined &&
    options.staleWhileRevalidate > 0
  ) {
    parts.push(
      `stale-while-revalidate=${Math.floor(options.staleWhileRevalidate)}`,
    );
  }
  return parts.join(', ');
}

/**
 * `HttpCacheInterceptor` writes the `Cache-Control` header on routes
 * decorated with `@HttpCache(...)`. It only runs for `GET` requests —
 * adding cache headers to mutating verbs would be unsafe — and skips
 * the response when an upstream handler already set its own
 * `Cache-Control`, so a route with a custom policy can still
 * override the decorator default.
 *
 * Wired globally from `AppModule` via `APP_INTERCEPTOR`.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<HttpCacheOptions>(
      HTTP_CACHE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!options) {
      return next.handle();
    }

    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest<{ method?: string }>();
    const response = httpCtx.getResponse<{
      setHeader?: (name: string, value: string) => void;
      getHeader?: (name: string) => string | string[] | number | undefined;
    }>();

    if (request?.method && request.method.toUpperCase() !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        if (!response?.setHeader) return;
        const existing = response.getHeader?.('Cache-Control');
        if (existing) return; // honor an explicit override from the handler
        response.setHeader(
          'Cache-Control',
          buildCacheControlHeader(options),
        );
      }),
    );
  }
}
