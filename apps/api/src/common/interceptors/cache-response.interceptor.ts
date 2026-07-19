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
 * Reflector key used by the {@link CacheResponse} decorator to attach
 * server-side cache metadata to a route handler. The interceptor
 * reads this key off the handler at runtime — no decorator metadata
 * is read inside controllers themselves.
 */
export const CACHE_RESPONSE_METADATA = 'edubridge:cache-response';

/**
 * Query-string flag that admins can append to *any* `@CacheResponse`
 * route to bypass the cache for one request — handy when debugging a
 * stale-data complaint without flushing the entire keyspace.
 *
 * The flag is intentionally explicit (`bypass-cache=1`) rather than a
 * boolean so a missing or empty value never accidentally toggles the
 * bypass on.
 */
export const CACHE_BYPASS_QUERY_PARAM = 'bypass-cache';

/**
 * Optional shape of the per-route cache options. Callers can supply
 * either a plain TTL (`@CacheResponse(60)`) or a
 * `(ttl, keyFn)` pair when they need a custom key derivation
 * (`@CacheResponse(60, req => 'discovery:' + req.query.q)`).
 */
export interface CacheResponseOptions {
  ttlSeconds: number;
  keyFn?: (req: CacheableRequest) => string;
}

/**
 * Subset of the Express request shape that the interceptor uses. Kept
 * narrow so route handlers can pass a stub in tests without pulling
 * in `@types/express`.
 */
export interface CacheableRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  query?: Record<string, unknown>;
  user?: { sub?: string; userId?: string; id?: string } | undefined;
}

/**
 * `@CacheResponse(ttl, keyFn?)` — decorator for **idempotent GET**
 * endpoints whose response can be cached server-side in Redis.
 *
 * Default key shape: `${userId ?? 'anon'}:${method}:${url}`. The user
 * is read from `req.user.sub` (matches the JWT payload across the
 * codebase). `keyFn` lets callers tighten the key (e.g. drop a
 * volatile filter from the URL or hash the query string) without
 * giving up the default.
 *
 * Cache-bypass: any request with `?bypass-cache=1` skips the read but
 * STILL stores the freshly computed response, so a debugging admin
 * warming the cache after an invalidation gets the same code path as
 * a regular client.
 *
 * Requirements: 20.1, 20.7 — read-heavy endpoints (lesson list,
 * student dashboard) cache via Redis.
 */
export const CacheResponse = (
  ttlSeconds: number,
  keyFn?: CacheResponseOptions['keyFn'],
): MethodDecorator => {
  const opts: CacheResponseOptions = keyFn
    ? { ttlSeconds, keyFn }
    : { ttlSeconds };
  return SetMetadata(CACHE_RESPONSE_METADATA, opts);
};

/**
 * Default key function — `${userId ?? 'anon'}:${METHOD}:${url}`.
 * Exposed so tests can call it without booting a Nest app and so a
 * caller building a custom `keyFn` can compose it.
 */
export function defaultCacheKey(req: CacheableRequest): string {
  const userId =
    req.user?.sub ?? req.user?.userId ?? req.user?.id ?? 'anon';
  const method = (req.method ?? 'GET').toUpperCase();
  const url = req.originalUrl ?? req.url ?? '';
  return `cache-response:${userId}:${method}:${url}`;
}

/**
 * Returns `true` when the request carries the bypass flag. The flag
 * value can be `1`, `true`, or any case variant — we accept the same
 * loose set the rest of the codebase uses for boolean query params.
 */
export function shouldBypassCache(req: CacheableRequest): boolean {
  const raw = req.query?.[CACHE_BYPASS_QUERY_PARAM];
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
 * Nest interceptor that pairs with {@link CacheResponse}. Wired
 * globally from `AppModule` so any controller can opt in by
 * decorating a handler — there is no per-module setup.
 *
 * Failure model: Redis is treated as a strict optimisation. Any error
 * reading the cache logs a warning and falls through to the handler
 * (the "miss" path). A failure to *write* back is similarly
 * non-fatal. The route still serves a correct response even when
 * Redis is unreachable.
 */
@Injectable()
export class CacheResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheResponseInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly cache?: CacheService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<CacheResponseOptions>(
      CACHE_RESPONSE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!options || !this.cache) {
      return next.handle();
    }

    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<CacheableRequest>();

    // GET-only — caching mutating verbs would lead to subtle bugs.
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      return next.handle();
    }

    const key = (options.keyFn ?? defaultCacheKey)(req);
    const bypass = shouldBypassCache(req);

    if (bypass) {
      // Compute and write back — the bypass flag skips the *read*,
      // not the write. Operators warming the cache after an
      // invalidation get the same code path as a regular client.
      return next.handle().pipe(
        tap((value) => {
          void this.cache!.getOrSet(key, options.ttlSeconds, async () => value);
        }),
      );
    }

    // Cache-aside via `getOrSet`: the fetcher closes over `next.handle()`
    // and is only invoked on a miss.
    const handler$ = next.handle();
    return from(
      this.cache.getOrSet<unknown>(key, options.ttlSeconds, () =>
        firstValueFromObservable(handler$),
      ),
    ).pipe(mergeMap((value) => of(value)));
  }
}

/**
 * Tiny `firstValueFrom` polyfill — we avoid pulling the helper from
 * RxJS because some bundlers strip it. The handler observable always
 * emits a single value (Nest's contract for HTTP handlers), so we
 * don't need to handle the empty-stream case.
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
          reject(new Error('Cache-response handler completed without emitting'));
        }
      },
    });
  });
}
