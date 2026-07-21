import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import {
  HTTP_CACHE_METADATA,
  HttpCache,
  HttpCacheInterceptor,
  buildCacheControlHeader,
} from './http-cache.interceptor';

/**
 * `HttpCacheInterceptor` unit tests — Task 24.2.
 *
 * Coverage:
 *   - `buildCacheControlHeader` formats the directive correctly with /
 *     without `stale-while-revalidate`.
 *   - `@HttpCache(...)` attaches metadata under the documented key.
 *   - The interceptor writes `Cache-Control` only on `GET` requests
 *     when the route is decorated.
 *   - An explicit `Cache-Control` set by the handler is preserved.
 */
describe('HttpCacheInterceptor', () => {
  let interceptor: HttpCacheInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new HttpCacheInterceptor(reflector);
  });

  function buildContext(opts: {
    method: string;
    metadata?: unknown;
    existingHeader?: string;
    onSetHeader?: jest.Mock;
  }): ExecutionContext {
    const setHeader = opts.onSetHeader ?? jest.fn();
    const handler = function () {};
    const cls = class {};
    if (opts.metadata !== undefined) {
      Reflect.defineMetadata(HTTP_CACHE_METADATA, opts.metadata, handler);
    }
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({ method: opts.method }),
        getResponse: () => ({
          setHeader,
          getHeader: (n: string) =>
            n === 'Cache-Control' ? opts.existingHeader : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  // ==================================================================
  // buildCacheControlHeader
  // ==================================================================

  describe('buildCacheControlHeader', () => {
    it('emits public, max-age and stale-while-revalidate in order', () => {
      expect(
        buildCacheControlHeader({ maxAge: 60, staleWhileRevalidate: 300 }),
      ).toBe('public, max-age=60, stale-while-revalidate=300');
    });

    it('omits stale-while-revalidate when 0 / undefined', () => {
      expect(buildCacheControlHeader({ maxAge: 30 })).toBe(
        'public, max-age=30',
      );
      expect(
        buildCacheControlHeader({ maxAge: 30, staleWhileRevalidate: 0 }),
      ).toBe('public, max-age=30');
    });

    it('honours private scope', () => {
      expect(
        buildCacheControlHeader({ maxAge: 30, scope: 'private' }),
      ).toBe('private, max-age=30');
    });

    it('clamps negative max-age to 0', () => {
      expect(buildCacheControlHeader({ maxAge: -10 })).toBe(
        'public, max-age=0',
      );
    });
  });

  // ==================================================================
  // Decorator metadata
  // ==================================================================

  describe('@HttpCache decorator', () => {
    it('attaches metadata under HTTP_CACHE_METADATA', () => {
      class Sample {
        @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
        handler() {}
      }
      const meta = Reflect.getMetadata(
        HTTP_CACHE_METADATA,
        Sample.prototype.handler,
      );
      expect(meta).toEqual({ maxAge: 60, staleWhileRevalidate: 300 });
    });
  });

  // ==================================================================
  // Interception behaviour
  // ==================================================================

  describe('intercept', () => {
    const handler = { handle: () => of('payload') };

    it('writes Cache-Control on GET routes with @HttpCache metadata', async () => {
      const setHeader = jest.fn();
      const ctx = buildContext({
        method: 'GET',
        metadata: { maxAge: 60, staleWhileRevalidate: 300 },
        onSetHeader: setHeader,
      });
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(result).toBe('payload');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=60, stale-while-revalidate=300',
      );
    });

    it('skips the header when no @HttpCache metadata is present', async () => {
      const setHeader = jest.fn();
      const ctx = buildContext({ method: 'GET', onSetHeader: setHeader });
      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('skips the header on non-GET requests even when metadata exists', async () => {
      const setHeader = jest.fn();
      const ctx = buildContext({
        method: 'POST',
        metadata: { maxAge: 60 },
        onSetHeader: setHeader,
      });
      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('does not overwrite a Cache-Control header set by the handler', async () => {
      const setHeader = jest.fn();
      const ctx = buildContext({
        method: 'GET',
        metadata: { maxAge: 60 },
        existingHeader: 'no-store',
        onSetHeader: setHeader,
      });
      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
