import {
  DEFAULT_REQUEST_LIMITS,
  RequestLimitsMiddleware,
  RequestLimitsRequest,
  RequestLimitsResponse,
} from './request-limits.middleware';

/**
 * Unit tests for `RequestLimitsMiddleware` (Task 29.5, Req 30.5).
 *
 * Covers:
 *   - Body size limit (10MB via Content-Length).
 *   - Headers size limit (8KB).
 *   - URL length limit (2048 characters).
 *   - Requests within limits pass through.
 */

function makeResponse(): RequestLimitsResponse & {
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
} {
  const res: RequestLimitsResponse & {
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

describe('RequestLimitsMiddleware — URL length', () => {
  let middleware: RequestLimitsMiddleware;

  beforeEach(() => {
    middleware = new RequestLimitsMiddleware();
  });

  it('passes through URLs within 2048 characters', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users?page=1',
      headers: {},
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects URLs exceeding 2048 characters with 414', () => {
    const longUrl = '/api/v1/search?' + 'q='.padEnd(2100, 'x');
    const req: RequestLimitsRequest = {
      originalUrl: longUrl,
      headers: {},
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(414);
    expect(res.body).toMatchObject({
      error: {
        code: 'REQUEST_URI_TOO_LONG',
        maxLength: 2048,
      },
    });
  });

  it('allows exactly 2048 character URLs', () => {
    const exactUrl = '/' + 'a'.repeat(2047);
    expect(exactUrl.length).toBe(2048);

    const req: RequestLimitsRequest = {
      originalUrl: exactUrl,
      headers: {},
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('RequestLimitsMiddleware — headers size', () => {
  let middleware: RequestLimitsMiddleware;

  beforeEach(() => {
    middleware = new RequestLimitsMiddleware();
  });

  it('passes through requests with small headers', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token123',
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects requests with headers exceeding 8KB with 431', () => {
    // Create headers that exceed 8KB
    const largeHeaderValue = 'x'.repeat(9000);
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users',
      headers: {
        'x-custom-header': largeHeaderValue,
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(431);
    expect(res.body).toMatchObject({
      error: {
        code: 'REQUEST_HEADERS_TOO_LARGE',
        maxSize: 8192,
      },
    });
  });

  it('uses rawHeaders for more accurate size estimation', () => {
    // rawHeaders that exceed 8KB
    const rawHeaders: string[] = [];
    for (let i = 0; i < 100; i++) {
      rawHeaders.push(`x-header-${i}`, 'x'.repeat(100));
    }
    // Total: ~100 * (12 + 100) = ~11200 bytes > 8KB

    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users',
      headers: {},
      rawHeaders,
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(431);
  });
});

describe('RequestLimitsMiddleware — body size', () => {
  let middleware: RequestLimitsMiddleware;

  beforeEach(() => {
    middleware = new RequestLimitsMiddleware();
  });

  it('passes through requests with Content-Length within 10MB', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/upload',
      headers: {
        'content-length': '5242880', // 5MB
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects requests with Content-Length exceeding 10MB with 413', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/upload',
      headers: {
        'content-length': '11534336', // 11MB
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({
      error: {
        code: 'REQUEST_BODY_TOO_LARGE',
        maxSize: 10 * 1024 * 1024,
      },
    });
  });

  it('allows exactly 10MB body', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/upload',
      headers: {
        'content-length': String(10 * 1024 * 1024),
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through when Content-Length is absent', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users',
      headers: {},
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes through when Content-Length is not a valid number', () => {
    const req: RequestLimitsRequest = {
      originalUrl: '/api/v1/users',
      headers: {
        'content-length': 'invalid',
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('RequestLimitsMiddleware — default limits', () => {
  it('DEFAULT_REQUEST_LIMITS has correct values', () => {
    expect(DEFAULT_REQUEST_LIMITS.maxBodySize).toBe(10 * 1024 * 1024);
    expect(DEFAULT_REQUEST_LIMITS.maxHeadersSize).toBe(8 * 1024);
    expect(DEFAULT_REQUEST_LIMITS.maxUrlLength).toBe(2048);
  });
});

describe('RequestLimitsMiddleware — priority order', () => {
  let middleware: RequestLimitsMiddleware;

  beforeEach(() => {
    middleware = new RequestLimitsMiddleware();
  });

  it('checks URL first, then headers, then body', () => {
    // URL too long AND headers too large AND body too large
    const longUrl = '/' + 'a'.repeat(3000);
    const req: RequestLimitsRequest = {
      originalUrl: longUrl,
      headers: {
        'x-big': 'x'.repeat(9000),
        'content-length': '20000000',
      },
    };
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    // Should reject with URL error first (414)
    expect(res.statusCode).toBe(414);
    expect((res.body as any).error.code).toBe('REQUEST_URI_TOO_LONG');
  });
});
