import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { IdempotencyInterceptor } from './idempotency.interceptor';

interface FakeRequest {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  user?: { sub?: string; id?: string };
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  setHeader: jest.Mock;
  status: jest.Mock;
}

const VALID_KEY = '11111111-2222-3333-4444-555555555555';

function makeContext(
  request: FakeRequest,
  response: FakeResponse,
  type: 'http' | 'rpc' = 'http',
): ExecutionContext {
  return {
    getType: () => type as any,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

function makeResponse(statusCode = 201): FakeResponse {
  return {
    statusCode,
    headers: {},
    setHeader: jest.fn().mockImplementation(function (
      this: FakeResponse,
      name: string,
      value: string,
    ) {
      this.headers[name] = value;
    }),
    status: jest.fn().mockImplementation(function (
      this: FakeResponse,
      code: number,
    ) {
      this.statusCode = code;
      return this;
    }),
  };
}

function makeNext(handler: () => any): CallHandler {
  return { handle: () => handler() } as CallHandler;
}

describe('IdempotencyInterceptor', () => {
  let redis: { store: Map<string, string>; get: jest.Mock; set: jest.Mock };
  let prisma: any;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    const store = new Map<string, string>();
    redis = {
      store,
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
    prisma = {
      idempotencyRecord: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    interceptor = new IdempotencyInterceptor(redis as any, prisma as any);
  });

  it('skips interception when no Idempotency-Key header is present (Req 19 — opt-in)', async () => {
    const request: FakeRequest = {
      method: 'POST',
      url: '/api/v1/users',
      headers: {},
      body: { name: 'a' },
    };
    const response = makeResponse();
    const next = makeNext(() => of({ ok: true }));

    const result$ = await interceptor.intercept(
      makeContext(request, response),
      next,
    );

    await expect(lastValueFrom(result$ as any)).resolves.toEqual({ ok: true });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('skips interception on GET requests (Req 19 — only mutations)', async () => {
    const request: FakeRequest = {
      method: 'GET',
      url: '/api/v1/users',
      headers: { 'idempotency-key': VALID_KEY },
    };
    const response = makeResponse();
    const next = makeNext(() => of({ list: [] }));

    const result$ = await interceptor.intercept(
      makeContext(request, response),
      next,
    );

    await expect(lastValueFrom(result$ as any)).resolves.toEqual({ list: [] });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('rejects malformed idempotency keys with 400 INVALID_IDEMPOTENCY_KEY', async () => {
    const request: FakeRequest = {
      method: 'POST',
      url: '/api/v1/users',
      headers: { 'idempotency-key': 'short' },
      body: {},
    };
    const response = makeResponse();
    const next = makeNext(() => of({}));

    expect(() =>
      interceptor.intercept(makeContext(request, response), next),
    ).toThrow(BadRequestException);
  });

  it('caches the response on first request and returns it on the second (Req 19.1)', async () => {
    const handler = jest.fn(() => of({ created: true, id: 'abc' }));
    const request: FakeRequest = {
      method: 'POST',
      url: '/api/v1/payments',
      originalUrl: '/api/v1/payments',
      headers: { 'idempotency-key': VALID_KEY },
      body: { amount: 100 },
      user: { sub: 'user-1' },
    };
    const response = makeResponse(201);

    const first$ = await interceptor.intercept(
      makeContext(request, response),
      makeNext(handler),
    );
    await lastValueFrom(first$ as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyRecord.upsert).toHaveBeenCalledTimes(1);
    expect(response.headers['X-Idempotency-Key-Status']).toBe('miss');

    // Second request with the SAME key + payload → cache hit.
    const response2 = makeResponse(200);
    const handler2 = jest.fn(() => of({ should: 'not run' }));
    const second$ = await interceptor.intercept(
      makeContext(
        {
          ...request,
          // header object differs — same body content though
          headers: { 'idempotency-key': VALID_KEY },
        },
        response2,
      ),
      makeNext(handler2),
    );

    await expect(lastValueFrom(second$ as any)).resolves.toEqual({
      created: true,
      id: 'abc',
    });
    expect(handler2).not.toHaveBeenCalled();
    expect(response2.headers['X-Idempotency-Key-Status']).toBe('hit');
    expect(response2.status).toHaveBeenCalledWith(201);
  });

  it('returns 409 IDEMPOTENCY_CONFLICT when the same key arrives with a different payload (Req 19.2)', async () => {
    const handler = jest.fn(() => of({ created: true }));
    const baseRequest: FakeRequest = {
      method: 'POST',
      url: '/api/v1/payments',
      originalUrl: '/api/v1/payments',
      headers: { 'idempotency-key': VALID_KEY },
      body: { amount: 100 },
      user: { sub: 'user-1' },
    };

    const first$ = await interceptor.intercept(
      makeContext(baseRequest, makeResponse()),
      makeNext(handler),
    );
    await lastValueFrom(first$ as any);

    const conflict$ = await interceptor.intercept(
      makeContext(
        { ...baseRequest, body: { amount: 999 } },
        makeResponse(),
      ),
      makeNext(handler),
    );

    await expect(lastValueFrom(conflict$ as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('persists with a 24h TTL and writes an IdempotencyRecord row (Req 19.3, 18.6)', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const request: FakeRequest = {
      method: 'POST',
      url: '/api/v1/users',
      originalUrl: '/api/v1/users',
      headers: { 'idempotency-key': VALID_KEY },
      body: { foo: 'bar' },
      user: { sub: 'user-1' },
    };

    const result$ = await interceptor.intercept(
      makeContext(request, makeResponse()),
      makeNext(handler),
    );
    await lastValueFrom(result$ as any);

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^idempotency:POST:\/api\/v1\/users:user-1:/),
      expect.any(String),
      24 * 60 * 60,
    );

    const upsertArgs = prisma.idempotencyRecord.upsert.mock.calls[0][0];
    // Composite key encodes (userId, method+path, idempotencyKey).
    expect(upsertArgs.where.key).toContain(VALID_KEY);
    expect(upsertArgs.where.key).toContain('user-1');
    expect(upsertArgs.where.key).toContain('POST /api/v1/users');
    expect(upsertArgs.create.scope).toBe('POST /api/v1/users');
    expect(upsertArgs.create.userId).toBe('user-1');

    const expiresAt: Date = upsertArgs.create.expiresAt;
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 3600 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(24 * 3600 * 1000 + 1000);
  });

  it('does not cache the response when the handler throws (let client retry)', async () => {
    const request: FakeRequest = {
      method: 'POST',
      url: '/api/v1/payments',
      originalUrl: '/api/v1/payments',
      headers: { 'idempotency-key': VALID_KEY },
      body: { amount: 100 },
      user: { sub: 'user-1' },
    };
    const response = makeResponse();
    const failing = makeNext(() =>
      throwError(() => new Error('upstream timed out')),
    );

    const result$ = await interceptor.intercept(
      makeContext(request, response),
      failing,
    );

    await expect(lastValueFrom(result$ as any)).rejects.toThrow(
      'upstream timed out',
    );
    expect(redis.set).not.toHaveBeenCalled();
    expect(prisma.idempotencyRecord.upsert).not.toHaveBeenCalled();
  });

  it('produces the same payload hash regardless of JSON key ordering', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const headers = { 'idempotency-key': VALID_KEY };
    const user = { sub: 'user-1' };

    const first$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/users',
          originalUrl: '/api/v1/users',
          headers,
          body: { a: 1, b: 2 },
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(first$ as any);

    const second$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/users',
          originalUrl: '/api/v1/users',
          headers,
          body: { b: 2, a: 1 }, // re-ordered
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );

    // Should be a cache hit (same content, different key order) — handler runs once total.
    await lastValueFrom(second$ as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes through when context type is not http', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const ctx = makeContext(
      {
        method: 'POST',
        url: '/x',
        headers: { 'idempotency-key': VALID_KEY },
        body: {},
      },
      makeResponse(),
      'rpc',
    );

    const result$ = await interceptor.intercept(ctx, makeNext(handler));
    await expect(lastValueFrom(result$ as any)).resolves.toEqual({ ok: true });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('scopes by user — same key from a different user re-runs the handler', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const baseRequest = {
      method: 'POST',
      url: '/api/v1/payments',
      originalUrl: '/api/v1/payments',
      headers: { 'idempotency-key': VALID_KEY },
      body: { amount: 100 },
    } as const;

    const u1$ = await interceptor.intercept(
      makeContext(
        { ...baseRequest, user: { sub: 'user-1' } },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(u1$ as any);

    const u2$ = await interceptor.intercept(
      makeContext(
        { ...baseRequest, user: { sub: 'user-2' } },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(u2$ as any);

    // Independent users → independent idempotency scopes.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('scopes by route — same key from same user on a different path re-runs the handler', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const headers = { 'idempotency-key': VALID_KEY };
    const user = { sub: 'user-1' };

    const r1$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/payments',
          originalUrl: '/api/v1/payments',
          headers,
          body: { amount: 100 },
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(r1$ as any);

    const r2$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/enrollments',
          originalUrl: '/api/v1/enrollments',
          headers,
          body: { amount: 100 },
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(r2$ as any);

    // Same key on different routes → independent scopes (matches design's
    // "scope = POST /enrollment/checkout" guidance).
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('treats query-string differences as the same scope (route-only)', async () => {
    const handler = jest.fn(() => of({ ok: true }));
    const headers = { 'idempotency-key': VALID_KEY };
    const user = { sub: 'user-1' };

    const a$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/payments?retry=1',
          originalUrl: '/api/v1/payments?retry=1',
          headers,
          body: { amount: 100 },
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(a$ as any);

    const b$ = await interceptor.intercept(
      makeContext(
        {
          method: 'POST',
          url: '/api/v1/payments?retry=2',
          originalUrl: '/api/v1/payments?retry=2',
          headers,
          body: { amount: 100 },
          user,
        },
        makeResponse(),
      ),
      makeNext(handler),
    );
    await lastValueFrom(b$ as any);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cleanupExpired() removes idempotency rows past their expiresAt window', async () => {
    prisma.idempotencyRecord.deleteMany.mockResolvedValueOnce({ count: 7 });

    const removed = await interceptor.cleanupExpired(new Date('2025-01-02'));

    expect(removed).toBe(7);
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date('2025-01-02') } },
    });
  });

  it('cleanupExpired() returns 0 when prisma is unavailable', async () => {
    const noPrisma = new IdempotencyInterceptor(redis as any, undefined);
    await expect(noPrisma.cleanupExpired()).resolves.toBe(0);
  });
});
