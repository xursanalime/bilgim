import { SecurityHeadersMiddleware } from './security-headers.middleware';

/**
 * Unit tests for `SecurityHeadersMiddleware` (Task 29.4, Req 30.3).
 *
 * Covers:
 *   - Content-Security-Policy header is set with strict directives
 *   - X-Frame-Options: DENY is set
 *   - X-Content-Type-Options: nosniff is set
 *   - Referrer-Policy: strict-origin-when-cross-origin is set
 *   - Permissions-Policy is set with restrictive values
 *   - Strict-Transport-Security (HSTS) is set
 *   - X-XSS-Protection: 0 is set (disabled)
 *   - next() is always called
 *   - Headers are not set when response is already sent
 */

function createMocks() {
  const headers: Record<string, string> = {};
  const req = {
    method: 'GET',
    url: '/api/v1/catalog/courses',
    headers: {},
  };
  const res = {
    headersSent: false,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
  const next = jest.fn();
  return { req, res, next, headers };
}

// ─────────────────────────────────────────────────────────────────────

describe('SecurityHeadersMiddleware', () => {
  let middleware: SecurityHeadersMiddleware;

  beforeEach(() => {
    middleware = new SecurityHeadersMiddleware();
  });

  it('sets Content-Security-Policy with strict directives', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy']).toContain("script-src 'self'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
  });

  it('sets X-Frame-Options to DENY', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy with restrictive values', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['Permissions-Policy']).toBeDefined();
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('geolocation=()');
    expect(headers['Permissions-Policy']).toContain('payment=()');
  });

  it('sets Strict-Transport-Security (HSTS)', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['Strict-Transport-Security']).toBeDefined();
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(headers['Strict-Transport-Security']).toContain('includeSubDomains');
  });

  it('sets X-XSS-Protection to 0 (disabled)', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    expect(headers['X-XSS-Protection']).toBe('0');
  });

  it('always calls next()', () => {
    const { req, res, next } = createMocks();
    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not set headers when response is already sent', () => {
    const { req, res, next } = createMocks();
    res.headersSent = true;
    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still calls next() even if setHeader throws', () => {
    const req = { method: 'GET', url: '/', headers: {} };
    const res = {
      headersSent: false,
      setHeader: jest.fn(() => {
        throw new Error('socket closed');
      }),
    };
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets all required headers in a single pass', () => {
    const { req, res, next, headers } = createMocks();
    middleware.use(req, res, next);

    const requiredHeaders = [
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-XSS-Protection',
      'Strict-Transport-Security',
    ];

    for (const header of requiredHeaders) {
      expect(headers[header]).toBeDefined();
    }
  });
});
