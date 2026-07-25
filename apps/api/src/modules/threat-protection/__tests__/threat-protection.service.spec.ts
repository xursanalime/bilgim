import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../../infra/redis/redis.service';
import {
  THREAT_PROTECTION_CONSTANTS,
  ThreatProtectionService,
} from '../threat-protection.service';

/**
 * In-memory stand-in for `RedisService`. Implements just enough of the
 * surface used by `ThreatProtectionService` (set with TTL, get, del,
 * incr, expire, decr, scan + mget) to exercise the WAF logic without
 * a live Redis. Time is virtual: every call advances the simulated
 * clock by 0 seconds; tests use `tickSeconds()` to expire entries.
 */
function makeFakeRedis() {
  type Entry = { value: string; expiresAt: number | null };
  const store = new Map<string, Entry>();

  let now = 1_000_000;
  const getNow = () => now;
  const isExpired = (entry: Entry) =>
    entry.expiresAt !== null && entry.expiresAt <= now;
  const compact = () => {
    for (const [k, v] of store) {
      if (isExpired(v)) store.delete(k);
    }
  };

  const fakeService = {
    get: jest.fn(async (key: string) => {
      compact();
      const entry = store.get(key);
      if (!entry) return null;
      return entry.value;
    }),
    set: jest.fn(async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt =
        typeof ttlSeconds === 'number' ? now + ttlSeconds : null;
      store.set(key, { value, expiresAt });
    }),
    del: jest.fn(async (key: string) => {
      compact();
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    }),
    exists: jest.fn(async (key: string) => {
      compact();
      return store.has(key);
    }),
    incr: jest.fn(async (key: string) => {
      compact();
      const entry = store.get(key);
      const current = entry ? Number(entry.value) || 0 : 0;
      const next = current + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    }),
    expire: jest.fn(async (key: string, ttlSeconds: number) => {
      const entry = store.get(key);
      if (!entry) return;
      entry.expiresAt = now + ttlSeconds;
    }),
    setnx: jest.fn(),
    getClient: () =>
      ({
        scan: async (
          cursor: string,
          _matchKw: string,
          pattern: string,
          _countKw: string,
          _count: number,
        ) => {
          compact();
          // Return all matching keys in a single page — good enough for
          // unit tests; integration coverage exercises real SCAN.
          const wildcard = pattern.replace(/\*/g, '');
          const keys = [...store.keys()].filter((k) =>
            wildcard ? k.startsWith(wildcard) : true,
          );
          return [cursor === '0' ? '0' : '0', keys] as [string, string[]];
        },
        mget: async (...keys: string[]) => {
          compact();
          return keys.map((k) => store.get(k)?.value ?? null);
        },
        decr: async (key: string) => {
          compact();
          const entry = store.get(key);
          const current = entry ? Number(entry.value) || 0 : 0;
          const next = current - 1;
          store.set(key, {
            value: String(next),
            expiresAt: entry?.expiresAt ?? null,
          });
          return next;
        },
      } as any),
  };

  return {
    redis: fakeService as unknown as RedisService,
    store,
    getNow,
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

describe('ThreatProtectionService', () => {
  // ===================================================================
  // Signature inspection
  // ===================================================================

  describe('signature inspection', () => {
    let service: ThreatProtectionService;

    beforeEach(() => {
      service = new ThreatProtectionService(undefined, makeConfigService());
    });

    it('detects classic UNION SELECT SQL injection in the URL', () => {
      const detection = service.inspect({
        method: 'GET',
        url: "/courses?id=1 UNION SELECT password FROM users",
        headers: {},
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('SQL_INJECTION');
      expect(detection!.signatureId).toBe('sqli.union_select');
    });

    it('detects boolean-based SQL injection (OR 1=1)', () => {
      const detection = service.inspect({
        method: 'POST',
        url: '/auth/login',
        headers: {},
        body: { email: "admin' OR 1=1 --", password: 'x' },
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('SQL_INJECTION');
    });

    it('detects sqli.function_call (sleep, benchmark)', () => {
      const detection = service.inspect({
        method: 'GET',
        url: '/courses?id=1; SELECT pg_sleep(10);',
        headers: {},
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('SQL_INJECTION');
    });

    it('detects <script> XSS payloads in the body', () => {
      const detection = service.inspect({
        method: 'POST',
        url: '/posts',
        headers: { 'content-type': 'application/json' },
        body: { content: '<script>alert(1)</script>' },
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('XSS');
      expect(detection!.signatureId).toBe('xss.script_tag');
    });

    it('detects javascript: URI XSS payloads', () => {
      const detection = service.inspect({
        method: 'POST',
        url: '/posts',
        headers: {},
        body: { link: 'javascript:alert(1)' },
      });
      expect(detection).not.toBeNull();
      expect(detection!.signatureId).toBe('xss.javascript_uri');
    });

    it('detects on-event handler XSS payloads', () => {
      const detection = service.inspect({
        method: 'POST',
        url: '/posts',
        headers: {},
        body: { content: '<img src=x onerror=alert(1)>' },
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('XSS');
    });

    it('detects ../ path-traversal in URLs', () => {
      const detection = service.inspect({
        method: 'GET',
        url: '/files/../../../etc/passwd',
        headers: {},
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('PATH_TRAVERSAL');
    });

    it('detects URL-encoded path traversal', () => {
      const detection = service.inspect({
        method: 'GET',
        url: '/files/%2e%2e%2f%2e%2e%2fetc/passwd',
        headers: {},
      });
      expect(detection).not.toBeNull();
      expect(detection!.category).toBe('PATH_TRAVERSAL');
    });

    it.each([
      ['sqlmap', 'sqlmap/1.0 (https://sqlmap.org)'],
      ['nikto', 'Mozilla/5.0 (Nikto/2.1.6)'],
      ['nessus', 'Nessus/10.0'],
      ['masscan', 'masscan/1.3.2'],
      ['acunetix', 'Acunetix WVS'],
    ])(
      'detects suspicious user agent: %s',
      (_label: string, userAgent: string) => {
        const detection = service.inspect({
          method: 'GET',
          url: '/',
          headers: { 'user-agent': userAgent },
        });
        expect(detection).not.toBeNull();
        expect(detection!.category).toBe('SUSPICIOUS_USER_AGENT');
      },
    );

    it('lets clean traffic through', () => {
      const detection = service.inspect({
        method: 'GET',
        url: '/courses/python-101',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36',
        },
      });
      expect(detection).toBeNull();
    });

    it('does not match the word "select" in regular content (no false positive)', () => {
      const detection = service.inspect({
        method: 'POST',
        url: '/posts',
        headers: {},
        body: {
          content:
            'Please select your favorite programming language from the menu.',
        },
      });
      expect(detection).toBeNull();
    });

    it('skips Authorization header content (no false positives, no leak)', () => {
      const detection = service.inspect({
        method: 'GET',
        url: '/me',
        headers: {
          authorization: 'Bearer SELECT * FROM tokens',
        },
      });
      // The Authorization header is excluded from the inspection
      // surface, so the SQL-shaped token does not trip the WAF.
      expect(detection).toBeNull();
    });
  });

  // ===================================================================
  // Allow-list
  // ===================================================================

  describe('allow-list', () => {
    it('parses CIDR ranges and matches IPs inside them', () => {
      const service = new ThreatProtectionService(
        undefined,
        makeConfigService('10.0.0.0/8, 192.168.1.0/24'),
      );
      expect(service.isAllowed('10.5.6.7')).toBe(true);
      expect(service.isAllowed('192.168.1.42')).toBe(true);
      expect(service.isAllowed('192.168.2.42')).toBe(false);
      expect(service.isAllowed('8.8.8.8')).toBe(false);
    });

    it('always allow-lists loopback', () => {
      const service = new ThreatProtectionService(
        undefined,
        makeConfigService(''),
      );
      expect(service.isAllowed('127.0.0.1')).toBe(true);
      expect(service.isAllowed('::1')).toBe(true);
    });

    it('matches a single-IP allow-list entry exactly', () => {
      const service = new ThreatProtectionService(
        undefined,
        makeConfigService('203.0.113.5'),
      );
      expect(service.isAllowed('203.0.113.5')).toBe(true);
      expect(service.isAllowed('203.0.113.6')).toBe(false);
    });

    it('drops invalid CIDR entries (e.g. /99) without widening the list', () => {
      const service = new ThreatProtectionService(
        undefined,
        makeConfigService('10.0.0.0/99,not-an-ip,8.8.8.8'),
      );
      expect(service.isAllowed('10.0.0.1')).toBe(false);
      expect(service.isAllowed('8.8.8.8')).toBe(true);
    });
  });

  // ===================================================================
  // Burst counter
  // ===================================================================

  describe('rate-based blocking', () => {
    it('increments the burst counter on every recordRequest call', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      const ip = '203.0.113.10';
      const counts: number[] = [];
      for (let i = 0; i < 5; i++) {
        counts.push(await service.recordRequest(ip));
      }
      expect(counts).toEqual([1, 2, 3, 4, 5]);
      // TTL should be set on the first hit so the counter expires.
      expect(fake.redis.expire).toHaveBeenCalledWith(
        `waf:burst:${ip}`,
        THREAT_PROTECTION_CONSTANTS.BURST_WINDOW_SEC,
      );
    });

    it('blockIp + getBlockEntry round-trip the entry through Redis', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      const entry = await service.blockIp('1.2.3.4', 'RATE_LIMIT_BURST', 600);
      expect(entry).not.toBeNull();
      expect(entry!.reason).toBe('RATE_LIMIT_BURST');

      const fetched = await service.getBlockEntry('1.2.3.4');
      expect(fetched).toEqual(entry);
    });

    // Regression for the 2026-07-25 outage: every browser request is
    // proxied by the BFF, so its private address stands in for the whole
    // user base. A block landing there takes the platform offline.
    it.each([
      ['100.64.0.5', "Railway's private network / CGNAT"],
      ['10.0.0.7', 'RFC1918'],
      ['192.168.1.20', 'RFC1918'],
    ])('blockIp refuses to block %s (%s)', async (ip) => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      expect(await service.blockIp(ip, 'RATE_LIMIT_BURST', 600)).toBeNull();
      expect(await service.getBlockEntry(ip)).toBeNull();
    });

    it('getBlockEntry ignores a pre-existing entry on an infrastructure address', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      // Simulate an entry written before the write-side guard existed.
      await fake.redis.set(
        'waf:blocked:100.64.0.5',
        JSON.stringify({
          ip: '100.64.0.5',
          reason: 'RATE_LIMIT_BURST',
          blockedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        600,
      );

      expect(await service.getBlockEntry('100.64.0.5')).toBeNull();
    });

    it('getBlockEntry returns null after the TTL elapses', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      await service.blockIp('1.2.3.4', 'RATE_LIMIT_BURST', 60);
      fake.tickSeconds(120);
      const fetched = await service.getBlockEntry('1.2.3.4');
      expect(fetched).toBeNull();
    });

    it('unblockIp removes the entry', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      await service.blockIp('1.2.3.4', 'MANUAL_BLOCK', 600);
      const removed = await service.unblockIp('1.2.3.4');
      expect(removed).toBe(true);
      expect(await service.getBlockEntry('1.2.3.4')).toBeNull();
    });

    it('listBlockedIps returns every active entry', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      await service.blockIp('1.1.1.1', 'RATE_LIMIT_BURST', 600);
      await service.blockIp('2.2.2.2', 'SIGNATURE_MATCH', 600, {
        signatureId: 'sqli.union_select',
      });
      await service.blockIp('3.3.3.3', 'CONNECTION_FLOOD', 600);

      const list = await service.listBlockedIps();
      const ips = list.map((e) => e.ip).sort();
      expect(ips).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3']);

      const sqlEntry = list.find((e) => e.ip === '2.2.2.2');
      expect(sqlEntry?.signatureId).toBe('sqli.union_select');
    });

    it('connection counter increments on acquire and decrements on release', async () => {
      const fake = makeFakeRedis();
      const service = new ThreatProtectionService(
        fake.redis,
        makeConfigService(),
      );

      const ip = '203.0.113.20';
      expect(await service.acquireConnection(ip)).toBe(1);
      expect(await service.acquireConnection(ip)).toBe(2);
      expect(await service.acquireConnection(ip)).toBe(3);
      await service.releaseConnection(ip);
      // Acquire again — counter should now be 3 (was 2 after release).
      expect(await service.acquireConnection(ip)).toBe(3);
    });
  });

  // ===================================================================
  // Fail-open behaviour
  // ===================================================================

  describe('fail-open posture on Redis outage', () => {
    it('returns 0 from recordRequest when Redis throws', async () => {
      const broken = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        incr: jest.fn(async () => {
          throw new Error('redis is down');
        }),
        expire: jest.fn(),
        getClient: () => ({}),
      } as unknown as RedisService;
      const service = new ThreatProtectionService(broken, makeConfigService());
      expect(await service.recordRequest('1.2.3.4')).toBe(0);
    });

    it('returns null from getBlockEntry when Redis throws', async () => {
      const broken = {
        get: jest.fn(async () => {
          throw new Error('redis is down');
        }),
      } as unknown as RedisService;
      const service = new ThreatProtectionService(broken, makeConfigService());
      expect(await service.getBlockEntry('1.2.3.4')).toBeNull();
    });
  });
});
