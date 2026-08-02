import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';

import { HCaptchaService } from './hcaptcha.service';

/**
 * Unit tests for `HCaptchaService` (Task 27.2, Req 27.4).
 *
 * Exercises:
 *   - dev-mode bypass when `HCAPTCHA_SECRET` is unset
 *   - successful round-trip against a stubbed `fetch`
 *   - failure path that surfaces the upstream error codes
 *   - `assertValid` mapping to a 403 CAPTCHA_REQUIRED envelope
 */

function buildConfig(secret: string | undefined): ConfigService {
  const stub = {
    get: jest.fn((key: string) => (key === 'HCAPTCHA_SECRET' ? secret : undefined)),
  };
  return stub as unknown as ConfigService;
}

function buildFetch(
  response: Partial<Response> & {
    json?: () => Promise<unknown>;
    ok?: boolean;
    status?: number;
  },
): typeof fetch {
  return jest.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (async () => ({ success: true })),
  } as unknown as Response) as unknown as typeof fetch;
}

describe('HCaptchaService — dev-mode bypass', () => {
  it('returns success: true and never calls fetch when HCAPTCHA_SECRET is unset', async () => {
    const fetchStub = jest.fn();
    const service = new HCaptchaService(
      buildConfig(undefined),
      fetchStub as unknown as typeof fetch,
    );
    expect(service.isEnabled()).toBe(false);

    const result = await service.verify('whatever-token');
    expect(result.success).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('also bypasses verification when the secret is whitespace-only', async () => {
    const fetchStub = jest.fn();
    const service = new HCaptchaService(
      buildConfig('   '),
      fetchStub as unknown as typeof fetch,
    );
    expect(service.isEnabled()).toBe(false);

    await service.verify('whatever');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('HCaptchaService — verify (enabled)', () => {
  it('POSTs to the siteverify URL with secret + response + remoteip', async () => {
    const fetchStub = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, hostname: 'edubridge.uz' }),
    });
    const service = new HCaptchaService(
      buildConfig('hcap-secret'),
      fetchStub as unknown as typeof fetch,
    );

    const result = await service.verify('user-token', '203.0.113.7');
    expect(result.success).toBe(true);
    expect(result.hostname).toBe('edubridge.uz');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe(HCaptchaService.VERIFY_URL);
    const body = (init as RequestInit).body as string;
    expect(body).toContain('secret=hcap-secret');
    expect(body).toContain('response=user-token');
    expect(body).toContain('remoteip=203.0.113.7');
  });

  it('returns missing-input-response when no token is supplied', async () => {
    const fetchStub = jest.fn();
    const service = new HCaptchaService(
      buildConfig('s'),
      fetchStub as unknown as typeof fetch,
    );

    const result = await service.verify('   ');
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['missing-input-response']);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('surfaces upstream HTTP failures as upstream-<status> error codes', async () => {
    const service = new HCaptchaService(
      buildConfig('s'),
      buildFetch({ ok: false, status: 502 }),
    );
    const result = await service.verify('token');
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['upstream-502']);
  });

  it('returns success=false with the error-codes from hCaptcha when verification fails', async () => {
    const service = new HCaptchaService(
      buildConfig('s'),
      buildFetch({
        json: async () => ({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      }),
    );

    const result = await service.verify('bad-token');
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['invalid-input-response']);
  });

  it('captures network errors as a generic network-error code', async () => {
    const fetchStub = jest
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    const service = new HCaptchaService(buildConfig('s'), fetchStub);
    const result = await service.verify('token');
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(['network-error']);
  });
});

describe('HCaptchaService — assertValid', () => {
  it('throws 403 CAPTCHA_REQUIRED when verification fails', async () => {
    const service = new HCaptchaService(
      buildConfig('s'),
      buildFetch({
        json: async () => ({ success: false, 'error-codes': ['bad'] }),
      }),
    );

    try {
      await service.assertValid('token');
      fail('expected assertValid to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      const body = (err as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body['code']).toBe('CAPTCHA_REQUIRED');
      expect(body['details']).toMatchObject({ errorCodes: ['bad'] });
    }
  });

  it('resolves silently when the secret is unset (dev-mode bypass)', async () => {
    const service = new HCaptchaService(
      buildConfig(undefined),
      jest.fn() as unknown as typeof fetch,
    );
    await expect(service.assertValid(undefined)).resolves.toBeUndefined();
  });
});
