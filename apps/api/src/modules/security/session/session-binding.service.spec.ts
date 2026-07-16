import { SessionBindingService } from './session-binding.service';
import type { SessionBindingMeta, SessionValidationResult } from './session-binding.service';
import fc from 'fast-check';

/**
 * Unit tests for `SessionBindingService` (Task 29.2, Req 29.2, 29.3, 29.9, 29.10).
 *
 * Covers:
 *   - Session binding: IP + User-Agent stored at login.
 *   - Session validation: IP or UA change → invalidation.
 *   - Trusted device management: add, remove, eviction.
 *   - New device login: confirmation token flow.
 *   - Session fixation protection: unique session IDs.
 *   - Fail-open when Redis is unavailable.
 */

// ─── Fake Redis ──────────────────────────────────────────────────

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  errorMode = false;

  async get(key: string): Promise<string | null> {
    if (this.errorMode) throw new Error('redis down');
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.errorMode) throw new Error('redis down');
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    if (this.errorMode) throw new Error('redis down');
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    if (this.errorMode) throw new Error('redis down');
    return this.store.has(key);
  }

  /** Expose store size for assertions. */
  get size(): number {
    return this.store.size;
  }

  /** Check if a key exists in the store. */
  has(key: string): boolean {
    return this.store.has(key);
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('SessionBindingService — session binding (Req 29.3)', () => {
  let redis: FakeRedis;
  let service: SessionBindingService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new SessionBindingService(redis as never);
  });

  it('binds session metadata (IP + UA) at login time', async () => {
    await service.bindSession('sess-1', {
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0 Chrome/120',
      userId: 'user-1',
    });

    const binding = await service.getSessionBinding('sess-1');
    expect(binding).not.toBeNull();
    expect(binding!.ip).toBe('192.168.1.1');
    expect(binding!.userAgent).toBe('Mozilla/5.0 Chrome/120');
    expect(binding!.userId).toBe('user-1');
    expect(binding!.createdAt).toEqual(expect.any(Number));
  });

  it('validates session when IP and UA match', async () => {
    await service.bindSession('sess-2', {
      ip: '10.0.0.1',
      userAgent: 'Firefox/119',
      userId: 'user-2',
    });

    const result = await service.validateSession('sess-2', '10.0.0.1', 'Firefox/119');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('Property 24: invalidates session on IP or User-Agent change', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        fc.string(),
        fc.ipV4(),
        fc.string(),
        async (ip1, ua1, ip2, ua2) => {
          fc.pre(ip1 !== ip2 || ua1 !== ua2);
          const sessionId = `sess-${Math.random()}`;
          await service.bindSession(sessionId, {
            ip: ip1,
            userAgent: ua1,
            userId: 'prop-user',
          });

          const result = await service.validateSession(sessionId, ip2, ua2);
          expect(result.valid).toBe(false);
          expect(result.reason).toMatch(/_CHANGED/);
        },
      ),
    );
  });

  it('invalidates session when IP changes', async () => {
    await service.bindSession('sess-3', {
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
      userId: 'user-3',
    });

    const result = await service.validateSession('sess-3', '192.168.1.99', 'Chrome/120');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('IP_CHANGED');

    // Session should be removed from Redis
    const binding = await service.getSessionBinding('sess-3');
    expect(binding).toBeNull();
  });

  it('invalidates session when User-Agent changes', async () => {
    await service.bindSession('sess-4', {
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
      userId: 'user-4',
    });

    const result = await service.validateSession('sess-4', '10.0.0.1', 'Firefox/119');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('USER_AGENT_CHANGED');
  });

  it('returns SESSION_NOT_FOUND for unknown session IDs', async () => {
    const result = await service.validateSession('nonexistent', '10.0.0.1', 'Chrome');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('SESSION_NOT_FOUND');
  });

  it('invalidateSession removes the binding', async () => {
    await service.bindSession('sess-5', {
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
      userId: 'user-5',
    });

    await service.invalidateSession('sess-5');
    const binding = await service.getSessionBinding('sess-5');
    expect(binding).toBeNull();
  });
});

