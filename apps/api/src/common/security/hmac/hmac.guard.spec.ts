import {
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { HmacGuard, HMAC_NONCE_TTL_SECONDS } from './hmac.guard';
import { HmacSignatureService } from './hmac-signature.service';
import {
  RequireHmac,
  REQUIRE_HMAC_KEY,
} from './require-hmac.decorator';

/**
 * Tests for `HmacGuard` (Task 29.4, Req 30.1).
 *
 * Covers:
 *   - happy path: every header present + valid signature → true
 *   - missing X-Signature / X-Timestamp / X-Nonce → 401 SIGNATURE_REQUIRED
 *   - timestamp outside ±5 min → 401 SIGNATURE_EXPIRED
 *   - nonce already in Redis → 401 NONCE_REUSED
 *   - tampered signature → 401 INVALID_SIGNATURE
 *   - secret missing in env → 401 SIGNATURE_MISCONFIGURED
 *   - decorator absent → guard passes through
 */
describe('HmacGuard', () => {
  const SECRET = 'admin-shared-secret-with-enough-entropy';
  const reflector = new Reflector();
  const hmacService = new HmacSignatureService();

  /** In-memory Redis double — only the methods the guard actually calls. */
  function makeRedis() {
    const store = new Map<string, { value: string; ttl: number }>();
    return {
      store,
      setnx: jest
        .fn(async (key: string, value: string, ttl: number) => {
          if (store.has(key)) return false;
          store.set(key, { value, ttl });
          return true;
        }),
    } as any;
  }

  /** Build a ConfigService that returns SECRET for HMAC_ADMIN_SECRET. */
  function makeConfig(secret = SECRET) {
    return {
      get: (key: string) =>
        key === 'HMAC_ADMIN_SECRET' ? secret : undefined,
    } as any;
  }

  /**
   * Build an ExecutionContext that resolves `@RequireHmac()` from the
   * options passed in, plus the headers / body the test wants.
   */
  function makeContext(opts: {
    decorator?: ReturnType<typeof RequireHmac>;
    headers?: Record<string, string>;
    body?: unknown;
    method?: string;
    url?: string;
  }) {
    // The decorator returns a fresh function — store its metadata on a
    // synthetic class so the reflector can read it back the same way
    // it would in a real Nest pipeline.
    class FakeController {}
    if (opts.decorator) {
      opts.decorator(FakeController);
    }
    function fakeHandler() {}

    const request = {
      method: opts.method ?? 'POST',
      url: opts.url ?? '/admin/specialties',
      headers: opts.headers ?? {},
      body: opts.body ?? { name: 'Maths' },
    };

    return {
      getType: () => 'http' as const,
      getHandler: () => fakeHandler,
      getClass: () => FakeController,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  /**
   * Compose the canonical signed payload exactly the way the guard
   * does: `${ts}.${nonce}.${JSON.stringify(body)}`.
   */
  function sign(
    body: unknown,
    timestamp: number,
    nonce: string,
    secret = SECRET,
  ): string {
    const buf = body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(body), 'utf8');
    const composed = Buffer.concat([
      Buffer.from(`${timestamp}.${nonce}.`, 'utf8'),
      buf,
    ]);
    return hmacService.sign(composed, secret);
  }

  it('passes through when @RequireHmac is not set on the route', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('happy path: valid signature + fresh nonce + recent timestamp', async () => {
    const redis = makeRedis();
    const guard = new HmacGuard(reflector, hmacService, redis, makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const body = { name: 'Maths' };
    const nonce = 'nonce-1';
    const ctx = makeContext({
      decorator: RequireHmac(),
      body,
      headers: {
        'x-signature': sign(body, ts, nonce),
        'x-timestamp': `${ts}`,
        'x-nonce': nonce,
      },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.setnx).toHaveBeenCalledWith(
      `hmac:nonce:HMAC_ADMIN_SECRET:${nonce}`,
      `${ts}`,
      HMAC_NONCE_TTL_SECONDS,
    );
  });

  it('rejects with SIGNATURE_REQUIRED when X-Signature is missing', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      headers: { 'x-timestamp': `${ts}`, 'x-nonce': 'n1' },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_REQUIRED',
    });
  });

  it('rejects with SIGNATURE_REQUIRED when X-Timestamp is missing', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ctx = makeContext({
      decorator: RequireHmac(),
      headers: { 'x-signature': 'AAAA', 'x-nonce': 'n1' },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_REQUIRED',
    });
  });

  it('rejects with SIGNATURE_REQUIRED when X-Nonce is missing', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      headers: { 'x-signature': 'AAAA', 'x-timestamp': `${ts}` },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_REQUIRED',
    });
  });

  it('rejects with SIGNATURE_EXPIRED when timestamp is too old', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const body = { foo: 'bar' };
    const nonce = 'old';
    const ctx = makeContext({
      decorator: RequireHmac(),
      body,
      headers: {
        'x-signature': sign(body, ts, nonce),
        'x-timestamp': `${ts}`,
        'x-nonce': nonce,
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_EXPIRED',
    });
  });

  it('rejects with SIGNATURE_EXPIRED when timestamp is too far in the future', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now
    const body = { foo: 'bar' };
    const nonce = 'fwd';
    const ctx = makeContext({
      decorator: RequireHmac(),
      body,
      headers: {
        'x-signature': sign(body, ts, nonce),
        'x-timestamp': `${ts}`,
        'x-nonce': nonce,
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_EXPIRED',
    });
  });

  it('rejects INVALID_SIGNATURE when timestamp is non-numeric', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ctx = makeContext({
      decorator: RequireHmac(),
      headers: {
        'x-signature': 'AAAA',
        'x-timestamp': 'not-a-number',
        'x-nonce': 'n1',
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects INVALID_SIGNATURE when nonce is too long', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      headers: {
        'x-signature': 'AAAA',
        'x-timestamp': `${ts}`,
        'x-nonce': 'n'.repeat(129),
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects with NONCE_REUSED on the second sighting of the same nonce', async () => {
    const redis = makeRedis();
    const guard = new HmacGuard(reflector, hmacService, redis, makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const body = { foo: 'bar' };
    const nonce = 'reused-nonce';

    const headers = {
      'x-signature': sign(body, ts, nonce),
      'x-timestamp': `${ts}`,
      'x-nonce': nonce,
    };
    const first = makeContext({ decorator: RequireHmac(), body, headers });
    await expect(guard.canActivate(first)).resolves.toBe(true);

    // Second request with the same nonce — even with a fresh signature
    // (well: same payload + same nonce → same sig) — must be rejected.
    const second = makeContext({ decorator: RequireHmac(), body, headers });
    await expectRejection(guard.canActivate(second), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'NONCE_REUSED',
    });
  });

  it('rejects with INVALID_SIGNATURE when the body is tampered', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const honestBody = { name: 'Maths' };
    const tamperedBody = { name: 'Physics' };
    const nonce = 'tamper-1';
    const ctx = makeContext({
      decorator: RequireHmac(),
      body: tamperedBody,
      headers: {
        'x-signature': sign(honestBody, ts, nonce),
        'x-timestamp': `${ts}`,
        'x-nonce': nonce,
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects with INVALID_SIGNATURE when the signature is gibberish', async () => {
    const guard = new HmacGuard(reflector, hmacService, makeRedis(), makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      body: { foo: 'bar' },
      headers: {
        'x-signature': '!!!not-base64!!!',
        'x-timestamp': `${ts}`,
        'x-nonce': 'n1',
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects with SIGNATURE_MISCONFIGURED when the secret is missing in config', async () => {
    const guard = new HmacGuard(
      reflector,
      hmacService,
      makeRedis(),
      makeConfig(undefined),
    );
    delete process.env.HMAC_ADMIN_SECRET;

    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      body: { foo: 'bar' },
      headers: {
        'x-signature': 'AAAA',
        'x-timestamp': `${ts}`,
        'x-nonce': 'n1',
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'SIGNATURE_MISCONFIGURED',
    });
  });

  it('respects per-route secretEnvKey override', async () => {
    const guard = new HmacGuard(
      reflector,
      hmacService,
      makeRedis(),
      {
        get: (key: string) =>
          key === 'PAYME_HMAC_SECRET' ? 'payme-secret' : undefined,
      } as any,
    );
    const ts = Math.floor(Date.now() / 1000);
    const body = { method: 'CheckPerformTransaction' };
    const nonce = 'p1';
    const ctx = makeContext({
      decorator: RequireHmac({ secretEnvKey: 'PAYME_HMAC_SECRET' }),
      body,
      headers: {
        'x-signature': sign(body, ts, nonce, 'payme-secret'),
        'x-timestamp': `${ts}`,
        'x-nonce': nonce,
      },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('does not consume a nonce slot when the signature is bogus', async () => {
    // Defence-in-depth: a forged signature attempt must NOT exhaust
    // the nonce namespace. Reservation happens only after the
    // signature matches.
    const redis = makeRedis();
    const guard = new HmacGuard(reflector, hmacService, redis, makeConfig());
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeContext({
      decorator: RequireHmac(),
      body: { foo: 'bar' },
      headers: {
        'x-signature': 'A'.repeat(44), // valid base64 length, wrong digest
        'x-timestamp': `${ts}`,
        'x-nonce': 'will-not-be-burned',
      },
    });

    await expectRejection(guard.canActivate(ctx), {
      status: HttpStatus.UNAUTHORIZED,
      code: 'INVALID_SIGNATURE',
    });
    expect(redis.setnx).not.toHaveBeenCalled();
  });
});

/**
 * Helper: assert that a Promise rejects with an HttpException whose body
 * contains the expected `code`.
 */
async function expectRejection(
  promise: Promise<unknown>,
  expected: { status: number; code: string },
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await promise.catch((err: HttpException) => {
    expect(err.getStatus()).toBe(expected.status);
    const body = err.getResponse() as { code?: string };
    expect(body.code).toBe(expected.code);
  });
}

// Suppress eslint "Reflector unused" if reflector path changes in future.
void REQUIRE_HMAC_KEY;
