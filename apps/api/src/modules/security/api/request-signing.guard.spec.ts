import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import fc from 'fast-check';

import {
  RequestSigningGuard,
  REQUIRE_REQUEST_SIGNING_KEY,
} from './request-signing.guard';

/**
 * Unit tests for `RequestSigningGuard` (Task 29.4, Req 30.1).
 *
 * Covers:
 *   - Valid signature accepted
 *   - Tampered body rejected
 *   - Missing signature headers rejected
 *   - Expired timestamp rejected
 *   - Non-decorated routes pass through
 */

const TEST_SECRET = 'test-hmac-secret-key-for-unit-tests';

/** Helper: generate a valid HMAC-SHA256 signature for a request. */
function signRequest(opts: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: unknown;
  secret?: string;
}): string {
  const { method, path: rawPath, timestamp, nonce, body, secret = TEST_SECRET } = opts;
  const idx = rawPath.indexOf('?');
  const path = idx >= 0 ? rawPath.slice(0, idx) : rawPath;
  
  const bodyStr =
    body === null || body === undefined
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const signingString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(signingString).digest('hex');
}

/** Helper: create a mock ExecutionContext. */
function makeContext(
  request: Record<string, unknown>,
  requiresSigning = true,
): ExecutionContext {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiresSigning);

  const ctx = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
    }),
  } as unknown as ExecutionContext;

  return ctx;
}

function createGuard(secret = TEST_SECRET): {
  guard: RequestSigningGuard;
  reflector: Reflector;
} {
  const reflector = new Reflector();
  const config = {
    get: (key: string) => (key === 'REQUEST_SIGNING_SECRET' ? secret : undefined),
  };
  const guard = new RequestSigningGuard(
    reflector,
    config as any,
  );
  return { guard, reflector };
}

// ─────────────────────────────────────────────────────────────────────

