import type { ConfigService } from '@nestjs/config';

import {
  WAF_ALLOWED_METHODS,
  WAF_HEADER_BYTES_LIMIT,
  WAF_RULES,
  WafMiddleware,
  type WafRequest,
  type WafResponse,
} from './waf.middleware';

/**
 * Build a `ConfigService` stub that returns the supplied env values.
 * Anything not in the map resolves to `undefined`, matching how the
 * real service treats unset variables.
 *
 * Cast through `any` because the strictly-typed `ConfigService<EnvConfig, true>`
 * generic arguments would force us to spell out the entire schema for
 * a one-line stub. The middleware only ever calls `.get(key)`, so the
 * narrow shape is enough.
 */
function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

/**
 * Lightweight Express-style response stub. Captures the status code,
 * JSON body and any headers the middleware sets so the test can
 * assert against them.
 */
function makeRes(): WafResponse & {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  let statusCode: number | null = null;
  let body: unknown = null;
  const res: any = {
    headersSent: false,
    statusCode,
    body,
    headers,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
  return res;
}

interface RunResult {
  nextCalls: number;
  res: ReturnType<typeof makeRes>;
}

/**
 * Run the middleware against a request and capture how many times
 * `next()` was invoked. A `nextCalls === 1` outcome means the rule
 * engine let the request through; `0` means it short-circuited with
 * a 4xx envelope.
 */
function run(
  middleware: WafMiddleware,
  req: WafRequest,
): RunResult {
  const res = makeRes();
  let nextCalls = 0;
  middleware.use(req, res, (() => {
    nextCalls += 1;
  }) as any);
  return { nextCalls, res };
}

describe('WafMiddleware', () => {
  describe('skip behaviour', () => {
    it('lets every request through when WAF_ENABLED=false', () => {
      const middleware = new WafMiddleware(
        makeConfig({ WAF_ENABLED: false, NODE_ENV: 'production' }),
      );
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/courses?id=1 union select password from users',
        headers: {},
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('lets every request through when no ConfigService is wired (dev fallback)', () => {
      const middleware = new WafMiddleware();
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/courses?id=1 union select password from users',
        headers: {},
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('defaults to OFF in development', () => {
      const middleware = new WafMiddleware(
        makeConfig({ NODE_ENV: 'development' }),
      );
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/courses?id=1 union select password from users',
        headers: {},
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('defaults to ON in production', () => {
      const middleware = new WafMiddleware(
        makeConfig({ NODE_ENV: 'production' }),
      );
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/courses?id=1 union select password from users',
        headers: {},
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // SQL injection — UNION SELECT, ' OR '1'='1, DROP TABLE plus the
  // looser keyword-chain probes (Task 27.1, Req 27.1).
  // -------------------------------------------------------------------
  describe('SQL injection detection', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it.each([
      [
        'UNION SELECT in URL',
        '/courses?id=1 union select password from users',
        'sql_injection.union_select',
      ],
      [
        'UNION ALL SELECT (whitespace tolerant)',
        '/courses?id=1 UNION ALL SELECT * FROM users',
        'sql_injection.union_select',
      ],
      [
        'DROP TABLE',
        '/api/v1/admin?cmd=drop table users',
        'sql_injection.drop_table',
      ],
      [
        "' OR '1'='1 quoted bypass",
        "/api/v1/login?user=admin'%20OR%20'1'='1",
        'sql_injection.boolean_or',
      ],
      [
        'SELECT FROM keyword chain',
        '/api/v1/users?cmd=select password from users where id=1',
        'sql_injection.keyword_chain',
      ],
      [
        'DELETE FROM keyword chain',
        '/api/v1/users?cmd=delete from users where id=1',
        'sql_injection.keyword_chain',
      ],
      [
        'INSERT INTO keyword chain',
        '/api/v1/admin?cmd=insert into accounts values 1',
        'sql_injection.keyword_chain',
      ],
      [
        'UPDATE … WHERE keyword chain',
        '/api/v1/users?cmd=update users set role=admin where id=1',
        'sql_injection.keyword_chain',
      ],
    ])('blocks SQL injection vector: %s', (_label, url, expectedRule) => {
      const req: WafRequest = {
        method: 'GET',
        url,
        originalUrl: url,
        headers: {},
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { code: string; ruleName: string } };
      expect(envelope.error.code).toBe('WAF_BLOCKED');
      expect(envelope.error.ruleName).toBe(expectedRule);
    });

    it('blocks SQL injection in the JSON body', () => {
      const req: WafRequest = {
        method: 'POST',
        url: '/api/v1/login',
        originalUrl: '/api/v1/login',
        headers: { 'content-type': 'application/json' },
        body: { username: "admin' OR '1'='1", password: 'x' },
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { code: string; ruleName: string } };
      expect(envelope.error.code).toBe('WAF_BLOCKED');
      expect(envelope.error.ruleName).toBe('sql_injection.boolean_or');
    });

    it('lets harmless prose pass (no false positive on "select")', () => {
      const req: WafRequest = {
        method: 'POST',
        url: '/posts',
        originalUrl: '/posts',
        headers: {},
        body: { content: 'Please pick your favourite programming language' },
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // XSS — <script>, javascript:, on…= handlers (Task 27.1, Req 27.1).
  // -------------------------------------------------------------------
  describe('XSS detection', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it.each([
      ['<script> tag', { body: { content: '<script>alert(1)</script>' } }],
      ['javascript: URI', { body: { link: 'javascript:alert(1)' } }],
      ['onload= handler', { body: { content: '<svg onload=alert(1)>' } }],
      ['onclick= handler', { body: { content: '<a onclick=evil()>x</a>' } }],
      ['onerror= handler', { body: { content: '<img onerror=alert()>' } }],
      ['onmouseover= handler', { body: { content: '<a onmouseover=x()>x</a>' } }],
    ])('blocks XSS vector: %s', (_label, payload) => {
      const req: WafRequest = {
        method: 'POST',
        url: '/posts',
        originalUrl: '/posts',
        headers: { 'content-type': 'application/json' },
        ...(payload as { body: unknown }),
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { code: string; ruleName: string } };
      expect(envelope.error.code).toBe('WAF_BLOCKED');
      expect(envelope.error.ruleName).toBe('xss.script_or_handler');
    });

    it('blocks an <iframe src="javascript:"> embed', () => {
      const req: WafRequest = {
        method: 'POST',
        url: '/posts',
        originalUrl: '/posts',
        headers: {},
        body: { content: '<iframe src="javascript:alert(1)"></iframe>' },
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { ruleName: string } };
      // Either the script-or-handler rule (javascript:) or the iframe
      // rule fires first; both are valid blocks.
      expect(envelope.error.ruleName).toMatch(/^xss\./);
    });
  });

  // -------------------------------------------------------------------
  // Path traversal — ../../etc/passwd plus encoded variants.
  // -------------------------------------------------------------------
  describe('Path traversal detection', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it.each([
      ['../../etc/passwd in URL', '/files/../../etc/passwd'],
      ['encoded %2e%2e%2f in URL', '/files/%2e%2e%2f%2e%2e%2fetc/passwd'],
      ['mixed encoding ..%2f', '/files/..%2f..%2fetc/passwd'],
      ['..\\\\ Windows-style', '/files/..\\..\\windows\\system.ini'],
      ['encoded backslash %2e%2e%5c', '/files/%2e%2e%5c%2e%2e%5cwin.ini'],
    ])('blocks path traversal vector: %s', (_label, url) => {
      const req: WafRequest = {
        method: 'GET',
        url,
        originalUrl: url,
        headers: {},
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { code: string; ruleName: string } };
      expect(envelope.error.code).toBe('WAF_BLOCKED');
      expect(envelope.error.ruleName).toMatch(/^path_traversal\./);
    });
  });

  // -------------------------------------------------------------------
  // HTTP method whitelist (Task 27.1, requirement 4).
  // -------------------------------------------------------------------
  describe('HTTP method whitelist', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it.each([
      ['TRACE', 'TRACE'],
      ['CONNECT', 'CONNECT'],
      ['lowercase trace', 'trace'],
      ['custom verb', 'PROPFIND'],
    ])('rejects %s with 405 WAF_METHOD_NOT_ALLOWED', (_label, method) => {
      const { nextCalls, res } = run(middleware, {
        method,
        url: '/api/v1/healthz',
        originalUrl: '/api/v1/healthz',
        headers: {},
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(405);
      const envelope = res.body as { error: { code: string; method: string } };
      expect(envelope.error.code).toBe('WAF_METHOD_NOT_ALLOWED');
      expect(envelope.error.method.toUpperCase()).toBe(method.toUpperCase());
    });

    it.each([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'HEAD',
    ])('allows %s through to next()', (method) => {
      const { nextCalls, res } = run(middleware, {
        method,
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('exposes the allow-listed methods as a stable set', () => {
      expect(WAF_ALLOWED_METHODS.size).toBe(7);
      expect([...WAF_ALLOWED_METHODS].sort()).toEqual(
        ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].sort(),
      );
    });
  });

  // -------------------------------------------------------------------
  // Oversized headers (>8KB) (Task 27.1, requirement 1d).
  // -------------------------------------------------------------------
  describe('oversized headers', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it('rejects with 431 WAF_HEADERS_TOO_LARGE when total bytes exceed 8 KiB', () => {
      // Build a single header value that pushes the total over the
      // limit. Cookie + a giant blob is the most common real-world
      // shape of this.
      const giant = 'x'.repeat(WAF_HEADER_BYTES_LIMIT + 1);
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: { 'x-bloat': giant },
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(431);
      const envelope = res.body as {
        error: { code: string; limitBytes: number };
      };
      expect(envelope.error.code).toBe('WAF_HEADERS_TOO_LARGE');
      expect(envelope.error.limitBytes).toBe(WAF_HEADER_BYTES_LIMIT);
    });

    it('rejects when the SUM of multiple smaller headers exceeds 8 KiB', () => {
      // Five 2 KiB headers — 10 KiB total. None individually exceeds
      // the limit, but the sum does.
      const chunk = 'a'.repeat(2 * 1024);
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {
          'x-pad-1': chunk,
          'x-pad-2': chunk,
          'x-pad-3': chunk,
          'x-pad-4': chunk,
          'x-pad-5': chunk,
        },
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(431);
    });

    it('lets a typical browser request (~1 KiB of headers) through', () => {
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
          cookie: 'sessionid=abc.def.ghi',
          'accept-encoding': 'gzip, deflate, br',
        },
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Legitimate traffic — must pass through cleanly with no false-
  // positive matches.
  // -------------------------------------------------------------------
  describe('legitimate traffic', () => {
    let middleware: WafMiddleware;
    beforeEach(() => {
      middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
    });

    it('lets a regular product page request through', () => {
      const req: WafRequest = {
        method: 'GET',
        url: '/courses/python-101',
        originalUrl: '/courses/python-101',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
        },
      };
      const { nextCalls, res } = run(middleware, req);
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('lets a regular JSON POST request through', () => {
      const req: WafRequest = {
        method: 'POST',
        url: '/api/v1/notes',
        originalUrl: '/api/v1/notes',
        headers: { 'content-type': 'application/json' },
        body: {
          title: 'Lecture notes',
          body: 'Today we covered HTTP and REST APIs.',
        },
      };
      const { nextCalls } = run(middleware, req);
      expect(nextCalls).toBe(1);
    });

    it('does not echo the matched payload back in the 403 envelope', () => {
      const req: WafRequest = {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {},
        body: { content: '<script>alert(1)</script>' },
      };
      const { res } = run(middleware, req);
      const envelope = res.body as { error: Record<string, unknown> };
      const serialised = JSON.stringify(envelope);
      expect(serialised).not.toContain('<script>');
      expect(serialised).not.toContain('alert(1)');
    });

    it('does not inspect the Authorization header (no false positive)', () => {
      // A bearer token that happens to contain SQL keywords must not
      // trip the WAF — that would reject every valid request from
      // unlucky users.
      const req: WafRequest = {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { authorization: 'Bearer SELECT.JWT.FROM' },
      };
      const { nextCalls } = run(middleware, req);
      expect(nextCalls).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Logging — the audit-log line includes the traceId so blocked
  // requests can be correlated through the rest of the platform.
  // -------------------------------------------------------------------
  describe('logging behaviour', () => {
    it('emits a WARN log line with traceId, ruleName, clientIp', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      const req: WafRequest = {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: {
          'x-forwarded-for': '203.0.113.99, 10.0.0.1',
          'x-trace-id': 'trace-abc-123',
        },
        body: { content: '<script>x</script>' },
      };
      run(middleware, req);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.message).toBe('WAF rule violated');
      expect(payload.ruleName).toBe('xss.script_or_handler');
      expect(payload.clientIp).toBe('203.0.113.99');
      expect(payload.traceId).toBe('trace-abc-123');
    });

    it('mints a fresh traceId when no header is present', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      const req: WafRequest = {
        method: 'GET',
        url: '/files/../../etc/passwd',
        originalUrl: '/files/../../etc/passwd',
        headers: {},
      };
      run(middleware, req);
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(typeof payload.traceId).toBe('string');
      expect(String(payload.traceId).length).toBeGreaterThan(0);
    });

    it('strips the query string from the logged URL', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      const url = '/api/v1/search?q=union select 1 from x';
      const req: WafRequest = {
        method: 'GET',
        url,
        originalUrl: url,
        headers: {},
      };
      run(middleware, req);
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.url).toBe('/api/v1/search');
    });

    it('emits a structured log line for an oversized-headers reject', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      const giant = 'x'.repeat(WAF_HEADER_BYTES_LIMIT + 1);
      run(middleware, {
        method: 'GET',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: { 'x-bloat': giant },
      });
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.message).toBe('WAF oversized headers');
      expect(payload.bytes).toBeGreaterThan(WAF_HEADER_BYTES_LIMIT);
      expect(payload.limitBytes).toBe(WAF_HEADER_BYTES_LIMIT);
    });

    it('emits a structured log line for a method-not-allowed reject', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      run(middleware, {
        method: 'TRACE',
        url: '/api/v1/courses',
        originalUrl: '/api/v1/courses',
        headers: {},
      });
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.message).toBe('WAF method not allowed');
      expect(String(payload.method).toUpperCase()).toBe('TRACE');
    });
  });

  // -------------------------------------------------------------------
  // 403 envelope shape — single source of truth for the error code,
  // message, and trace id contract documented in the task spec.
  // -------------------------------------------------------------------
  describe('403 envelope shape', () => {
    it('returns { error: { code: WAF_BLOCKED, message, ruleName, traceId } }', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const req: WafRequest = {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: { 'x-trace-id': 'trace-xyz' },
        body: { content: '<script>alert(1)</script>' },
      };
      const { res } = run(middleware, req);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as {
        error: {
          code: string;
          message: string;
          ruleName: string;
          traceId: string;
        };
      };
      expect(envelope.error.code).toBe('WAF_BLOCKED');
      expect(envelope.error.message).toBe(
        'Request blocked by security policy',
      );
      expect(envelope.error.ruleName).toBe('xss.script_or_handler');
      expect(envelope.error.traceId).toBe('trace-xyz');
    });

    it('sets X-Trace-Id on the response', () => {
      const middleware = new WafMiddleware(makeConfig({ WAF_ENABLED: true }));
      const req: WafRequest = {
        method: 'GET',
        url: '/files/../../etc/passwd',
        originalUrl: '/files/../../etc/passwd',
        headers: { 'x-trace-id': 'trace-zzz' },
      };
      const { res } = run(middleware, req);
      expect(res.headers['X-Trace-Id']).toBe('trace-zzz');
    });
  });

  // -------------------------------------------------------------------
  // Rule-table integrity — guard against accidental rule deletion.
  // -------------------------------------------------------------------
  describe('rule table integrity', () => {
    it('exposes every required rule category from the spec', () => {
      const names = new Set(WAF_RULES.map((r) => r.name));
      expect(names.has('sql_injection.union_select')).toBe(true);
      expect(names.has('sql_injection.drop_table')).toBe(true);
      expect(names.has('sql_injection.boolean_or')).toBe(true);
      expect(names.has('sql_injection.keyword_chain')).toBe(true);
      expect(names.has('xss.script_or_handler')).toBe(true);
      expect(names.has('path_traversal.dotdot')).toBe(true);
      expect(names.has('command_injection.shell_chain')).toBe(true);
    });
  });
});
