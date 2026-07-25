import type { ConfigService } from '@nestjs/config';

import {
  AdminIpAllowlistMiddleware,
  type AdminAllowlistRequest,
  type AdminAllowlistResponse,
} from './admin-ip-allowlist.middleware';

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function makeRes(): AdminAllowlistResponse & {
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

function run(
  middleware: AdminIpAllowlistMiddleware,
  req: AdminAllowlistRequest,
): RunResult {
  const res = makeRes();
  let nextCalls = 0;
  middleware.use(req, res, (() => {
    nextCalls += 1;
  }) as any);
  return { nextCalls, res };
}

describe('AdminIpAllowlistMiddleware', () => {
  describe('empty allowlist', () => {
    it('lets every request through when ADMIN_IP_ALLOWLIST is unset', () => {
      const middleware = new AdminIpAllowlistMiddleware(makeConfig({}));
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: {},
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('lets every request through when ADMIN_IP_ALLOWLIST is empty string', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '' }),
      );
      expect(middleware.entryCount).toBe(0);
      const { nextCalls } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: {},
      });
      expect(nextCalls).toBe(1);
    });

    it('lets every request through when no ConfigService is wired', () => {
      const middleware = new AdminIpAllowlistMiddleware();
      const { nextCalls } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: {},
      });
      expect(nextCalls).toBe(1);
    });
  });

  describe('exact-IP allowlist', () => {
    it('lets a matching IP through', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5,203.0.113.6' }),
      );
      const { nextCalls } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.5',
        headers: {},
      });
      expect(nextCalls).toBe(1);
    });

    it('rejects an off-allowlist IP with 403 ADMIN_IP_NOT_ALLOWED', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: {},
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const envelope = res.body as { error: { code: string; message: string } };
      expect(envelope.error.code).toBe('ADMIN_IP_NOT_ALLOWED');
      expect(envelope.error.message).toBe(
        'Request blocked by security policy',
      );
    });

    it('does not match an adjacent IP', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.6',
        headers: {},
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('CIDR allowlist', () => {
    it('matches every IP inside a /24 range', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' }),
      );
      for (const ip of ['203.0.113.1', '203.0.113.50', '203.0.113.255']) {
        expect(middleware.isAllowed(ip)).toBe(true);
      }
    });

    it('does not match an IP outside the range', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.0/24' }),
      );
      expect(middleware.isAllowed('203.0.114.1')).toBe(false);
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.114.1',
        headers: {},
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
    });

    it('matches every IP inside a /8 range', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '10.0.0.0/8' }),
      );
      expect(middleware.isAllowed('10.5.6.7')).toBe(true);
      expect(middleware.isAllowed('10.255.255.255')).toBe(true);
      expect(middleware.isAllowed('11.0.0.1')).toBe(false);
    });

    it('honours mixed exact + CIDR entries', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5, 10.0.0.0/8' }),
      );
      expect(middleware.entryCount).toBe(2);
      expect(middleware.isAllowed('203.0.113.5')).toBe(true);
      expect(middleware.isAllowed('10.5.6.7')).toBe(true);
      expect(middleware.isAllowed('203.0.113.6')).toBe(false);
    });

    it('drops malformed CIDR entries without widening the list', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({
          ADMIN_IP_ALLOWLIST: '10.0.0.0/99,not-an-ip,8.8.8.8',
        }),
      );
      // /99 is invalid; "not-an-ip" parses as exact-match (and never
      // matches a real IP); 8.8.8.8 still bypasses.
      expect(middleware.isAllowed('10.0.0.5')).toBe(false);
      expect(middleware.isAllowed('8.8.8.8')).toBe(true);
    });
  });

  describe('loopback handling', () => {
    it('always allows loopback even with a non-empty allowlist', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      for (const ip of ['127.0.0.1', '::1']) {
        expect(middleware.isAllowed(ip)).toBe(true);
      }
    });
  });

  describe('client IP extraction', () => {
    it('allows the trusted connection IP (req.ip) and ignores X-Forwarded-For', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      // Express already resolved the real client into req.ip via
      // `trust proxy`. A forged X-Forwarded-For (here naming a bogus IP)
      // must not change the decision.
      const { nextCalls } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.5', // trusted client IP as computed by Express
        headers: { 'x-forwarded-for': '9.9.9.9' },
      });
      expect(nextCalls).toBe(1);
    });

    it('ignores a spoofed X-Forwarded-For that names an allow-listed IP', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '10.0.0.1' }),
      );
      // Attack: an off-allowlist client (203.0.113.5) forges
      // `X-Forwarded-For: 10.0.0.1` (an allow-listed value) hoping to slip
      // past the admin allowlist. The middleware must trust only the real
      // connection IP and reject.
      const { nextCalls, res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.5', // real attacker IP, not on the allowlist
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('logging behaviour', () => {
    it('emits a WARN log line on rejection with traceId + clientIp', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      run(middleware, {
        method: 'POST',
        url: '/admin/users/123/ban',
        ip: '203.0.113.99',
        headers: { 'x-trace-id': 'admin-trace-1' },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.message).toBe('Admin IP allowlist violation');
      expect(payload.clientIp).toBe('203.0.113.99');
      expect(payload.traceId).toBe('admin-trace-1');
      expect(payload.method).toBe('POST');
      expect(payload.path).toBe('/admin/users/123/ban');
    });

    it('mints a fresh traceId when no header is present', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      const warnSpy = jest.spyOn(
        (middleware as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );
      run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: {},
      });
      const payload = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(typeof payload.traceId).toBe('string');
      expect(String(payload.traceId).length).toBeGreaterThan(0);
    });

    it('sets X-Trace-Id on the rejection response', () => {
      const middleware = new AdminIpAllowlistMiddleware(
        makeConfig({ ADMIN_IP_ALLOWLIST: '203.0.113.5' }),
      );
      const { res } = run(middleware, {
        method: 'GET',
        url: '/admin/users',
        ip: '203.0.113.99',
        headers: { 'x-trace-id': 'admin-trace-2' },
      });
      expect(res.headers['X-Trace-Id']).toBe('admin-trace-2');
    });
  });
});
