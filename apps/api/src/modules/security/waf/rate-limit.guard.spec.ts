import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import { SecurityRateLimitGuard } from './rate-limit.guard';

/**
 * Unit tests for `SecurityRateLimitGuard` (Task 27.1, Req 27.2).
 *
 * Coverage matches the task body:
 *   - allows requests under capacity
 *   - rejects with 429 RATE_LIMIT_EXCEEDED when the bucket is empty
 *   - per-IP bucket independent of per-user bucket
 *   - per-user bucket only evaluated when authenticated
 *   - sets the `Retry-After` header
 *   - fails open on Redis error (returns true)
 *   - skips /health and /metrics
 */

// ---------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

/**
 * In-memory fake of the subset of ioredis used by the guard
 * (`hmget`, `hmset`, `expire`). The fake also lets the test
 * fast-forward its internal clock so we can assert that lazy refill
 * arithmetic works without actually waiting wall-clock seconds.
 */
function makeFakeRedis(opts: { errorMode?: boolean } = {}) {
  type Hash = Record<string, string>;
  const hashes = new Map<string, { data: Hash; expiresAt: number | null }>();
  let now = 1_000_000;

  const isAlive = (entry: { expiresAt: number | null }) =>
    entry.expiresAt === null || entry.expiresAt > now;

  const errorIfNeeded = () => {
    if (opts.errorMode) throw new Error('redis: connection refused');
  };

  const client: any = {
    hmget: jest.fn(async (key: string, ...fields: string[]) => {
      errorIfNeeded();
      const entry = hashes.get(key);
      if (!entry || !isAlive(entry)) return fields.map(() => null);
      return fields.map((f) => entry.data[f] ?? null);
    }),
    hmset: jest.fn(async (key: string, data: Hash) => {
      errorIfNeeded();
      const existing = hashes.get(key);
      const merged: Hash = {
        ...(existing && isAlive(existing) ? existing.data : {}),
        ...data,
      };
      hashes.set(key, {
        data: merged,
        expiresAt: existing && isAlive(existing) ? existing.expiresAt : null,
      });
      return 'OK';
    }),
    expire: jest.fn(async (key: string, ttlSeconds: number) => {
      errorIfNeeded();
      const entry = hashes.get(key);
      if (!entry) return 0;
      entry.expiresAt = now + ttlSeconds * 1000;
      return 1;
    }),
  };

  const service: any = {
    getClient: () => client,
  };

  return {
    redis: service as unknown as RedisService,
    client,
    hashes,
    setNow: (t: number) => {
      now = t;
    },
    advanceMs: (delta: number) => {
      now += delta;
    },
    nowMs: () => now,
  };
}

interface FakeRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
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

// Tighter capacity for fast tests — the production defaults
// (1000 / 300) are validated separately in the "defaults" describe.
const TEST_ENV = {
  SECURITY_RATE_LIMIT_IP: 5,
  SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: 60,
  SECURITY_RATE_LIMIT_USER: 3,
  SECURITY_RATE_LIMIT_USER_WINDOW_SECONDS: 60,
};

// ---------------------------------------------------------------------
// Skip behaviour
// ---------------------------------------------------------------------

describe('SecurityRateLimitGuard — skip behaviour', () => {
  it('skips /health regardless of how often it is hit', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig({
      SECURITY_RATE_LIMIT_IP: 1,
      SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: 60,
    }));
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip: '203.0.113.50',
        method: 'GET',
        url: '/health',
        originalUrl: '/health',
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    // Bucket never touched.
    expect(fake.client.hmget).not.toHaveBeenCalled();
  });

  it('skips /metrics regardless of how often it is hit', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig({
      SECURITY_RATE_LIMIT_IP: 1,
      SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: 60,
    }));
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip: '203.0.113.51',
        method: 'GET',
        url: '/metrics',
        originalUrl: '/metrics',
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    expect(fake.client.hmget).not.toHaveBeenCalled();
  });

  it('skips the prefixed /api/v1/health path', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig({
      SECURITY_RATE_LIMIT_IP: 1,
      SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: 60,
    }));
    const ctx = makeCtx({
      ip: '203.0.113.52',
      method: 'GET',
      url: '/api/v1/health/db',
      originalUrl: '/api/v1/health/db',
      headers: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(fake.client.hmget).not.toHaveBeenCalled();
  });

  it('skips non-HTTP execution contexts (e.g. WebSocket/RPC)', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig({}));
    const wsCtx = {
      getType: () => 'ws',
      switchToHttp: () => {
        throw new Error('not http');
      },
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(wsCtx)).resolves.toBe(true);
    expect(fake.client.hmget).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// Per-IP bucket
