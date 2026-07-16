import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { RedisService } from '../../../infra/redis/redis.service';
import {
  THREAT_PROTECTION_CONSTANTS,
  ThreatProtectionService,
} from '../threat-protection.service';
import { ThreatProtectionGuard } from '../threat-protection.guard';

/**
 * Minimal in-memory Redis fake — same shape as the service spec helper
 * but copied here to keep the test file self-contained.
 */
function makeFakeRedis() {
  type Entry = { value: string; expiresAt: number | null };
  const store = new Map<string, Entry>();
  let now = 1_000_000;

  const isExpired = (e: Entry) =>
    e.expiresAt !== null && e.expiresAt <= now;
  const compact = () => {
    for (const [k, v] of store) if (isExpired(v)) store.delete(k);
  };

  const fakeService: any = {
    get: async (key: string) => {
      compact();
      return store.get(key)?.value ?? null;
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt =
        typeof ttlSeconds === 'number' ? now + ttlSeconds : null;
      store.set(key, { value, expiresAt });
    },
    del: async (key: string) => {
      compact();
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
    exists: async (key: string) => {
      compact();
      return store.has(key);
    },
    incr: async (key: string) => {
      compact();
      const entry = store.get(key);
      const next = (entry ? Number(entry.value) || 0 : 0) + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    },
    expire: async (key: string, ttlSeconds: number) => {
      const entry = store.get(key);
      if (!entry) return;
      entry.expiresAt = now + ttlSeconds;
    },
    getClient: () => ({
      decr: async (key: string) => {
        compact();
        const entry = store.get(key);
        const next = (entry ? Number(entry.value) || 0 : 0) - 1;
        store.set(key, {
          value: String(next),
          expiresAt: entry?.expiresAt ?? null,
        });
        return next;
      },
      scan: async (cursor: string, _kw: string, pattern: string) => {
        compact();
        const wildcard = pattern.replace(/\*/g, '');
        const keys = [...store.keys()].filter((k) =>
          wildcard ? k.startsWith(wildcard) : true,
        );
        return [cursor === '0' ? '0' : '0', keys] as [string, string[]];
      },
      mget: async (...keys: string[]) =>
        keys.map((k) => store.get(k)?.value ?? null),
    }),
  };
  return {
    redis: fakeService as unknown as RedisService,
    store,
    tickSeconds: (sec: number) => {
      now += sec;
    },
  };
}

function makeConfigService(allowList = ''): any {
  return {
    get: (key: string) => (key === 'WAF_ALLOWLIST' ? allowList : undefined),
  } as unknown as ConfigService;
}

interface FakeRequest {
  ip?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface CtxWithFinish {
  ctx: ExecutionContext;
  triggerFinish: () => void;
}

function makeCtx(request: FakeRequest): ExecutionContext {
  return makeCtxWithFinish(request).ctx;
}

function makeCtxWithFinish(request: FakeRequest): CtxWithFinish {
  const finishHandlers: Array<(...args: unknown[]) => void> = [];
  const response = {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'finish' || event === 'close') {
        finishHandlers.push(cb);
      }
    },
  };
  const ctx = {
    getType: () => 'http' as any,
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: () => ({}) as any,
    }),
    getHandler: () => function () {} as any,
    getClass: () => class {} as any,
  } as unknown as ExecutionContext;
  const triggerFinish = () => {
    // Fire each finish handler exactly once and then drop them so a
    // double-finish doesn't double-decrement.
    const handlers = finishHandlers.splice(0);
    for (const cb of handlers) cb();
  };
  return { ctx, triggerFinish };
}

function makeFakePrisma(): {
  prisma: PrismaClient;
  audit: jest.Mock;
} {
  const audit = jest.fn(async () => undefined);
  const prisma = {
    adminAuditLog: { create: audit },
  } as unknown as PrismaClient;
  return { prisma, audit };
}

async function expectForbidden(
  promise: Promise<unknown> | unknown,
): Promise<HttpException> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const httpErr = caught as HttpException;
  expect(httpErr.getStatus()).toBe(HttpStatus.FORBIDDEN);
  return httpErr;
}

