import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import {
  SecureResponseInterceptor,
  SECURE_RESPONSE_HEADERS,
  LIVE_RESPONSE_HEADERS,
} from './secure-response.interceptor';

/**
 * Tests for SecureResponseInterceptor (Task 29.4, Req 30.3 / 30.9).
 *
 * Covers:
 *   - every required security header lands on a normal response
 *   - /live routes get the relaxed Permissions-Policy
 *   - prototype-pollution keys are stripped from outbound JSON
 *   - binary payloads (Buffer, Date) flow through untouched
 *   - non-HTTP contexts (RPC / WS) pass through with no-op headers
 */
describe('SecureResponseInterceptor', () => {
  const interceptor = new SecureResponseInterceptor();

  /**
   * Build an ExecutionContext + spy-friendly response. Returns the
   * setHeader calls so each test can assert on them directly.
   */
  function makeContext(opts: { url?: string } = {}) {
    const setHeader = jest.fn();
    const request = { url: opts.url ?? '/api/v1/admin/specialties' };
    const response = { setHeader };
    return {
      ctx: {
        getType: () => 'http' as const,
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext,
      setHeader,
    };
  }

  function makeHandler<T>(value: T): CallHandler<T> {
    return { handle: () => of(value) } as CallHandler<T>;
  }

  it('sets every required security header on a typical response', async () => {
    const { ctx, setHeader } = makeContext();
    await firstValueFrom(interceptor.intercept(ctx, makeHandler({ ok: true })));

    for (const [name, value] of Object.entries(SECURE_RESPONSE_HEADERS)) {
      expect(setHeader).toHaveBeenCalledWith(name, value);
    }
  });

  it('relaxes Permissions-Policy on /live/* routes', async () => {
    const { ctx, setHeader } = makeContext({ url: '/api/v1/live/sessions/123' });
    await firstValueFrom(interceptor.intercept(ctx, makeHandler({ ok: true })));

    expect(setHeader).toHaveBeenCalledWith(
      'Permissions-Policy',
      LIVE_RESPONSE_HEADERS['Permissions-Policy'],
    );
    // The non-/live default is NOT set — only one Permissions-Policy
    // call should have happened.
    const policyCalls = setHeader.mock.calls.filter(
      (c) => c[0] === 'Permissions-Policy',
    );
    expect(policyCalls).toHaveLength(1);
  });

  it('strips __proto__ / constructor / prototype keys from JSON responses', async () => {
    const polluted = JSON.parse(
      '{"name":"ok","__proto__":{"polluted":true},"items":[{"prototype":1,"safe":2}]}',
    );
    const { ctx } = makeContext();
    const result = await firstValueFrom(
      interceptor.intercept(ctx, makeHandler(polluted)),
    );

    expect(result).toEqual({ name: 'ok', items: [{ safe: 2 }] });
  });

  it('passes Buffer / Date / typed-array bodies through untouched', async () => {
    const buf = Buffer.from([1, 2, 3]);
    const date = new Date('2024-01-01T00:00:00Z');
    const { ctx } = makeContext();

    const bufResult = await firstValueFrom(
      interceptor.intercept(ctx, makeHandler(buf)),
    );
    const dateResult = await firstValueFrom(
      interceptor.intercept(ctx, makeHandler(date)),
    );

    expect(bufResult).toBe(buf);
    expect(dateResult).toBe(date);
  });

  it('passes null / undefined / primitive responses through', async () => {
    const { ctx } = makeContext();
    expect(
      await firstValueFrom(interceptor.intercept(ctx, makeHandler(null))),
    ).toBeNull();
    expect(
      await firstValueFrom(interceptor.intercept(ctx, makeHandler(undefined))),
    ).toBeUndefined();
    expect(
      await firstValueFrom(interceptor.intercept(ctx, makeHandler('hello'))),
    ).toBe('hello');
    expect(
      await firstValueFrom(interceptor.intercept(ctx, makeHandler(42))),
    ).toBe(42);
  });

  it('is a no-op on non-HTTP contexts (rpc / ws)', async () => {
    const handler = makeHandler({ greeting: 'hi' });
    const ctx = {
      getType: () => 'rpc' as const,
      switchToHttp: () => {
        throw new Error('should not be called for non-http');
      },
    } as unknown as ExecutionContext;

    const result = await firstValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toEqual({ greeting: 'hi' });
  });

  it('tolerates response objects that do not implement setHeader', async () => {
    const ctx = {
      getType: () => 'http' as const,
      switchToHttp: () => ({
        getRequest: () => ({ url: '/x' }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeHandler({ ok: true }))),
    ).resolves.toEqual({ ok: true });
  });

  it('does NOT match /livestream or other paths starting with /live but not matching the segment', async () => {
    const { ctx, setHeader } = makeContext({ url: '/api/v1/livestream/xyz' });
    await firstValueFrom(interceptor.intercept(ctx, makeHandler({ ok: true })));
    expect(setHeader).toHaveBeenCalledWith(
      'Permissions-Policy',
      SECURE_RESPONSE_HEADERS['Permissions-Policy'],
    );
  });
});