describe('RequestSigningGuard', () => {
  it('Property 26: correctly verifies signature for any method/path/body', () => {
    const { guard, reflector } = createGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    fc.assert(
      fc.property(
        fc.constantFrom('GET', 'POST', 'PUT', 'DELETE'),
        fc.string({ minLength: 1 }),
        fc.dictionary(fc.string(), fc.anything()),
        (method, path, body) => {
          const timestamp = Math.floor(Date.now() / 1000);
          const nonce = crypto.randomUUID();
          const signature = signRequest({ method, path, timestamp, nonce, body });

          const request = {
            method,
            originalUrl: path,
            body,
            headers: {
              'x-signature': signature,
              'x-timestamp': String(timestamp),
              'x-nonce': nonce,
            },
          };

          const ctx = {
            getType: () => 'http',
            getHandler: () => ({}),
            getClass: () => ({}),
            switchToHttp: () => ({
              getRequest: <T>() => request as unknown as T,
            }),
          } as unknown as ExecutionContext;

          (guard as any).reflector = reflector;
          expect(guard.canActivate(ctx)).toBe(true);
        },
      ),
    );
  });

  describe('valid signature accepted', () => {
    it('allows request with correct HMAC-SHA256 signature', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'unique-nonce-123';
      const body = { amount: 50000, groupId: 'grp-1' };
      const method = 'POST';
      const path = '/api/v1/billing/checkout';

      const signature = signRequest({ method, path, timestamp, nonce, body });

      const request = {
        method,
        originalUrl: path,
        body,
        headers: {
          'x-signature': signature,
          'x-timestamp': String(timestamp),
          'x-nonce': nonce,
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      // Patch the reflector inside the guard
      (guard as any).reflector = reflector;

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows request with empty body', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'nonce-empty-body';
      const method = 'GET';
      const path = '/api/v1/admin/users';

      const signature = signRequest({
        method,
        path,
        timestamp,
        nonce,
        body: null,
      });

      const request = {
        method,
        originalUrl: path,
        body: null,
        headers: {
          'x-signature': signature,
          'x-timestamp': String(timestamp),
          'x-nonce': nonce,
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('tampered request rejected', () => {
    it('rejects when body has been tampered with', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'nonce-tampered';
      const method = 'POST';
      const path = '/api/v1/billing/checkout';
      const originalBody = { amount: 50000 };
      const tamperedBody = { amount: 99999 };

      // Sign with original body
      const signature = signRequest({
        method,
        path,
        timestamp,
        nonce,
        body: originalBody,
      });

      // Send with tampered body
      const request = {
        method,
        originalUrl: path,
        body: tamperedBody,
        headers: {
          'x-signature': signature,
          'x-timestamp': String(timestamp),
          'x-nonce': nonce,
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_INVALID',
        });
      }
    });

    it('rejects when signature is completely wrong', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = 'nonce-wrong-sig';
      const method = 'POST';
      const path = '/api/v1/enrollment/approve';

      const request = {
        method,
        originalUrl: path,
        body: { requestId: 'req-1' },
        headers: {
          'x-signature': 'deadbeef0000000000000000000000000000000000000000000000000000dead',
          'x-timestamp': String(timestamp),
          'x-nonce': nonce,
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    });
  });

  describe('missing headers rejected', () => {
    it('rejects when x-signature header is missing', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const request = {
        method: 'POST',
        originalUrl: '/api/v1/billing/checkout',
        body: {},
        headers: {
          'x-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-nonce': 'nonce-1',
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_MISSING',
        });
      }
    });

    it('rejects when x-timestamp header is missing', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const request = {
        method: 'POST',
        originalUrl: '/api/v1/billing/checkout',
        body: {},
        headers: {
          'x-signature': 'some-sig',
          'x-nonce': 'nonce-1',
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_MISSING',
        });
      }
    });

    it('rejects when x-nonce header is missing', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const request = {
        method: 'POST',
        originalUrl: '/api/v1/billing/checkout',
        body: {},
        headers: {
          'x-signature': 'some-sig',
          'x-timestamp': String(Math.floor(Date.now() / 1000)),
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_MISSING',
        });
      }
    });
  });

  describe('expired timestamp rejected', () => {
    it('rejects when timestamp is older than 5 minutes', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      // 10 minutes ago
      const timestamp = Math.floor(Date.now() / 1000) - 600;
      const nonce = 'nonce-expired';
      const method = 'POST';
      const path = '/api/v1/billing/checkout';
      const body = { amount: 50000 };

      const signature = signRequest({ method, path, timestamp, nonce, body });

      const request = {
        method,
        originalUrl: path,
        body,
        headers: {
          'x-signature': signature,
          'x-timestamp': String(timestamp),
          'x-nonce': nonce,
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_EXPIRED',
        });
      }
    });

    it('rejects when timestamp is non-numeric', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const request = {
        method: 'POST',
        originalUrl: '/api/v1/admin/action',
        body: {},
        headers: {
          'x-signature': 'some-sig',
          'x-timestamp': 'not-a-number',
          'x-nonce': 'nonce-1',
        },
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(() => guard.canActivate(ctx)).toThrow(HttpException);
      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect((e as HttpException).getResponse()).toMatchObject({
          code: 'SIGNATURE_INVALID_TIMESTAMP',
        });
      }
    });
  });

  describe('non-decorated routes pass through', () => {
    it('allows request when route is not decorated with @RequireRequestSigning', () => {
      const { guard, reflector } = createGuard();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const request = {
        method: 'GET',
        originalUrl: '/api/v1/catalog/courses',
        body: null,
        headers: {},
      };

      const ctx = {
        getType: () => 'http',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: <T>() => request as unknown as T,
        }),
      } as unknown as ExecutionContext;

      (guard as any).reflector = reflector;

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows non-http context types', () => {
      const { guard } = createGuard();

      const ctx = {
        getType: () => 'rpc',
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => {
          throw new Error('should not be called');
        },
      } as unknown as ExecutionContext;

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
