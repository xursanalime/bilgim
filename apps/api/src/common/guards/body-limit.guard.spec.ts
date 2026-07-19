import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { BODY_LIMIT_KEY } from '../decorators/body-limit.decorator';
import { BodyLimit } from '../decorators/body-limit.decorator';
import {
  BodyLimitGuard,
  DEFAULT_BODY_LIMIT_BYTES,
} from './body-limit.guard';

/**
 * Task 24.1 — body-size guard:
 *   - rejects writes whose Content-Length exceeds the platform default
 *   - honours per-route `@BodyLimit()` overrides (tighten + widen)
 *   - skips read-only methods
 */
describe('BodyLimitGuard (Task 24.1)', () => {
  const reflector = new Reflector();

  function makeCtx(
    request: Record<string, unknown>,
    handler: any = () => undefined,
    cls: any = class TestController {},
  ): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => handler,
      getClass: () => cls,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    BodyLimitGuard.withDefaultBytes(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('lets read-only methods through without inspecting Content-Length', () => {
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx({
      method: 'GET',
      headers: { 'content-length': '999999999' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('lets writes through when Content-Length is below the default', () => {
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx({
      method: 'POST',
      headers: { 'content-length': String(64 * 1024) },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects writes that exceed the default platform cap', () => {
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx({
      method: 'POST',
      headers: { 'content-length': String(2 * 1024 * 1024) },
    });

    let caught: HttpException | undefined;
    try {
      guard.canActivate(ctx);
    } catch (err) {
      caught = err as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught!.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect((caught!.getResponse() as any).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('honours a tighter @BodyLimit() override on the handler', () => {
    class LoginCtl {
      @BodyLimit(4 * 1024)
      login() {
        /* noop */
      }
    }
    const guard = new BodyLimitGuard(reflector);
    const handler = LoginCtl.prototype.login;
    const ctx = makeCtx(
      { method: 'POST', headers: { 'content-length': String(64 * 1024) } },
      handler,
      LoginCtl,
    );
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('honours a tighter @BodyLimit() override on the controller class', () => {
    @(BodyLimit(2 * 1024) as ClassDecorator)
    class TightCtl {
      handler() {
        /* noop */
      }
    }
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx(
      { method: 'POST', headers: { 'content-length': '4096' } },
      TightCtl.prototype.handler,
      TightCtl,
    );
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('honours a wider @BodyLimit() override on the handler', () => {
    class WebhookCtl {
      @BodyLimit(4 * 1024 * 1024)
      webhook() {
        /* noop */
      }
    }
    const guard = new BodyLimitGuard(reflector);
    const handler = WebhookCtl.prototype.webhook;
    const ctx = makeCtx(
      {
        method: 'POST',
        headers: { 'content-length': String(2 * 1024 * 1024) },
      },
      handler,
      WebhookCtl,
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects an invalid Content-Length with 400 INVALID_CONTENT_LENGTH', () => {
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx({
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
    });
    let caught: HttpException | undefined;
    try {
      guard.canActivate(ctx);
    } catch (err) {
      caught = err as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught!.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((caught!.getResponse() as any).code).toBe('INVALID_CONTENT_LENGTH');
  });

  it('passes through chunked requests without a Content-Length header', () => {
    const guard = new BodyLimitGuard(reflector);
    const ctx = makeCtx({ method: 'POST', headers: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reads BODY_LIMIT_KEY metadata via @BodyLimit', () => {
    class C {
      @BodyLimit(123)
      h() {
        /* noop */
      }
    }
    const meta = Reflect.getMetadata(BODY_LIMIT_KEY, C.prototype.h);
    expect(meta).toEqual({ bytes: 123 });
  });
});