describe('ThreatProtectionGuard', () => {
  // ===================================================================
  // Signature blocking
  // ===================================================================

  describe('signature blocking', () => {
    it('blocks requests with SQL injection in the URL with 403 + audit log', async () => {
      const fake = makeFakeRedis();
      const { prisma, audit } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '203.0.113.10',
        method: 'GET',
        url: "/courses?id=1' OR 1=1 --",
        headers: { 'user-agent': 'curl/8' },
      });

      const httpErr = await expectForbidden(guard.canActivate(ctx));
      expect((httpErr.getResponse() as any).code).toBe('WAF_BLOCKED');
      expect(audit).toHaveBeenCalledTimes(1);
      const auditPayload = audit.mock.calls[0]![0].data;
      expect(auditPayload.action).toBe('waf.request.blocked');
      expect(auditPayload.target).toBe('203.0.113.10');
      expect(auditPayload.payload.category).toBe('SQL_INJECTION');
    });

    it('blocks XSS payloads in the body with 403', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '203.0.113.11',
        method: 'POST',
        url: '/posts',
        headers: { 'content-type': 'application/json' },
        body: { content: '<script>alert(1)</script>' },
      });
      await expectForbidden(guard.canActivate(ctx));
    });

    it('blocks suspicious user agents (sqlmap)', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '203.0.113.12',
        method: 'GET',
        url: '/',
        headers: { 'user-agent': 'sqlmap/1.5' },
      });
      const err = await expectForbidden(guard.canActivate(ctx));
      expect((err.getResponse() as any).signatureId).toBe('ua.sqlmap');
    });

    it('blocks path traversal attempts', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '203.0.113.13',
        method: 'GET',
        url: '/files/../../etc/passwd',
        headers: {},
      });
      await expectForbidden(guard.canActivate(ctx));
    });

    it('repeatedly hitting signatures from same IP triggers a persistent block', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ip = '203.0.113.14';
      // Trigger 3 signature hits — at threshold the IP is blocked.
      for (
        let i = 0;
        i < THREAT_PROTECTION_CONSTANTS.REPEAT_OFFENDER_THRESHOLD;
        i++
      ) {
        const ctx = makeCtx({
          ip,
          method: 'GET',
          url: '/courses?id=1 UNION SELECT 1',
          headers: {},
        });
        await expectForbidden(guard.canActivate(ctx));
      }

      const block = await service.getBlockEntry(ip);
      expect(block).not.toBeNull();
      expect(block!.reason).toBe('SIGNATURE_MATCH');
    });

    it('subsequent traffic from a blocked IP is rejected with IP_BLOCKED', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ip = '203.0.113.15';
      await service.blockIp(ip, 'MANUAL_BLOCK', 600);

      const ctx = makeCtx({
        ip,
        method: 'GET',
        url: '/healthz',
        headers: {},
      });
      const err = await expectForbidden(guard.canActivate(ctx));
      expect((err.getResponse() as any).code).toBe('IP_BLOCKED');
    });
  });

  // ===================================================================
  // Rate-based blocking
  // ===================================================================

  describe('rate-based IP blocking', () => {
    it('blocks the IP after BURST_REQUESTS in the burst window', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ip = '203.0.113.30';
      // Exhaust the burst budget — every prior request should pass.
      // We fire the response finish handler after each request so the
      // concurrent-connection counter decrements between iterations
      // and the burst counter is the only thing accumulating.
      for (let i = 0; i < THREAT_PROTECTION_CONSTANTS.BURST_REQUESTS; i++) {
        const { ctx, triggerFinish } = makeCtxWithFinish({
          ip,
          method: 'GET',
          url: '/',
          headers: {},
        });
        const allowed = await guard.canActivate(ctx);
        expect(allowed).toBe(true);
        triggerFinish();
        // Wait one microtask so the async `release` lands before the
        // next acquire.
        await Promise.resolve();
      }
      // The next request crosses the threshold and should 403 with
      // RATE_LIMIT_BURST.
      const { ctx: ctxBlocked, triggerFinish: tfBlocked } = makeCtxWithFinish({
        ip,
        method: 'GET',
        url: '/',
        headers: {},
      });
      const err = await expectForbidden(guard.canActivate(ctxBlocked));
      tfBlocked();
      expect((err.getResponse() as any).reason).toBe('RATE_LIMIT_BURST');

      // Block must now be persistent — the next request still hits 403.
      const ctxAfter = makeCtx({
        ip,
        method: 'GET',
        url: '/',
        headers: {},
      });
      const errAfter = await expectForbidden(guard.canActivate(ctxAfter));
      expect((errAfter.getResponse() as any).code).toBe('IP_BLOCKED');
    });
  });

  // ===================================================================
  // Allow-list bypass
  // ===================================================================

  describe('allow-list bypass', () => {
    it('lets allow-listed IPs bypass signature inspection', async () => {
      const fake = makeFakeRedis();
      const { prisma, audit } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService('10.0.0.0/8'),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '10.5.6.7',
        method: 'GET',
        url: "/courses?id=1' OR 1=1 --",
        headers: {},
      });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(audit).not.toHaveBeenCalled();
    });

    it('lets allow-listed IPs bypass even if previously blocklisted', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService('10.0.0.0/8'),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      // Manually add the IP to the blocklist — allow-list still wins.
      await service.blockIp('10.5.6.7', 'MANUAL_BLOCK', 600);

      const ctx = makeCtx({
        ip: '10.5.6.7',
        method: 'GET',
        url: '/healthz',
        headers: {},
      });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    });

    it('treats loopback addresses as implicit allow-list entries', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '127.0.0.1',
        method: 'GET',
        url: "/courses?id=1' OR 1=1 --",
        headers: {},
      });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    });
  });

  // ===================================================================
  // Misc
  // ===================================================================

  describe('misc', () => {
    it('lets clean traffic through with canActivate=true', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        ip: '203.0.113.50',
        method: 'GET',
        url: '/courses/python-101',
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
        },
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('extracts IP from x-forwarded-for when present', async () => {
      const fake = makeFakeRedis();
      const { prisma } = makeFakePrisma();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );
      const guard = new ThreatProtectionGuard(service, prisma);

      const ctx = makeCtx({
        method: 'GET',
        url: "/courses?id=1' OR 1=1 --",
        headers: { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
      });
      const err = await expectForbidden(guard.canActivate(ctx));
      expect((err.getResponse() as any).code).toBe('WAF_BLOCKED');
      // The audit-log should record the upstream-most IP, not the proxy.
      const fetched = await service.getBlockEntry('203.0.113.99');
      // Single hit — not enough to trigger persistent block, so null.
      expect(fetched).toBeNull();
    });
  });
});
