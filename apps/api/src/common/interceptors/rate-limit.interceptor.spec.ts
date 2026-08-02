import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { RateLimitInterceptor } from './rate-limit.interceptor';

interface FakeRequest {
  ip?: string;
  headers?: Record<string, string | undefined>;
  user?: { sub?: string };
}

function makeCtx(
  request: FakeRequest,
  response: { setHeader: jest.Mock },
  className = 'TestController',
  handlerName = 'testHandler',
): ExecutionContext {
  const handler = function () {} as any;
  Object.defineProperty(handler, 'name', { value: handlerName });
  const cls = class {} as any;
  Object.defineProperty(cls, 'name', { value: className });
  return {
    getType: () => 'http' as any,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => handler,
    getClass: () => cls,
  } as any;
}

function makeNext(): CallHandler {
  return { handle: () => of('ok') };
}

/**
 * Build a fake RedisService whose `getClient()` returns an ioredis-like
 * pipeline supporting INCR/EXPIRE/TTL with an in-memory counter store.
 */
function makeFakeRedis() {
  const counters = new Map<string, { count: number; ttl: number }>();

  const pipeline = (key: string) => {
    const ops: Array<() => any> = [];
    const api = {
      incr: () => {
        ops.push(() => {
          const existing = counters.get(key);
          const next = (existing?.count ?? 0) + 1;
          counters.set(key, {
            count: next,
            ttl: existing?.ttl ?? -1,
          });
          return next;
        });
        return api;
      },
      expire: (k: string, ttlSeconds: number, _flag?: string) => {
        ops.push(() => {
          const cur = counters.get(k);
          if (!cur) return 0;
          // emulate NX: only set ttl if not yet set
          if (cur.ttl === -1) {
            counters.set(k, { ...cur, ttl: ttlSeconds });
            return 1;
          }
          return 0;
        });
        return api;
      },
      ttl: (k: string) => {
        ops.push(() => counters.get(k)?.ttl ?? -2);
        return api;
      },
      exec: async () => ops.map((fn) => [null, fn()]),
    };
    return api;
  };

  const client = {
    multi: () => {
      let activeKey: string | undefined;
      const queue: Array<() => any> = [];
      const api: any = {
        incr: (k: string) => {
          activeKey = k;
          queue.push(() => {
            const existing = counters.get(k);
            const next = (existing?.count ?? 0) + 1;
            counters.set(k, {
              count: next,
              ttl: existing?.ttl ?? -1,
            });
            return next;
          });
          return api;
        },
        expire: (k: string, ttlSeconds: number) => {
          queue.push(() => {
            const cur = counters.get(k);
            if (!cur) return 0;
            if (cur.ttl === -1) {
              counters.set(k, { ...cur, ttl: ttlSeconds });
              return 1;
            }
            return 0;
          });
          return api;
        },
        ttl: (k: string) => {
          queue.push(() => counters.get(k)?.ttl ?? -2);
          return api;
        },
        exec: async () => queue.map((fn) => [null, fn()]),
      };
      return api;
    },
    expire: async (k: string, ttlSeconds: number) => {
      const cur = counters.get(k);
      if (cur) counters.set(k, { ...cur, ttl: ttlSeconds });
      return 1;
    },
  };

  return {
    counters,
    redis: {
      getClient: () => client,
    },
  };
}

describe('RateLimitInterceptor', () => {
  let reflector: Reflector;
  let response: { setHeader: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    response = { setHeader: jest.fn() };
  });

  it('passes through when no Redis is wired (degraded mode)', async () => {
    const interceptor = new RateLimitInterceptor(reflector);
    const ctx = makeCtx({ ip: '1.1.1.1' }, response);
    const result$ = (await interceptor.intercept(ctx, makeNext())) as any;
    await expect(lastValueFrom(result$)).resolves.toBe('ok');
  });

  it('counts each request in the per-IP bucket and 429s once over the limit', async () => {
    const fake = makeFakeRedis();
    const tinyLimits = {
      perIp: { limit: 2, windowSeconds: 60 } as RateLimitOptions,
      perUser: { limit: 10, windowSeconds: 60 } as RateLimitOptions,
    };
    const interceptor = new RateLimitInterceptor(
      reflector,
      fake.redis as any,
      tinyLimits,
    );

    const ctx = () => makeCtx({ ip: '8.8.8.8' }, response);

    // First two requests pass.
    await lastValueFrom((await interceptor.intercept(ctx(), makeNext())) as any);
    await lastValueFrom((await interceptor.intercept(ctx(), makeNext())) as any);

    // Third exceeds limit (count=3 > 2).
    const blocked$ = (await interceptor.intercept(ctx(), makeNext())) as any;
    await expect(lastValueFrom(blocked$)).rejects.toBeInstanceOf(HttpException);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^\d+$/),
    );
  });

  it('uses both per-IP and per-user buckets for authenticated requests', async () => {
    const fake = makeFakeRedis();
    const limits = {
      perIp: { limit: 100, windowSeconds: 60 } as RateLimitOptions,
      perUser: { limit: 1, windowSeconds: 60 } as RateLimitOptions,
    };
    const interceptor = new RateLimitInterceptor(
      reflector,
      fake.redis as any,
      limits,
    );

    const ctx = () =>
      makeCtx({ ip: '1.1.1.1', user: { sub: 'user-1' } }, response);

    // First request: per-user count = 1, within limit
    await lastValueFrom((await interceptor.intercept(ctx(), makeNext())) as any);
    // Second request: per-user count = 2 → exceeds (limit=1)
    const blocked$ = (await interceptor.intercept(ctx(), makeNext())) as any;
    await expect(lastValueFrom(blocked$)).rejects.toBeInstanceOf(HttpException);

    // Sanity: at least one user-specific bucket key was created
    const userKeys = [...fake.counters.keys()].filter((k) =>
      k.startsWith('ratelimit:user:'),
    );
    expect(userKeys.length).toBeGreaterThan(0);
  });

  it('@RateLimit decorator overrides the global default for that route', async () => {
    const fake = makeFakeRedis();
    const interceptor = new RateLimitInterceptor(
      reflector,
      fake.redis as any,
      {
        perIp: { limit: 1000, windowSeconds: 60 },
        perUser: { limit: 1000, windowSeconds: 60 },
      },
    );

    const ctx = makeCtx({ ip: '5.5.5.5' }, response);
    const override: RateLimitOptions = { limit: 1, windowSeconds: 30 };
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: any) =>
        key === RATE_LIMIT_KEY ? override : undefined,
      );

    // Override allows only 1 request per 30s.
    await lastValueFrom((await interceptor.intercept(ctx, makeNext())) as any);

    const blocked$ = (await interceptor.intercept(ctx, makeNext())) as any;
    await expect(lastValueFrom(blocked$)).rejects.toBeInstanceOf(HttpException);
  });

  it('fails open when Redis throws (does not block traffic)', async () => {
    const brokenRedis = {
      getClient: () => ({
        multi: () => ({
          incr: () => {
            throw new Error('redis is down');
          },
          expire: () => {},
          ttl: () => {},
          exec: async () => [],
        }),
      }),
    };
    const interceptor = new RateLimitInterceptor(
      reflector,
      brokenRedis as any,
      {
        perIp: { limit: 1, windowSeconds: 60 },
        perUser: { limit: 1, windowSeconds: 60 },
      },
    );

    const ctx = makeCtx({ ip: '1.1.1.1' }, response);
    const result$ = (await interceptor.intercept(ctx, makeNext())) as any;
    await expect(lastValueFrom(result$)).resolves.toBe('ok');
  });
});
