import type { ConfigService } from '@nestjs/config';

import { GeoBlockerService } from './geo-blocker.service';
import {
  TIERED_RATE_LIMITS,
  TieredRateLimiterService,
} from './tiered-rate-limiter.service';
import {
  PrismaThreatAuditLogger,
  ThreatProtectionMiddleware,
  type ThreatAuditEvent,
  type ThreatAuditLogger,
  type ThreatNext,
  type ThreatRequest,
  type ThreatResponse,
} from './threat-protection.middleware';

/**
 * Integration test for the composed middleware (Task 27.1).
 *
 * The middleware glues three independent helpers together. These
 * tests exercise the wiring + envelope shape; the underlying logic is
 * already covered by the helper-specific specs.
 */

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function makeRes(): ThreatResponse & {
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

class CapturingAuditLogger implements ThreatAuditLogger {
  events: ThreatAuditEvent[] = [];
  async log(event: ThreatAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds?: number) {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
  async exists(key: string) {
    return this.store.has(key);
  }
  async incr(key: string) {
    const current = this.store.get(key);
    const next = (current ? Number(current.value) : 0) + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: current?.expiresAt ?? null,
    });
    return next;
  }
  async expire(key: string, ttlSec: number) {
    const v = this.store.get(key);
    if (!v) return;
    this.store.set(key, { value: v.value, expiresAt: Date.now() + ttlSec * 1000 });
  }
  getClient() {
    return {
      ttl: async (key: string) => {
        const v = this.store.get(key);
        if (!v) return -2;
        if (v.expiresAt === null) return -1;
        return Math.max(0, Math.ceil((v.expiresAt - Date.now()) / 1000));
      },
    };
  }
}

async function run(
  middleware: ThreatProtectionMiddleware,
  req: ThreatRequest,
): Promise<{ res: ReturnType<typeof makeRes>; nextCalls: number }> {
  const res = makeRes();
  let nextCalls = 0;
  const next: ThreatNext = () => {
    nextCalls += 1;
  };
  await middleware.use(req, res, next);
  return { res, nextCalls };
}

