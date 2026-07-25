import { IpBlocklistService } from './ip-blocklist.service';

/**
 * Unit tests for `IpBlocklistService` (Task 27.5, Req 27.8 / 27.10).
 *
 * Covers:
 *   - block / unblock / isBlocked round-trip with TTL and reason.
 *   - SET membership maintained alongside per-IP keys.
 *   - blockBulk pipelines multiple IPs in one call.
 *   - fail-open posture when Redis is unavailable.
 *   - getBlockStatus surfaces reason / source / expiresAt.
 */

interface KvEntry {
  value: string;
  expiresAt: number | null;
}
interface SetEntry {
  members: Set<string>;
}

class FakeRedis {
  private kv = new Map<string, KvEntry>();
  private sets = new Map<string, SetEntry>();
  errorMode = false;

  readonly client = {
    set: jest.fn(
      async (
        key: string,
        value: string,
        _mode?: string,
        ttl?: number,
      ): Promise<'OK'> => {
        if (this.errorMode) throw new Error('redis down');
        this.kv.set(key, {
          value,
          expiresAt: ttl !== undefined ? Date.now() + ttl * 1000 : null,
        });
        return 'OK';
      },
    ),
    get: jest.fn(async (key: string): Promise<string | null> => {
      if (this.errorMode) throw new Error('redis down');
      const entry = this.kv.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        this.kv.delete(key);
        return null;
      }
      return entry.value;
    }),
    del: jest.fn(async (key: string): Promise<number> => {
      if (this.errorMode) throw new Error('redis down');
      return this.kv.delete(key) ? 1 : 0;
    }),
    ttl: jest.fn(async (key: string): Promise<number> => {
      if (this.errorMode) throw new Error('redis down');
      const entry = this.kv.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.ceil((entry.expiresAt - Date.now()) / 1000);
    }),
    sadd: jest.fn(async (key: string, member: string): Promise<number> => {
      if (this.errorMode) throw new Error('redis down');
      const set = this.sets.get(key) ?? { members: new Set<string>() };
      const isNew = !set.members.has(member);
      set.members.add(member);
      this.sets.set(key, set);
      return isNew ? 1 : 0;
    }),
    srem: jest.fn(async (key: string, member: string): Promise<number> => {
      if (this.errorMode) throw new Error('redis down');
      const set = this.sets.get(key);
      if (!set) return 0;
      const removed = set.members.delete(member);
      return removed ? 1 : 0;
    }),
    smembers: jest.fn(async (key: string): Promise<string[]> => {
      if (this.errorMode) throw new Error('redis down');
      return Array.from(this.sets.get(key)?.members ?? []);
    }),
    pipeline: jest.fn(() => {
      const ops: Array<() => Promise<unknown>> = [];
      const builder = {
        set: (
          key: string,
          value: string,
          _mode?: string,
          ttl?: number,
        ) => {
          ops.push(() => this.client.set(key, value, _mode, ttl));
          return builder;
        },
        sadd: (key: string, member: string) => {
          ops.push(() => this.client.sadd(key, member));
          return builder;
        },
        exec: async () => {
          for (const op of ops) await op();
          return [];
        },
      };
      return builder;
    }),
  };

  getClient(): typeof this.client {
    return this.client;
  }

  /** Surface for assertions. */
  raw(key: string): KvEntry | undefined {
    return this.kv.get(key);
  }

  setMembers(key: string): Set<string> {
    return this.sets.get(key)?.members ?? new Set<string>();
  }
}

// ---------------------------------------------------------------------

describe('IpBlocklistService — block / unblock / isBlocked', () => {
  it('round-trips block → isBlocked → unblock', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    expect(await service.isBlocked('203.0.113.1')).toBe(false);

    await service.block('203.0.113.1', 60, 'manual block', 'manual');
    expect(await service.isBlocked('203.0.113.1')).toBe(true);

    await service.unblock('203.0.113.1');
    expect(await service.isBlocked('203.0.113.1')).toBe(false);
  });

  it('persists reason / source / TTL via the per-IP key', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    await service.block('198.51.100.5', 600, 'honeypot bait', 'honeypot');
    const status = await service.getBlockStatus('198.51.100.5');

    expect(status.blocked).toBe(true);
    expect(status.reason).toBe('honeypot bait');
    expect(status.source).toBe('honeypot');
    expect(status.expiresAt).toEqual(expect.any(Number));
    // TTL respected — expiresAt should be ~600s in the future.
    const delta = (status.expiresAt ?? 0) - Date.now();
    expect(delta).toBeGreaterThan(550_000);
    expect(delta).toBeLessThanOrEqual(600_000);
  });

  it('keeps the central SET in sync', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    await service.block('203.0.113.7', 60, 'manual', 'manual');
    await service.block('203.0.113.8', 60, 'manual', 'manual');

    const set = redis.setMembers(IpBlocklistService.SET_KEY);
    expect(set.has('203.0.113.7')).toBe(true);
    expect(set.has('203.0.113.8')).toBe(true);

    await service.unblock('203.0.113.7');
    expect(redis.setMembers(IpBlocklistService.SET_KEY).has('203.0.113.7')).toBe(
      false,
    );
  });

  it('rejects empty / unknown IPs (cannot block "unknown")', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    expect(await service.block('unknown', 60, 'foo', 'bar')).toBe(false);
    expect(await service.block('', 60, 'foo', 'bar')).toBe(false);
    expect(redis.client.set).not.toHaveBeenCalled();
  });
});