// ---------------------------------------------------------------------

describe('SecurityRateLimitGuard — per-IP bucket', () => {
  it('allows requests under the per-IP capacity', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip: '203.0.113.10',
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it('rejects with 429 RATE_LIMIT_EXCEEDED when the per-IP bucket is empty', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    const ip = '203.0.113.20';

    // Drain the 5-token bucket. Note that the guard pins time via
    // Date.now(); we don't tick the fake clock between calls, so the
    // refill term is 0 and each call costs exactly one token.
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }

    // The 6th request should be rejected with the right envelope.
    const responseHeaders: Record<string, string> = {};
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
      tier: string;
      retryAfterSeconds: number;
    };
    expect(envelope.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(envelope.tier).toBe('IP');
    expect(envelope.retryAfterSeconds).toBeGreaterThan(0);
    // Retry-After header surfaced.
    expect(responseHeaders['Retry-After']).toBeDefined();
    expect(Number(responseHeaders['Retry-After'])).toBeGreaterThan(0);
  });

  it('treats two distinct IPs as independent buckets', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));

    // IP A burns its quota.
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip: '203.0.113.30',
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    // IP B should still pass — buckets are keyed by IP.
    const ctxB = makeCtx({
      ip: '203.0.113.31',
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: {},
    });
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);
  });

  it('ignores a spoofed X-Forwarded-For and buckets on req.ip', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));

    // A caller sending a DIFFERENT X-Forwarded-For on every request used
    // to mint a fresh bucket each time and never hit the limit. `req.ip`
    // is what Express resolved under `trust proxy`, so it is the only
    // value that cannot be forged — the header must not override it.
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx({
        ip: '10.0.0.1',
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: { 'x-forwarded-for': `198.51.100.${i}, 10.0.0.1` },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    const ctxBlocked = makeCtx({
      ip: '10.0.0.1',
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: { 'x-forwarded-for': '198.51.100.99, 10.0.0.1' },
    });
    await expectTooMany(guard.canActivate(ctxBlocked));

    // One bucket, keyed on the resolved peer address — not one bucket per
    // spoofed header value.
    const keys = Array.from(fake.hashes.keys());
    expect(keys).toContain('rl:tb:ip:10.0.0.1');
    expect(keys).not.toContain('rl:tb:ip:198.51.100.99');
  });

  it('falls back to X-Forwarded-For only when no peer address is available', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));

    const ctx = makeCtx({
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(Array.from(fake.hashes.keys())).toContain('rl:tb:ip:203.0.113.7');
  });
});

// ---------------------------------------------------------------------
// Per-user bucket
// ---------------------------------------------------------------------

