import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import { DdosProtectionService } from './ddos-protection.service';
import { DdosGuard } from './ddos.guard';

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function makeFakeRedis() {
  type Entry = { value: string; expiresAt: number | null };
  const store = new Map<string, Entry>();
  let now = 1_000_000;

  const isExpired = (entry: Entry) =>
    entry.expiresAt !== null && entry.expiresAt <= now;
  const compact = () => {
    for (const [k, v] of store) if (isExpired(v)) store.delete(k);
  };

  const fakeService: any = {
    incr: async (key: string) => {
      compact();
      const entry = store.get(key);
      const next = (entry ? Number(entry.value) || 0 : 0) + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    },
    expire: async (key: string, ttlSeconds: number) => {
      const entry = store.get(key);
      if (!entry) return;
      entry.expiresAt = now + ttlSeconds;
    },
    get: async (key: string) => {
      compact();
      return store.get(key)?.value ?? null;
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt =
        typeof ttlSeconds === 'number' ? now + ttlSeconds : null;
      store.set(key, { value, expiresAt });
    },
    del: async (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
    exists: async (key: string) => store.has(key),
    getClient: () => ({
      ttl: async (key: string) => {
        const entry = store.get(key);
        if (!entry) return -2;
        if (entry.expiresAt === null) return -1;
        return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
      },
    }),
  };
  return {
    redis: fakeService as unknown as RedisService,
    store,
    tickSeconds: (sec: number) => {
      now += sec;
    },
  };
}

interface FakeRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { sub?: string; id?: string } | null;
}

function makeCtx(
  request: FakeRequest,
  responseHeaders: Record<string, string> = {},
): ExecutionContext {
  const response = {
    setHeader: (name: string, value: string) => {
      responseHeaders[name] = value;
    },
  };
  return {
    getType: () => 'http' as any,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => function () {} as any,
    getClass: () => class {} as any,
  } as unknown as ExecutionContext;
}

async function expectTooMany(
  promise: Promise<unknown>,
): Promise<HttpException> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const err = caught as HttpException;
  expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  return err;
}

describe('DdosGuard', () => {
  it('lets clean traffic through under the limit', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({ DDOS_RATE_LIMIT_UNAUTH: 5 }),
    );
    const guard = new DdosGuard(service);

    const ctx = makeCtx({
      ip: '203.0.113.10',
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: {},
    });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('blocks with 429 + Retry-After header once the limit is exceeded', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({
        DDOS_RATE_LIMIT_UNAUTH: 2,
        DDOS_WINDOW_SECONDS: 60,
      }),
    );
    const guard = new DdosGuard(service);

    const ip = '203.0.113.20';
    const responseHeaders: Record<string, string> = {};
    for (let i = 0; i < 2; i++) {
      const ctx = makeCtx(
        {
          ip,
          method: 'GET',
          url: '/api/v1/courses',
          originalUrl: '/api/v1/courses',
          headers: {},
        },
        responseHeaders,
      );
      expect(await guard.canActivate(ctx)).toBe(true);
    }

    // The 3rd request crosses the limit and should 429.
    const ctxBlocked = makeCtx(
      {
        ip,
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      },
      responseHeaders,
    );
    const err = await expectTooMany(guard.canActivate(ctxBlocked));
    const envelope = err.getResponse() as {
      code: string;
      retryAfterSeconds: number;
    };
    expect(envelope.code).toBe('DDOS_RATE_LIMITED');
    expect(envelope.retryAfterSeconds).toBeGreaterThan(0);
    expect(responseHeaders['Retry-After']).toBeDefined();
    expect(Number(responseHeaders['Retry-After'])).toBeGreaterThan(0);
  });

  it('uses the higher authenticated quota when request.user is set', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({
        DDOS_RATE_LIMIT_UNAUTH: 1,
        DDOS_RATE_LIMIT_AUTH: 5,
        DDOS_WINDOW_SECONDS: 60,
      }),
    );
    const guard = new DdosGuard(service);

    const ip = '203.0.113.30';
    // 5 authenticated hits all allowed.
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        user: { sub: 'user-123' },
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    }
    // 6th hit blocked.
    const ctxBlocked = makeCtx({
      ip,
      method: 'GET',
      url: '/api/v1/me',
      originalUrl: '/api/v1/me',
      headers: {},
      user: { sub: 'user-123' },
    });
    await expectTooMany(guard.canActivate(ctxBlocked));
  });

  it('skips the health check path even when over quota', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({
        DDOS_RATE_LIMIT_UNAUTH: 1,
        DDOS_WINDOW_SECONDS: 60,
      }),
    );
    const guard = new DdosGuard(service);

    const ip = '203.0.113.40';
    // Burn the quota on a non-health endpoint.
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      // First allowed, then 429s — but we don't care about the
      // exception type here; we just need the bucket to be hot.
      try {
        await guard.canActivate(ctx);
      } catch {
        /* ignore */
      }
    }

    // Health probe MUST go through.
    const ctxHealth = makeCtx({
      ip,
      method: 'GET',
      url: '/health',
      originalUrl: '/health',
      headers: {},
    });
    expect(await guard.canActivate(ctxHealth)).toBe(true);

    const ctxMetrics = makeCtx({
      ip,
      method: 'GET',
      url: '/metrics',
      originalUrl: '/metrics',
      headers: {},
    });
    expect(await guard.canActivate(ctxMetrics)).toBe(true);
  });

  it('extracts the upstream IP from x-forwarded-for', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({
        DDOS_RATE_LIMIT_UNAUTH: 1,
        DDOS_WINDOW_SECONDS: 60,
      }),
    );
    const guard = new DdosGuard(service);

    const ctx1 = makeCtx({
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
    });
    expect(await guard.canActivate(ctx1)).toBe(true);

    const ctx2 = makeCtx({
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
    });
    // Same upstream IP — should be 429.
    await expectTooMany(guard.canActivate(ctx2));
  });

  it('skips non-HTTP execution contexts (e.g. websocket)', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({ DDOS_RATE_LIMIT_UNAUTH: 1 }),
    );
    const guard = new DdosGuard(service);

    const ctx = {
      getType: () => 'ws' as any,
    } as unknown as ExecutionContext;
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('lets allow-listed IPs through unconditionally', async () => {
    const fake = makeFakeRedis();
    const service = new DdosProtectionService(
      fake.redis,
      makeConfig({
        DDOS_RATE_LIMIT_UNAUTH: 1,
        DDOS_IP_WHITELIST: '10.0.0.0/8',
      }),
    );
    const guard = new DdosGuard(service);

    const ip = '10.5.6.7';
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    }
  });
});