describe('IpBlocklistService — bulk import', () => {
  it('writes every IP in a single pipeline pass', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    const count = await service.blockBulk(
      ['203.0.113.10', '203.0.113.11', '203.0.113.12'],
      3600,
      'feed sync',
      'threat_intel:test',
    );

    expect(count).toBe(3);
    expect(redis.client.pipeline).toHaveBeenCalledTimes(1);
    expect(await service.isBlocked('203.0.113.11')).toBe(true);
  });

  it('skips empty / unknown entries inside a bulk pass', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    const count = await service.blockBulk(
      ['203.0.113.20', '', '   ', 'unknown', '203.0.113.21'],
      60,
      'feed',
      'src',
    );

    expect(count).toBe(2);
    expect(await service.isBlocked('203.0.113.20')).toBe(true);
    expect(await service.isBlocked('203.0.113.21')).toBe(true);
  });
});

describe('IpBlocklistService — fail-open posture', () => {
  it('returns false on isBlocked when Redis throws', async () => {
    const redis = new FakeRedis();
    redis.errorMode = true;
    const service = new IpBlocklistService(redis as never);

    expect(await service.isBlocked('203.0.113.30')).toBe(false);
  });

  it('returns false on block when Redis is unavailable', async () => {
    const service = new IpBlocklistService();

    expect(await service.block('203.0.113.31', 60, 'foo', 'bar')).toBe(false);
    expect(await service.isBlocked('203.0.113.31')).toBe(false);
  });

  it('returns blocked: false when getBlockStatus encounters a Redis error', async () => {
    const redis = new FakeRedis();
    redis.errorMode = true;
    const service = new IpBlocklistService(redis as never);

    const status = await service.getBlockStatus('203.0.113.32');
    expect(status.blocked).toBe(false);
  });

  it('returns [] on listBlocked when Redis is unavailable', async () => {
    const service = new IpBlocklistService();

    expect(await service.listBlocked()).toEqual([]);
  });
});

describe('IpBlocklistService — listBlocked', () => {
  it('returns every currently-blocked IP with its reason / source / expiry', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    await service.block('100.64.0.5', 600, 'honeypot bait', 'honeypot');
    await service.block('198.51.100.9', 3600, 'threat intel feed', 'threat_intel');

    const entries = await service.listBlocked();
    const byIp = Object.fromEntries(entries.map((e) => [e.ip, e]));

    expect(entries).toHaveLength(2);
    expect(byIp['100.64.0.5']).toMatchObject({
      blocked: true,
      reason: 'honeypot bait',
      source: 'honeypot',
    });
    expect(byIp['198.51.100.9']).toMatchObject({
      blocked: true,
      reason: 'threat intel feed',
      source: 'threat_intel',
    });
  });

  it('drops a SET member whose per-IP key already expired', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    await service.block('203.0.113.40', 60, 'stale', 'manual');
    await service.unblock('203.0.113.40');
    // Simulate a SET entry left behind without its per-IP key —
    // the shadow index is best-effort per the class doc.
    (redis as any).sets.set(IpBlocklistService.SET_KEY, {
      members: new Set(['203.0.113.40']),
    });

    const entries = await service.listBlocked();
    expect(entries).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);

    await service.blockBulk(
      ['203.0.113.50', '203.0.113.51', '203.0.113.52'],
      60,
      'feed',
      'threat_intel',
    );

    const entries = await service.listBlocked(2);
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('returns [] when Redis throws', async () => {
    const redis = new FakeRedis();
    const service = new IpBlocklistService(redis as never);
    await service.block('203.0.113.60', 60, 'x', 'manual');
    redis.errorMode = true;

    expect(await service.listBlocked()).toEqual([]);
  });
});
