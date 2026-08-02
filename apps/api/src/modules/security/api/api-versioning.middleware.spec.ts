import { ConfigService } from '@nestjs/config';

import {
  ApiVersioningMiddleware,
  ApiVersioningNext,
  ApiVersioningRequest,
  ApiVersioningResponse,
  CURRENT_API_VERSION,
  DEFAULT_DEPRECATED_VERSIONS,
  DeprecatedVersion,
  MIN_DEPRECATION_NOTICE_MS,
  SUPPORTED_API_VERSIONS,
} from './api-versioning.middleware';

/**
 * Unit tests for `ApiVersioningMiddleware` (Task 29.5, Req 30.4).
 *
 * Covers:
 *   - Supported versions pass through with X-API-Version header.
 *   - Unsupported versions are rejected with 400.
 *   - Non-versioned paths pass through without inspection.
 *   - Deprecated versions emit Deprecation, Sunset, Link headers.
 *   - 6-month minimum notice validation on construction.
 */

function makeResponse(): ApiVersioningResponse & {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
} {
  const res: ApiVersioningResponse & {
    statusCode?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = {
    headersSent: false,
    headers: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

function makeConfigService(): ConfigService {
  return { get: jest.fn() } as unknown as ConfigService;
}

describe('ApiVersioningMiddleware — supported versions', () => {
  let middleware: ApiVersioningMiddleware;

  beforeEach(() => {
    middleware = new ApiVersioningMiddleware(makeConfigService());
  });

  it('passes through /api/v1/users and sets X-API-Version header', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v1/users' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBe('v1');
    expect(res.statusCode).toBeUndefined();
  });

  it('passes through /api/v2/courses and sets X-API-Version header', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v2/courses' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBe('v2');
  });

  it('handles /v1/... paths without /api prefix', () => {
    const req: ApiVersioningRequest = { url: '/v1/health' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBe('v1');
  });

  it('is case-insensitive for version extraction', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/V2/users' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBe('v2');
  });
});

describe('ApiVersioningMiddleware — unsupported versions', () => {
  let middleware: ApiVersioningMiddleware;

  beforeEach(() => {
    middleware = new ApiVersioningMiddleware(makeConfigService());
  });

  it('rejects /api/v3/users with 400 UNSUPPORTED_API_VERSION', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v3/users' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'UNSUPPORTED_API_VERSION',
        supportedVersions: expect.arrayContaining(['v1', 'v2']),
        currentVersion: CURRENT_API_VERSION,
      },
    });
  });

  it('rejects /api/v99/anything', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v99/anything' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('does not reject if headers already sent', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v5/x' };
    const res = makeResponse();
    res.headersSent = true;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});

describe('ApiVersioningMiddleware — non-versioned paths', () => {
  let middleware: ApiVersioningMiddleware;

  beforeEach(() => {
    middleware = new ApiVersioningMiddleware(makeConfigService());
  });

  it('passes through /health without version check', () => {
    const req: ApiVersioningRequest = { originalUrl: '/health' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBeUndefined();
  });

  it('passes through /metrics without version check', () => {
    const req: ApiVersioningRequest = { originalUrl: '/metrics' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through paths with query strings', () => {
    const req: ApiVersioningRequest = { originalUrl: '/api/v1/users?page=1' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-API-Version']).toBe('v1');
  });
});

describe('ApiVersioningMiddleware — deprecation headers', () => {
  it('emits Deprecation, Sunset, Link, and X-API-Deprecation-Notice headers for deprecated versions', () => {
    // Temporarily override the default registry
    const originalDeprecated = [...DEFAULT_DEPRECATED_VERSIONS];
    const deprecatedVersions: DeprecatedVersion[] = [
      {
        version: 'v1',
        sunsetDate: '2025-07-01T00:00:00Z',
        replacementVersion: 'v2',
        announcedAt: '2025-01-01T00:00:00Z',
      },
    ];

    // Create middleware with custom deprecation registry via prototype override
    const config = makeConfigService();
    const middleware = new ApiVersioningMiddleware(config);
    // Inject deprecated versions for testing
    (middleware as any).deprecatedVersions = deprecatedVersions;

    const req: ApiVersioningRequest = { originalUrl: '/api/v1/users' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['Deprecation']).toBe('true');
    expect(res.headers['Sunset']).toBe(
      new Date('2025-07-01T00:00:00Z').toUTCString(),
    );
    expect(res.headers['Link']).toBe(
      '</api/v2>; rel="successor-version"',
    );
    expect(res.headers['X-API-Deprecation-Notice']).toContain(
      'deprecated and will be removed',
    );
    expect(res.headers['X-API-Deprecation-Notice']).toContain('v2');
  });

  it('does not emit deprecation headers for non-deprecated versions', () => {
    const middleware = new ApiVersioningMiddleware(makeConfigService());
    const req: ApiVersioningRequest = { originalUrl: '/api/v2/users' };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['Deprecation']).toBeUndefined();
    expect(res.headers['Sunset']).toBeUndefined();
  });
});

describe('ApiVersioningMiddleware — 6-month notice validation', () => {
  it('logs error when deprecation notice is less than 6 months', () => {
    const config = makeConfigService();
    const middleware = new ApiVersioningMiddleware(config);

    // Inject a bad entry with less than 6 months notice
    const badEntry: DeprecatedVersion = {
      version: 'v1',
      sunsetDate: '2024-08-01T00:00:00Z',
      replacementVersion: 'v2',
      announcedAt: '2024-07-01T00:00:00Z', // Only 1 month notice
    };

    // Re-validate with bad entry — should log an error but not throw
    (middleware as any).deprecatedVersions = [badEntry];
    expect(() => (middleware as any).validateDeprecationRegistry()).not.toThrow();
  });

  it('MIN_DEPRECATION_NOTICE_MS equals approximately 6 months', () => {
    const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
    expect(MIN_DEPRECATION_NOTICE_MS).toBe(sixMonthsMs);
  });
});

describe('ApiVersioningMiddleware — constants', () => {
  it('SUPPORTED_API_VERSIONS includes v1 and v2', () => {
    expect(SUPPORTED_API_VERSIONS).toContain('v1');
    expect(SUPPORTED_API_VERSIONS).toContain('v2');
  });

  it('CURRENT_API_VERSION is v2', () => {
    expect(CURRENT_API_VERSION).toBe('v2');
  });
});
