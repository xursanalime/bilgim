import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';

import { CacheService } from '../../infra/cache';

/**
 * Reflector key attached by the {@link CacheTtl} decorator. The
 * interceptor reads this key off both the method and the class, so a
 * controller-level `@CacheTtl(60)` covers every handler unless a
 * specific handler overrides it.
 *
 * Task 24.2 — response caching for the public catalog surfaces.
 */
export const RESPONSE_CACHE_TTL_METADATA = 'bilgim:response-cache-ttl';

/**
 * Query-string flag that lets ops bypass the cache for a single
 * request — useful when an admin needs to see live data after an
 * invalidation while everyone else still gets the cached page.
 *
 * The flag is intentionally explicit (`bypass-cache=1`) so a missing
 * or empty value can never silently flip the bypass on.
 */
export const RESPONSE_CACHE_BYPASS_QUERY_PARAM = 'bypass-cache';

/**
 * Subset of the Express request shape used by the interceptor. Kept
 * narrow so unit tests can pass a plain object instead of pulling in
 * `@types/express`.
 */
export interface CacheableRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  query?: Record<string, unknown>;
  user?: { sub?: string; userId?: string; id?: string } | undefined;
}

/**
 * Subset of the Express response shape used by the interceptor — only
 * the header-writing helpers.
 */
export interface CacheableResponse {
  setHeader?: (name: string, value: string) => void;
  getHeader?: (name: string) => string | string[] | number | undefined;
}

/**
 * `@CacheTtl(60)` — opt-in response caching for **idempotent GET**
 * endpoints whose payload can safely be served from Redis for a short
 * window.
 *
 * Behaviour (Task 24.2):
 *   * Default key shape: `response-cache:${userId ?? 'anon'}:${METHOD}:${url}`.
 *   * `?bypass-cache=1` skips the read but still writes the freshly
 *     computed response back, so warming the cache after an
 *     invalidation lands in the same code path as a regular client.
 *   * Sets `Cache-Control: public, max-age=<ttl>, s-maxage=<ttl>` on
 *     every response (cached or fresh) — both browser and edge cache
 *     hold the entry for the same window.
 *   * Redis is treated as a strict optimisation: any read failure
 *     logs a warning and falls through to the handler.
 *
 * Applied to: `/discovery/courses`, `/discovery/teachers/:slug`,
 * `/teacher/:slug` per the brief.
 */
export const CacheTtl = (ttlSeconds: number): MethodDecorator & ClassDecorator =>
  SetMetadata(RESPONSE_CACHE_TTL_METADATA, ttlSeconds);

/**
 * Default key function — `response-cache:${userId ?? 'anon'}:${METHOD}:${url}`.
 * Exposed so tests can call it without booting a Nest app.
 */
export function defaultResponseCacheKey(req: CacheableRequest): string {
  const userId =
    req.user?.sub ?? req.user?.userId ?? req.user?.id ?? 'anon';
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.originalUrl ?? req.url ?? '';
  return `response-cache:${userId}:${method}:${url}`;
}

/**
 * Build the `Cache-Control` value for a `@CacheTtl` response. Same
 * directive on both `max-age` and `s-maxage` so the browser and any
 * upstream proxy / CDN agree on the freshness window.
 */
export function buildResponseCacheControl(ttlSeconds: number): string {
  const ttl = Math.max(0, Math.floor(ttlSeconds));
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

/**
 * Returns `true` when the request carries the bypass flag. Accepts
 * `1`, `true` (any case) or the boolean `true` so the rest of the
 * codebase's loose query-flag parsing applies here too.
 */
export function shouldBypassResponseCache(req: CacheableRequest): boolean {
  const raw = req.query?.[RESPONSE_CACHE_BYPASS_QUERY_PARAM];
  if (raw === undefined || raw === null) return false;
  if (Array.isArray(raw)) return raw.some((v) => isTruthyFlag(v));
  return isTruthyFlag(raw);
}

function isTruthyFlag(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    return lower === '1' || lower === 'true';
  }
  return false;
}

/**
 * `ResponseCacheInterceptor` pairs with {@link CacheTtl}. Wired
 * globally from `AppModule` so any controller can opt in without
 * per-module setup.
 *
 * Failure model: Redis is a best-effort optimisation. A read failure
 * logs a warning and falls through to the handler; a write failure
 * is similarly non-fatal. The route still serves a correct response
 * even when Redis is unreachable — the response loses the `public,
 * max-age=…` header in that case, which is the safe default.
 */
@Injectable()
export class ResponseCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseCacheInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly cache?: CacheService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const ttlSeconds = this.reflector.getAllAndOverride<number>(
      RESPONSE_CACHE_TTL_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!ttlSeconds || ttlSeconds <= 0) {
      return next.handle();
    }
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<CacheableRequest>();
    const res = httpCtx.getResponse<CacheableResponse>();

    // GET-only — caching mutating verbs would lead to subtle bugs.
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      return next.handle();
    }

    const cacheControl = buildResponseCacheControl(ttlSeconds);
    const writeHeader = () => {
      if (!res?.setHeader) return;
      const existing = res.getHeader?.('Cache-Control');
      if (existing) return; // honour an explicit override from the handler
      res.setHeader('Cache-Control', cacheControl);
    };

    if (!this.cache) {
      // No cache backend — still publish the freshness header so a CDN
      // can keep doing its job in front of the API.
      return next.handle().pipe(tap(writeHeader));
    }

    const key = defaultResponseCacheKey(req);
    const bypass = shouldBypassResponseCache(req);

    if (bypass) {
      // Skip the read; still write the freshly computed response back
      // and emit the freshness header so a warming admin lands in the
      // same code path as a regular client.
      return next.handle().pipe(
        tap((value) => {
          writeHeader();
          void this.cache!.getOrSet(key, ttlSeconds, async () => value);
        }),
      );
    }

    const handler$ = next.handle();
    return from(
      this.cache.getOrSet<unknown>(key, ttlSeconds, () =>
        firstValueFromObservable(handler$),
      ),
    ).pipe(
      tap(writeHeader),
      mergeMap((value) => of(value)),
    );
  }
}

/**
 * Tiny `firstValueFrom` polyfill — we avoid the RxJS helper because
 * some bundlers strip it. The handler observable always emits a single
 * value (Nest's contract for HTTP handlers).
 */
function firstValueFromObservable<T>(obs: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let resolved = false;
    const sub = obs.subscribe({
      next: (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        sub.unsubscribe();
      },
      error: (err) => {
        if (resolved) return;
        resolved = true;
        reject(err);
      },
      complete: () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Response-cache handler completed without emitting'));
        }
      },
    });
  });
}