describe('ThreatProtectionMiddleware', () => {
  describe('master toggle', () => {
    it('passes every request through when THREAT_PROTECTION_ENABLED=false', async () => {
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: false }),
      );
      const { res, nextCalls } = await run(middleware, {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: { 'cf-ipcountry': 'KP' },
        body: { content: '<script>alert(1)</script>' },
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
      expect(audit.events.length).toBe(0);
    });

    it('defaults to OFF in development', async () => {
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        new CapturingAuditLogger(),
        makeConfig({ NODE_ENV: 'development' }),
      );
      const { res, nextCalls } = await run(middleware, {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { 'cf-ipcountry': 'KP' },
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });

    it('defaults to ON in production', async () => {
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        new CapturingAuditLogger(),
        makeConfig({ NODE_ENV: 'production' }),
      );
      const { res, nextCalls } = await run(middleware, {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { 'cf-ipcountry': 'KP' },
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('geo-block', () => {
    it('returns 403 GEO_BLOCKED for a blocked country', async () => {
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const { res, nextCalls } = await run(middleware, {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { 'cf-ipcountry': 'KP' },
        ip: '203.0.113.1',
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(403);
      const body = res.body as { error: { code: string; countryCode: string } };
      expect(body.error.code).toBe('GEO_BLOCKED');
      expect(body.error.countryCode).toBe('KP');
      expect(res.headers['X-Trace-Id']).toBeDefined();
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]?.type).toBe('GEO_BLOCKED');
    });

    it('lets through requests from non-blocked countries', async () => {
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        new CapturingAuditLogger(),
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const { nextCalls, res } = await run(middleware, {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: { 'cf-ipcountry': 'UZ' },
        ip: '203.0.113.1',
      });
      expect(nextCalls).toBe(1);
      expect(res.statusCode).toBeNull();
    });
  });

  describe('suspicious request', () => {
    it('returns 400 WAF_BLOCKED on a SQLi probe', async () => {
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(makeConfig()),
        new TieredRateLimiterService(undefined, makeConfig()),
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const { res, nextCalls } = await run(middleware, {
        method: 'GET',
        url: '/api/v1/courses?id=1 union select password from users',
        originalUrl: '/api/v1/courses?id=1 union select password from users',
        headers: {},
        ip: '203.0.113.5',
      });
      expect(nextCalls).toBe(0);
      expect(res.statusCode).toBe(400);
      const body = res.body as { error: { code: string; ruleName: string } };
      expect(body.error.code).toBe('WAF_BLOCKED');
      expect(body.error.ruleName).toContain('sqli');
      expect(audit.events).toHaveLength(1);
      const evt = audit.events[0];
      expect(evt?.type).toBe('WAF_BLOCKED');
      // Audit log must NOT contain the raw payload — only sanitised
      // sample slices.
      const serialised = JSON.stringify(evt);
      expect(serialised).toContain('union');
      expect(serialised).not.toContain('password from users');
    });

    it('returns 400 WAF_BLOCKED on an XSS probe in the body', async () => {
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(makeConfig()),
        new TieredRateLimiterService(undefined, makeConfig()),
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const { res } = await run(middleware, {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: { 'content-type': 'application/json' },
        body: { content: '<script>alert(1)</script>' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.body as { error: { code: string; category: string } };
      expect(body.error.code).toBe('WAF_BLOCKED');
      expect(body.error.category).toBe('xss');
    });
  });

  describe('tiered rate limit', () => {
    it('returns 429 RATE_LIMITED with Retry-After when burst is exceeded', async () => {
      const redis = new FakeRedis();
      const limiter = new TieredRateLimiterService(
        redis as unknown as any,
        makeConfig({ THREAT_RATE_LIMIT_IP_BURST: 2 }),
      );
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(makeConfig()),
        limiter,
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );

      // First two requests pass.
      for (let i = 0; i < 2; i += 1) {
        const r = await run(middleware, {
          method: 'GET',
          url: '/api/v1/me',
          originalUrl: '/api/v1/me',
          headers: {},
          ip: '203.0.113.10',
        });
        expect(r.nextCalls).toBe(1);
      }

      // Third one triggers the burst ban.
      const blocked = await run(middleware, {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        ip: '203.0.113.10',
      });
      expect(blocked.nextCalls).toBe(0);
      expect(blocked.res.statusCode).toBe(429);
      expect(blocked.res.headers['Retry-After']).toBeDefined();
      const body = blocked.res.body as {
        error: { code: string; reason: string; retryAfterSeconds: number };
      };
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.reason).toBe('IP_BURST');
      expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
      expect(audit.events.find((e) => e.type === 'RATE_LIMITED')).toBeDefined();
    });

    it('counts authenticated requests against the per-user bucket', async () => {
      const redis = new FakeRedis();
      const limiter = new TieredRateLimiterService(
        redis as unknown as any,
        makeConfig({
          THREAT_RATE_LIMIT_IP_BURST: 1000,
          THREAT_RATE_LIMIT_IP_GLOBAL: 1000,
          THREAT_RATE_LIMIT_USER: 2,
        }),
      );
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(makeConfig()),
        limiter,
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const baseReq: ThreatRequest = {
        method: 'GET',
        url: '/api/v1/me',
        originalUrl: '/api/v1/me',
        headers: {},
        ip: '203.0.113.20',
        user: { sub: 'user-xyz' },
      };

      const r1 = await run(middleware, { ...baseReq });
      const r2 = await run(middleware, { ...baseReq });
      expect(r1.nextCalls + r2.nextCalls).toBe(2);

      const blocked = await run(middleware, { ...baseReq });
      expect(blocked.res.statusCode).toBe(429);
      const body = blocked.res.body as { error: { reason: string } };
      expect(body.error.reason).toBe('USER');
    });
  });

  describe('audit log integration', () => {
    it('PrismaThreatAuditLogger writes to AdminAuditLog with the correct shape', async () => {
      const created = jest.fn().mockResolvedValue(undefined);
      const fakePrisma = {
        adminAuditLog: { create: created },
      } as unknown as any;
      const logger = new PrismaThreatAuditLogger(fakePrisma);
      await logger.log({
        type: 'WAF_BLOCKED',
        ip: '203.0.113.99',
        ruleName: 'sqli.union_select',
        category: 'sql_injection',
        surface: 'url',
        sample: 'union select 1',
        method: 'GET',
        path: '/api/v1/courses',
        traceId: 'trace-1',
      });
      expect(created).toHaveBeenCalledTimes(1);
      const arg = created.mock.calls[0]?.[0];
      expect(arg.data.action).toBe('waf.blocked');
      expect(arg.data.target).toBe('203.0.113.99');
      expect(arg.data.ip).toBe('203.0.113.99');
      expect(arg.data.payload.ruleName).toBe('sqli.union_select');
    });

    it('PrismaThreatAuditLogger swallows errors from the prisma client', async () => {
      const fakePrisma = {
        adminAuditLog: {
          create: jest.fn().mockRejectedValue(new Error('db down')),
        },
      } as unknown as any;
      const logger = new PrismaThreatAuditLogger(fakePrisma);
      await expect(
        logger.log({
          type: 'GEO_BLOCKED',
          ip: '203.0.113.99',
          countryCode: 'KP',
          method: 'GET',
          path: '/',
          traceId: 'trace-2',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('rule ordering — geo > waf > rate limit', () => {
    it('returns GEO_BLOCKED first when both geo and waf would fire', async () => {
      const audit = new CapturingAuditLogger();
      const middleware = new ThreatProtectionMiddleware(
        new GeoBlockerService(
          makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
        ),
        new TieredRateLimiterService(undefined, makeConfig()),
        audit,
        makeConfig({ THREAT_PROTECTION_ENABLED: true }),
      );
      const { res } = await run(middleware, {
        method: 'POST',
        url: '/api/v1/posts',
        originalUrl: '/api/v1/posts',
        headers: { 'cf-ipcountry': 'KP' },
        body: { content: '<script>alert(1)</script>' },
      });
      expect(res.statusCode).toBe(403);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('GEO_BLOCKED');
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]?.type).toBe('GEO_BLOCKED');
    });
  });

  describe('limit constants exposed', () => {
    it('uses the documented defaults from the spec', () => {
      expect(TIERED_RATE_LIMITS.IP_BURST).toBe(50);
      expect(TIERED_RATE_LIMITS.IP_GLOBAL).toBe(600);
      expect(TIERED_RATE_LIMITS.USER).toBe(1200);
      expect(TIERED_RATE_LIMITS.IP_BURST_BAN_SECONDS).toBe(5);
      expect(TIERED_RATE_LIMITS.IP_GLOBAL_BAN_SECONDS).toBe(60);
      expect(TIERED_RATE_LIMITS.USER_BAN_SECONDS).toBe(60);
    });
  });
});
