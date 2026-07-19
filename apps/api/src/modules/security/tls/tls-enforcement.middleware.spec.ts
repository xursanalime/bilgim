import {
  TlsEnforcementMiddleware,
  type TlsEnforcementRequest,
  type TlsEnforcementResponse,
} from './tls-enforcement.middleware';

/**
 * Tests for `TlsEnforcementMiddleware` (Task 28.4, Req 28.2).
 *
 * Behaviour matrix:
 *
 *   - Disabled in dev → every request passes (even plaintext).
 *   - Enabled in production → plaintext rejected with
 *     `403 TLS_REQUIRED`, HTTPS allowed via any of (`req.secure`,
 *     `req.protocol`, `socket.encrypted`, `X-Forwarded-Proto`).
 *   - Health / metrics paths bypass the gate even when on.
 */

function buildConfig(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

function buildRes(): TlsEnforcementResponse & {
  statusCode: number | null;
  body: unknown;
} {
  const res = {
    statusCode: null as number | null,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this as unknown as TlsEnforcementResponse;
    },
    json(payload: unknown) {
      this.body = payload;
      return this as unknown as TlsEnforcementResponse;
    },
  };
  return res as unknown as TlsEnforcementResponse & {
    statusCode: number | null;
    body: unknown;
  };
}

describe('TlsEnforcementMiddleware', () => {
  describe('disabled in development', () => {
    it('lets plaintext requests through when NODE_ENV=development', () => {
      const middleware = new TlsEnforcementMiddleware(
        buildConfig({ NODE_ENV: 'development' }),
      );
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: {},
      };
      const res = buildRes();
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('honours explicit TLS_ENFORCEMENT_ENABLED=false in production', () => {
      const middleware = new TlsEnforcementMiddleware(
        buildConfig({
          NODE_ENV: 'production',
          TLS_ENFORCEMENT_ENABLED: false,
        }),
      );
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users',
        headers: {},
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled in production', () => {
    const enable = () =>
      new TlsEnforcementMiddleware(buildConfig({ NODE_ENV: 'production' }));

    it('rejects plaintext requests with 403 TLS_REQUIRED', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'POST',
        path: '/api/v1/auth/login',
        protocol: 'http',
        secure: false,
        headers: {},
      };
      const res = buildRes();
      const next = jest.fn();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({
        error: { code: 'TLS_REQUIRED' },
      });
    });

    it('allows requests with X-Forwarded-Proto: https', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users/me',
        protocol: 'http',
        secure: false,
        headers: { 'x-forwarded-proto': 'https' },
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows requests when req.secure is true', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users/me',
        secure: true,
        headers: {},
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows requests when socket is encrypted (direct HTTPS bind)', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users/me',
        socket: { encrypted: true },
        headers: {},
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('skips /health even when enforcement is on', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/health',
        protocol: 'http',
        headers: {},
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('skips /metrics even when enforcement is on', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/metrics',
        protocol: 'http',
        headers: {},
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('parses comma-separated X-Forwarded-Proto chain', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users/me',
        protocol: 'http',
        secure: false,
        headers: { 'x-forwarded-proto': 'https, http' },
      };
      const next = jest.fn();
      middleware.use(req, buildRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects when X-Forwarded-Proto is http even with proxy chain', () => {
      const middleware = enable();
      const req: TlsEnforcementRequest = {
        method: 'GET',
        path: '/api/v1/users/me',
        protocol: 'http',
        secure: false,
        headers: { 'x-forwarded-proto': 'http' },
      };
      const res = buildRes();
      const next = jest.fn();
      middleware.use(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });
});
