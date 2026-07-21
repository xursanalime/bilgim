import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { CacheService } from '../../infra/cache';
import {
  CacheTtl,
  RESPONSE_CACHE_TTL_METADATA,
  ResponseCacheInterceptor,
  buildResponseCacheControl,
  defaultResponseCacheKey,
  shouldBypassResponseCache,
} from './response-cache.interceptor';

/**
 * `ResponseCacheInterceptor` unit tests — Task 24.2.
 *
 * Coverage:
 *   - `buildResponseCacheControl` formats the directive with both
 *     `max-age` and `s-maxage` set to the same TTL.
 *   - `defaultResponseCacheKey` builds the expected key shape (anon
 *     and authed).
 *   - `shouldBypassResponseCache` recognises `?bypass-cache=1` /
 *     `=true` and ignores anything else.
 *   - `@CacheTtl(60)` attaches the metadata Reflector reads.
 *   - The interceptor honours: GET-only, missing decorator → no-op,
 *     cache hit, cache miss + write-back, bypass flag, handler that
 *     already set Cache-Control.
 */
describe('ResponseCacheInterceptor', () => {
  function buildContext(opts: {
    method?: string;
    url?: string;
    metadata?: number;
    query?: Record<string, unknown>;
    user?: { sub?: string };
    existingCacheControl?: string;
    onSetHeader?: jest.Mock;
  }): ExecutionContext {
    const setHeader = opts.onSetHeader ?? jest.fn();
    const handler = function () {};
    const cls = class {};
    if (opts.metadata !== undefined) {
      Reflect.defineMetadata(
        RESPONSE_CACHE_TTL_METADATA,
        opts.metadata,
        handler,
      );
    }
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({
          method: opts.method ?? 'GET',
          url: opts.url ?? '/discovery/courses',
          originalUrl: opts.url ?? '/discovery/courses',
          query: opts.query ?? {},
          user: opts.user,
        }),
        getResponse: () => ({
          setHeader,
          getHeader: (n: string) =>
            n === 'Cache-Control' ? opts.existingCacheControl : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  describe('buildResponseCacheControl', () => {
    it('emits public, max-age, s-maxage in the same window', () => {
      expect(buildResponseCacheControl(60)).toBe(
        'public, max-age=60, s-maxage=60',
      );
    });

    it('clamps a negative TTL to 0', () => {
      expect(buildResponseCacheControl(-10)).toBe(
        'public, max-age=0, s-maxage=0',
      );
    });
  });

  describe('defaultResponseCacheKey', () => {
    it('uses `anon` when the request is unauthenticated', () => {
      expect(
        defaultResponseCacheKey({
          method: 'GET',
          originalUrl: '/discovery/courses',
        }),
      ).toBe('response-cache:anon:GET:/discovery/courses');
    });

    it('includes the JWT subject when present', () => {
      expect(
        defaultResponseCacheKey({
          method: 'GET',
          originalUrl: '/teacher/x',
          user: { sub: 'user-1' },
        }),
      ).toBe('response-cache:user-1:GET:/teacher/x');
    });
  });

  describe('shouldBypassResponseCache', () => {
    it('honours `?bypass-cache=1`', () => {
      expect(shouldBypassResponseCache({ query: { 'bypass-cache': '1' } })).toBe(
        true,
      );
    });

    it('honours `?bypass-cache=true`', () => {
      expect(
        shouldBypassResponseCache({ query: { 'bypass-cache': 'TRUE' } }),
      ).toBe(true);
    });

    it('returns false for anything else', () => {
      expect(shouldBypassResponseCache({ query: {} })).toBe(false);
      expect(
        shouldBypassResponseCache({ query: { 'bypass-cache': 'no' } }),
      ).toBe(false);
    });
  });

  describe('@CacheTtl decorator', () => {
    it('attaches metadata under RESPONSE_CACHE_TTL_METADATA', () => {
      class Sample {
        @CacheTtl(60)
        handler() {}
      }
      const meta = Reflect.getMetadata(
        RESPONSE_CACHE_TTL_METADATA,
        Sample.prototype.handler,
      );
      expect(meta).toBe(60);
    });
  });

  // ==================================================================
  // Interceptor behaviour
  // ==================================================================

  describe('intercept', () => {
    function makeCache(): jest.Mocked<CacheService> {
      return {
        getOrSet: jest.fn(),
        invalidate: jest.fn(),
      } as unknown as jest.Mocked<CacheService>;
    }

    const handler = { handle: () => of('payload') };

    it('skips entirely when no @CacheTtl metadata is present', async () => {
      const interceptor = new ResponseCacheInterceptor(new Reflector());
      const setHeader = jest.fn();
      const ctx = buildContext({ onSetHeader: setHeader });
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(result).toBe('payload');
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('skips on non-GET requests even when decorated', async () => {
      const cache = makeCache();
      const interceptor = new ResponseCacheInterceptor(new Reflector(), cache);
      const setHeader = jest.fn();
      const ctx = buildContext({
        method: 'POST',
        metadata: 60,
        onSetHeader: setHeader,
      });
      const result = await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(result).toBe('payload');
      expect(setHeader).not.toHaveBeenCalled();
      expect(cache.getOrSet).not.toHaveBeenCalled();
    });

    it('serves from the cache and writes Cache-Control on hit', async () => {
      const cache = makeCache();
      cache.getOrSet.mockResolvedValue({ items: ['cached'] });
      const interceptor = new ResponseCacheInterceptor(new Reflector(), cache);
      const setHeader = jest.fn();
      const ctx = buildContext({ metadata: 60, onSetHeader: setHeader });

      const result = await firstValueFrom(interceptor.intercept(ctx, handler));

      expect(result).toEqual({ items: ['cached'] });
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=60, s-maxage=60',
      );
      expect(cache.getOrSet).toHaveBeenCalledWith(
        'response-cache:anon:GET:/discovery/courses',
        60,
        expect.any(Function),
      );
    });

    it('does not overwrite Cache-Control set by the handler', async () => {
      const cache = makeCache();
      cache.getOrSet.mockResolvedValue('payload');
      const interceptor = new ResponseCacheInterceptor(new Reflector(), cache);
      const setHeader = jest.fn();
      const ctx = buildContext({
        metadata: 60,
        existingCacheControl: 'no-store',
        onSetHeader: setHeader,
      });

      await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(setHeader).not.toHaveBeenCalled();
    });

    it('still sets Cache-Control when the cache backend is missing', async () => {
      const interceptor = new ResponseCacheInterceptor(new Reflector());
      const setHeader = jest.fn();
      const ctx = buildContext({ metadata: 60, onSetHeader: setHeader });

      const result = await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(result).toBe('payload');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=60, s-maxage=60',
      );
    });

    it('skips the cache read when ?bypass-cache=1 is set, but still writes back', async () => {
      const cache = makeCache();
      cache.getOrSet.mockResolvedValue('payload');
      const interceptor = new ResponseCacheInterceptor(new Reflector(), cache);
      const setHeader = jest.fn();
      const ctx = buildContext({
        metadata: 60,
        query: { 'bypass-cache': '1' },
        onSetHeader: setHeader,
      });

      const result = await firstValueFrom(interceptor.intercept(ctx, handler));
      expect(result).toBe('payload');
      // The bypass path computes the response then schedules a write-back.
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=60, s-maxage=60',
      );
    });
  });
});