describe('SessionBindingService — trusted devices (Req 29.2)', () => {
  let redis: FakeRedis;
  let service: SessionBindingService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new SessionBindingService(redis as never);
  });

  it('reports device as untrusted when no devices registered', async () => {
    const trusted = await service.isDeviceTrusted('user-1', 'fp-abc123');
    expect(trusted).toBe(false);
  });

  it('trusts a device and reports it as trusted', async () => {
    await service.trustDevice('user-1', {
      deviceId: 'fp-abc123',
      deviceName: 'Chrome on Windows',
      ip: '10.0.0.1',
    });

    const trusted = await service.isDeviceTrusted('user-1', 'fp-abc123');
    expect(trusted).toBe(true);
  });

  it('untrusts a device', async () => {
    await service.trustDevice('user-1', {
      deviceId: 'fp-abc123',
      deviceName: 'Chrome on Windows',
      ip: '10.0.0.1',
    });

    const removed = await service.untrustDevice('user-1', 'fp-abc123');
    expect(removed).toBe(true);

    const trusted = await service.isDeviceTrusted('user-1', 'fp-abc123');
    expect(trusted).toBe(false);
  });

  it('returns false when untrusting a non-existent device', async () => {
    const removed = await service.untrustDevice('user-1', 'nonexistent');
    expect(removed).toBe(false);
  });

  it('evicts oldest device when exceeding MAX_TRUSTED_DEVICES (10)', async () => {
    // Add 11 devices — the first one should be evicted
    for (let i = 0; i < 11; i++) {
      await service.trustDevice('user-1', {
        deviceId: `device-${i}`,
        deviceName: `Device ${i}`,
        ip: `10.0.0.${i}`,
      });
    }

    const devices = await service.getTrustedDevices('user-1');
    expect(devices.length).toBe(10);

    // device-0 should have been evicted (oldest)
    const hasFirst = devices.some((d) => d.deviceId === 'device-0');
    expect(hasFirst).toBe(false);

    // device-10 (newest) should be present
    const hasLast = devices.some((d) => d.deviceId === 'device-10');
    expect(hasLast).toBe(true);
  });

  it('updates lastSeenAt when touching a device', async () => {
    await service.trustDevice('user-1', {
      deviceId: 'fp-abc',
      deviceName: 'Chrome',
      ip: '10.0.0.1',
    });

    const before = await service.getTrustedDevices('user-1');
    const originalLastSeen = before[0]!.lastSeenAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    await service.touchDevice('user-1', 'fp-abc');

    const after = await service.getTrustedDevices('user-1');
    expect(after[0]!.lastSeenAt).toBeGreaterThanOrEqual(originalLastSeen);
  });
});

describe('SessionBindingService — new device login (Req 29.9)', () => {
  let redis: FakeRedis;
  let service: SessionBindingService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new SessionBindingService(redis as never);
  });

  it('generates a confirmation token for new device login', async () => {
    const token = await service.handleNewDeviceLogin(
      'user-1',
      'user@example.com',
      { deviceId: 'fp-new', deviceName: 'Firefox on Linux', ip: '10.0.0.5' },
    );

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('confirms a device using the token and adds to trusted list', async () => {
    const token = await service.handleNewDeviceLogin(
      'user-1',
      'user@example.com',
      { deviceId: 'fp-new', deviceName: 'Firefox on Linux', ip: '10.0.0.5' },
    );

    const result = await service.confirmDevice(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-1');
    expect(result!.deviceId).toBe('fp-new');

    // Device should now be trusted
    const trusted = await service.isDeviceTrusted('user-1', 'fp-new');
    expect(trusted).toBe(true);
  });

  it('returns null for invalid/expired confirmation token', async () => {
    const result = await service.confirmDevice('invalid-token');
    expect(result).toBeNull();
  });

  it('confirmation token is one-time use', async () => {
    const token = await service.handleNewDeviceLogin(
      'user-1',
      'user@example.com',
      { deviceId: 'fp-new', deviceName: 'Chrome', ip: '10.0.0.1' },
    );

    // First use succeeds
    const first = await service.confirmDevice(token);
    expect(first).not.toBeNull();

    // Second use fails
    const second = await service.confirmDevice(token);
    expect(second).toBeNull();
  });
});

describe('SessionBindingService — session fixation protection (Req 29.10)', () => {
  it('generates unique session IDs', () => {
    const service = new SessionBindingService();
    const id1 = service.generateSessionId();
    const id2 = service.generateSessionId();

    expect(id1).not.toBe(id2);
    // 32 bytes hex = 64 characters
    expect(id1.length).toBe(64);
    expect(id2.length).toBe(64);
  });

  it('generates cryptographically random session IDs (hex format)', () => {
    const service = new SessionBindingService();
    const id = service.generateSessionId();

    // Should be valid hex
    expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
  });
});

describe('SessionBindingService — fail-open posture', () => {
  it('returns valid=true when Redis is unavailable', async () => {
    const service = new SessionBindingService(); // no redis
    const result = await service.validateSession('any', '10.0.0.1', 'Chrome');
    expect(result.valid).toBe(true);
  });

  it('reports device as trusted when Redis is unavailable', async () => {
    const service = new SessionBindingService(); // no redis
    const trusted = await service.isDeviceTrusted('user-1', 'fp-abc');
    expect(trusted).toBe(true);
  });

  it('bindSession is a no-op when Redis is unavailable', async () => {
    const service = new SessionBindingService(); // no redis
    // Should not throw
    await service.bindSession('sess-1', {
      ip: '10.0.0.1',
      userAgent: 'Chrome',
      userId: 'user-1',
    });
  });
});