describe('SecurityRateLimitGuard — per-user bucket', () => {
  it('does not evaluate the per-user bucket on anonymous requests', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    const ctx = makeCtx({
      ip: '203.0.113.40',
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // Only the IP bucket key is touched.
    const keys = Array.from(fake.hashes.keys());
    expect(keys).toContain('rl:tb:ip:203.0.113.40');
    expect(keys.find((k) => k.startsWith('rl:tb:user:'))).toBeUndefined();
  });

  it('evaluates the per-user bucket on authenticated requests', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    const ctx = makeCtx({
      ip: '203.0.113.41',
      method: 'GET',
      url: '/api/v1/me',
      originalUrl: '/api/v1/me',
      headers: {},
      user: { sub: 'user-1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const keys = Array.from(fake.hashes.keys());
    expect(keys).toContain('rl:tb:ip:203.0.113.41');
    expect(keys).toContain('rl:tb:user:user-1');
  });

  it('user bucket is independent of IP bucket — exhausting user does not affect IP', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    const userId = 'user-2';
    const ipA = '203.0.113.42';

    // 3 hits → user bucket empty (capacity = 3 in TEST_ENV).
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx({
        ip: ipA,
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        user: { sub: userId },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    // 4th hit on the same user → user bucket exhausted, even though
    // the IP bucket still has 5 - 3 = 2 tokens left.
    const responseHeaders: Record<string, string> = {};
    const ctxBlocked = makeCtx(
      {
        ip: ipA,
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        user: { sub: userId },
      },
      responseHeaders,
    );
    const err = await expectTooMany(guard.canActivate(ctxBlocked));
    const envelope = err.getResponse() as {
      code: string;
      tier: string;
    };
    expect(envelope.tier).toBe('USER');
    expect(responseHeaders['Retry-After']).toBeDefined();
  });

  it('different authenticated users on the same IP are independent', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig({
      ...TEST_ENV,
      SECURITY_RATE_LIMIT_IP: 100, // generous IP cap so user is the gate
    }));
    const ip = '203.0.113.43';

    // User A drains its 3-token bucket.
    for (let i = 0; i < 3; i++) {
      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        user: { sub: 'user-a' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    // User B (same IP) still has full bucket.
    const ctxB = makeCtx({
      ip,
      method: 'GET',
      url: '/api/v1/me',
      originalUrl: '/api/v1/me',
      headers: {},
      user: { sub: 'user-b' },
    });
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);
  });

  it('falls back to request.user.id when sub is not set', async () => {
    const fake = makeFakeRedis();
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    const ctx = makeCtx({
      ip: '203.0.113.44',
      method: 'GET',
      url: '/api/v1/me',
      originalUrl: '/api/v1/me',
      headers: {},
      user: { id: 'fallback-id' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(Array.from(fake.hashes.keys())).toContain(
      'rl:tb:user:fallback-id',
    );
  });
});

// ---------------------------------------------------------------------
// Fail-open
// ---------------------------------------------------------------------

describe('SecurityRateLimitGuard — fail-open on Redis error', () => {
  it('returns true when Redis throws — never locks every IP out', async () => {
    const fake = makeFakeRedis({ errorMode: true });
    const guard = new SecurityRateLimitGuard(fake.redis, makeConfig(TEST_ENV));
    for (let i = 0; i < 50; i++) {
      const ctx = makeCtx({
        ip: '203.0.113.60',
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      // Even on errorMode every call is allowed.
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it('returns true when Redis is not injected at all', async () => {
    const guard = new SecurityRateLimitGuard(undefined, makeConfig(TEST_ENV));
    const ctx = makeCtx({
      ip: '203.0.113.61',
      method: 'GET',
      url: '/api/v1/courses',
      originalUrl: '/api/v1/courses',
      headers: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------
// Defaults — match Req 27.2 wording
// ---------------------------------------------------------------------

describe('SecurityRateLimitGuard — Req 27.2 defaults', () => {
  it('defaults to 1000 IP / 300 user with 60-second windows', () => {
    const guard = new SecurityRateLimitGuard(undefined, makeConfig({}));
    expect(guard.ipLimit).toBe(1000);
    expect(guard.userLimit).toBe(300);
    expect(guard.ipWindowSeconds).toBe(60);
    expect(guard.userWindowSeconds).toBe(60);
  });

  it('honours overrides supplied via env', () => {
    const guard = new SecurityRateLimitGuard(
      undefined,
      makeConfig({
        SECURITY_RATE_LIMIT_IP: 2500,
        SECURITY_RATE_LIMIT_USER: 750,
        SECURITY_RATE_LIMIT_IP_WINDOW_SECONDS: 30,
        SECURITY_RATE_LIMIT_USER_WINDOW_SECONDS: 90,
      }),
    );
    expect(guard.ipLimit).toBe(2500);
    expect(guard.userLimit).toBe(750);
    expect(guard.ipWindowSeconds).toBe(30);
    expect(guard.userWindowSeconds).toBe(90);
  });

  it('falls back to defaults when env values are non-positive', () => {
    const guard = new SecurityRateLimitGuard(
      undefined,
      makeConfig({
        SECURITY_RATE_LIMIT_IP: 0,
        SECURITY_RATE_LIMIT_USER: -1,
      }),
    );
    expect(guard.ipLimit).toBe(1000);
    expect(guard.userLimit).toBe(300);
  });
});
