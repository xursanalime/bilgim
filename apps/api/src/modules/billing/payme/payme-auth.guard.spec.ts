import { ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymeAuthGuard } from './payme-auth.guard';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';

/**
 * PaymeAuthGuard unit tests (Requirements 4.3, 21.7, 21.9).
 *
 * Verifies:
 *   - Valid Basic Auth → guard returns true.
 *   - Wrong key, missing header, malformed header → throws PaymeError(-32504).
 *   - PAYME_TEST_KEY is accepted in addition to PAYME_KEY.
 *   - IP allowlist is enforced when configured (and skipped when empty).
 *   - Failures emit a structured WARN log entry for the security audit.
 */
describe('PaymeAuthGuard', () => {
  const PROD_KEY = 'prod-key-xyz';
  const TEST_KEY = 'test-key-abc';
  let guard: PaymeAuthGuard;
  let config: jest.Mocked<ConfigService>;
  let warnSpy: jest.SpyInstance;

  function makeContext(req: {
    headers?: Record<string, unknown>;
    ip?: string;
    ips?: string[];
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as ExecutionContext;
  }

  function buildBasicAuth(login: string, key: string): string {
    return 'Basic ' + Buffer.from(`${login}:${key}`).toString('base64');
  }

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'PAYME_KEY':
            return PROD_KEY;
          case 'PAYME_TEST_KEY':
            return TEST_KEY;
          case 'PAYME_LOGIN':
            return 'Paycom';
          case 'PAYME_IP_ALLOWLIST':
            return undefined;
          default:
            return undefined;
        }
      }),
    } as any;

    guard = new PaymeAuthGuard(config);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ------------------------------------------------------------------
  // Happy paths
  // ------------------------------------------------------------------

  it('allows a request with a valid Paycom:PAYME_KEY Basic Auth header', () => {
    const ctx = makeContext({
      headers: { authorization: buildBasicAuth('Paycom', PROD_KEY) },
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('also accepts PAYME_TEST_KEY (sandbox flow)', () => {
    const ctx = makeContext({
      headers: { authorization: buildBasicAuth('Paycom', TEST_KEY) },
      ip: '127.0.0.1',
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  // ------------------------------------------------------------------
  // Failure paths — every one must throw -32504 and audit-log
  // ------------------------------------------------------------------

  it('throws -32504 when the Authorization header is missing', () => {
    const ctx = makeContext({ headers: {}, ip: '127.0.0.1' });

    try {
      guard.canActivate(ctx);
      fail('expected PaymeError');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymeError);
      expect((err as PaymeError).code).toBe(
        PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE,
      );
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payme.webhook.auth_failed',
        reason: 'missing_authorization_header',
        ip: '127.0.0.1',
      }),
    );
  });

  it('throws -32504 when the scheme is not Basic', () => {
    const ctx = makeContext({
      headers: { authorization: 'Bearer some-jwt' },
      ip: '127.0.0.1',
    });

    expect(() => guard.canActivate(ctx)).toThrow(PaymeError);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unsupported_auth_scheme' }),
    );
  });

  it('throws -32504 when the credentials are malformed (no colon)', () => {
    // base64("nocolonhere") — decodes to a string with no `:` separator
    const ctx = makeContext({
      headers: {
        authorization: 'Basic ' + Buffer.from('nocolonhere').toString('base64'),
      },
      ip: '127.0.0.1',
    });

    expect(() => guard.canActivate(ctx)).toThrow(PaymeError);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'malformed_credentials' }),
    );
  });

  it('throws -32504 when the login is wrong', () => {
    const ctx = makeContext({
      headers: { authorization: buildBasicAuth('NotPaycom', PROD_KEY) },
      ip: '127.0.0.1',
    });

    expect(() => guard.canActivate(ctx)).toThrow(PaymeError);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'login_mismatch',
        presentedLogin: 'NotPaycom',
      }),
    );
  });

  it('throws -32504 when the key is wrong', () => {
    const ctx = makeContext({
      headers: { authorization: buildBasicAuth('Paycom', 'wrong-key') },
      ip: '127.0.0.1',
    });

    expect(() => guard.canActivate(ctx)).toThrow(PaymeError);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'key_mismatch',
        presentedLogin: 'Paycom',
      }),
    );
  });

  it('throws -32504 when both keys are unconfigured (treats any key as wrong)', () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'PAYME_LOGIN') return 'Paycom';
      return undefined;
    });

    const ctx = makeContext({
      headers: { authorization: buildBasicAuth('Paycom', 'anything') },
      ip: '127.0.0.1',
    });

    expect(() => guard.canActivate(ctx)).toThrow(PaymeError);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'key_mismatch' }),
    );
  });

  // ------------------------------------------------------------------
  // IP allowlist (Req 21.7)
  // ------------------------------------------------------------------

  describe('IP allowlist', () => {
    function configureAllowlist(value: string | undefined) {
      config.get.mockImplementation((key: string) => {
        switch (key) {
          case 'PAYME_KEY':
            return PROD_KEY;
          case 'PAYME_LOGIN':
            return 'Paycom';
          case 'PAYME_IP_ALLOWLIST':
            return value;
          default:
            return undefined;
        }
      });
    }

    it('allows any IP when allowlist is empty', () => {
      configureAllowlist('');

      const ctx = makeContext({
        headers: { authorization: buildBasicAuth('Paycom', PROD_KEY) },
        ip: '8.8.8.8',
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows an IP in the allowlist', () => {
      configureAllowlist('185.178.45.0,185.178.45.1');

      const ctx = makeContext({
        headers: { authorization: buildBasicAuth('Paycom', PROD_KEY) },
        ip: '185.178.45.1',
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects an IP outside the allowlist (before checking auth)', () => {
      configureAllowlist('185.178.45.0');

      const ctx = makeContext({
        headers: { authorization: buildBasicAuth('Paycom', PROD_KEY) },
        ip: '8.8.8.8',
      });

      try {
        guard.canActivate(ctx);
        fail('expected PaymeError');
      } catch (err) {
        expect((err as PaymeError).code).toBe(
          PAYME_ERROR_CODES.AUTH_INSUFFICIENT_PRIVILEGE,
        );
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'ip_not_allowed',
          ip: '8.8.8.8',
        }),
      );
    });

    it('checks request.ips (proxy chain) in addition to request.ip', () => {
      configureAllowlist('185.178.45.0');

      const ctx = makeContext({
        headers: { authorization: buildBasicAuth('Paycom', PROD_KEY) },
        ip: '10.0.0.1',
        ips: ['185.178.45.0', '10.0.0.1'],
      });

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
