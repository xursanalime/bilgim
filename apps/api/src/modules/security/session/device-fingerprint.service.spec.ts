import { DeviceFingerprintService } from './device-fingerprint.service';
import type { DeviceFingerprintComponents, TrustedDeviceRecord } from './device-fingerprint.service';

/**
 * Unit tests for `DeviceFingerprintService` (Task 29.2, Req 29.2, 29.9).
 *
 * Covers:
 *   - Fingerprint computation: deterministic, collision-resistant.
 *   - Device name derivation from User-Agent.
 *   - Trusted device management: add, remove, eviction, touch.
 *   - Device verification token flow (Req 29.9).
 *   - Fail-open when Redis is unavailable.
 */

// ─── Fake Redis ──────────────────────────────────────────────────

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  get size(): number {
    return this.store.size;
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('DeviceFingerprintService — fingerprint computation', () => {
  let service: DeviceFingerprintService;

  beforeEach(() => {
    service = new DeviceFingerprintService();
  });

  it('produces a deterministic SHA-256 hash from components', () => {
    const components: DeviceFingerprintComponents = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
      acceptLanguage: 'en-US,en;q=0.9',
      screenResolution: '1920x1080',
      timezoneOffset: -300,
      platform: 'Win32',
      hardwareConcurrency: 8,
    };

    const fp1 = service.computeFingerprint(components);
    const fp2 = service.computeFingerprint(components);

    expect(fp1).toBe(fp2);
    // SHA-256 hex = 64 characters
    expect(fp1.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(fp1)).toBe(true);
  });

  it('produces different hashes for different components', () => {
    const fp1 = service.computeFingerprint({
      userAgent: 'Chrome/120',
      platform: 'Win32',
    });
    const fp2 = service.computeFingerprint({
      userAgent: 'Firefox/119',
      platform: 'MacIntel',
    });

    expect(fp1).not.toBe(fp2);
  });

  it('handles missing optional components gracefully', () => {
    const fp = service.computeFingerprint({
      userAgent: 'Chrome/120',
    });

    expect(fp.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(fp)).toBe(true);
  });
});

describe('DeviceFingerprintService — device name derivation', () => {
  let service: DeviceFingerprintService;

  beforeEach(() => {
    service = new DeviceFingerprintService();
  });

  it('detects Chrome on Windows', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(name).toBe('Chrome on Windows');
  });

  it('detects Safari on macOS', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );
    expect(name).toBe('Safari on macOS');
  });

  it('detects Firefox on Linux', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
    );
    expect(name).toBe('Firefox on Linux');
  });

  it('detects Edge on Windows', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    );
    expect(name).toBe('Edge on Windows');
  });

  it('detects Chrome on Android', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    );
    expect(name).toBe('Chrome on Android');
  });

  it('detects Safari on iOS', () => {
    const name = service.deriveDeviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    expect(name).toBe('Safari on iOS');
  });

  it('returns "Unknown Device" for empty UA', () => {
    expect(service.deriveDeviceName('')).toBe('Unknown Device');
  });
});

describe('DeviceFingerprintService — trusted device management (Req 29.2)', () => {
  let redis: FakeRedis;
  let service: DeviceFingerprintService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new DeviceFingerprintService(redis as never);
  });

  it('reports device as untrusted when no devices registered', async () => {
    const trusted = await service.isDeviceTrusted('user-1', 'fp-abc');
    expect(trusted).toBe(false);
  });

  it('adds and recognizes a trusted device', async () => {
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome on Windows',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });

    expect(await service.isDeviceTrusted('user-1', 'fp-abc')).toBe(true);
    expect(await service.isDeviceTrusted('user-1', 'fp-other')).toBe(false);
  });

  it('removes a trusted device', async () => {
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });

    const removed = await service.removeTrustedDevice('user-1', 'fp-abc');
    expect(removed).toBe(true);
    expect(await service.isDeviceTrusted('user-1', 'fp-abc')).toBe(false);
  });

  it('returns false when removing non-existent device', async () => {
    const removed = await service.removeTrustedDevice('user-1', 'nonexistent');
    expect(removed).toBe(false);
  });

  it('evicts oldest device when exceeding limit (10)', async () => {
    for (let i = 0; i < 11; i++) {
      await service.addTrustedDevice('user-1', {
        fingerprint: `fp-${i}`,
        deviceName: `Device ${i}`,
        ip: `10.0.0.${i}`,
        userAgent: `UA-${i}`,
      });
    }

    const devices = await service.getTrustedDevices('user-1');
    expect(devices.length).toBe(10);

    // fp-0 (oldest) should be evicted
    expect(devices.some((d) => d.fingerprint === 'fp-0')).toBe(false);
    // fp-10 (newest) should be present
    expect(devices.some((d) => d.fingerprint === 'fp-10')).toBe(true);
  });

  it('updates existing device instead of duplicating', async () => {
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome on Windows',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });

    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome on Windows',
      ip: '10.0.0.2', // different IP
      userAgent: 'Chrome/121',
    });

    const devices = await service.getTrustedDevices('user-1');
    expect(devices.length).toBe(1);
    expect(devices[0]!.ip).toBe('10.0.0.2');
  });

  it('touchDevice updates lastSeenAt', async () => {
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });

    const before = await service.getTrustedDevices('user-1');
    const originalLastSeen = before[0]!.lastSeenAt;

    await new Promise((r) => setTimeout(r, 10));
    await service.touchDevice('user-1', 'fp-abc');

    const after = await service.getTrustedDevices('user-1');
    expect(after[0]!.lastSeenAt).toBeGreaterThanOrEqual(originalLastSeen);
  });

  it('clearAllTrustedDevices removes all devices', async () => {
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-1',
      deviceName: 'D1',
      ip: '10.0.0.1',
      userAgent: 'UA1',
    });
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-2',
      deviceName: 'D2',
      ip: '10.0.0.2',
      userAgent: 'UA2',
    });

    await service.clearAllTrustedDevices('user-1');
    const devices = await service.getTrustedDevices('user-1');
    expect(devices.length).toBe(0);
  });
});

describe('DeviceFingerprintService — device verification (Req 29.9)', () => {
  let redis: FakeRedis;
  let service: DeviceFingerprintService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new DeviceFingerprintService(redis as never);
  });

  it('creates a verification token for new device', async () => {
    const token = await service.createVerificationToken('user-1', {
      fingerprint: 'fp-new',
      deviceName: 'Firefox on Linux',
      ip: '10.0.0.5',
      userAgent: 'Firefox/119',
    });

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64); // 32 bytes hex
  });

  it('verifies device and adds to trusted list', async () => {
    const token = await service.createVerificationToken('user-1', {
      fingerprint: 'fp-new',
      deviceName: 'Firefox on Linux',
      ip: '10.0.0.5',
      userAgent: 'Firefox/119',
    });

    const result = await service.verifyDevice(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-1');
    expect(result!.fingerprint).toBe('fp-new');

    // Device should now be trusted
    expect(await service.isDeviceTrusted('user-1', 'fp-new')).toBe(true);
  });

  it('returns null for invalid token', async () => {
    const result = await service.verifyDevice('invalid-token-xyz');
    expect(result).toBeNull();
  });

  it('token is one-time use (consumed after verification)', async () => {
    const token = await service.createVerificationToken('user-1', {
      fingerprint: 'fp-new',
      deviceName: 'Chrome',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });

    const first = await service.verifyDevice(token);
    expect(first).not.toBeNull();

    const second = await service.verifyDevice(token);
    expect(second).toBeNull();
  });
});

describe('DeviceFingerprintService — fail-open posture', () => {
  it('reports device as trusted when Redis is unavailable', async () => {
    const service = new DeviceFingerprintService(); // no redis
    expect(await service.isDeviceTrusted('user-1', 'fp-abc')).toBe(true);
  });

  it('returns empty list when Redis is unavailable', async () => {
    const service = new DeviceFingerprintService(); // no redis
    expect(await service.getTrustedDevices('user-1')).toEqual([]);
  });

  it('addTrustedDevice is a no-op when Redis is unavailable', async () => {
    const service = new DeviceFingerprintService(); // no redis
    await service.addTrustedDevice('user-1', {
      fingerprint: 'fp-abc',
      deviceName: 'Chrome',
      ip: '10.0.0.1',
      userAgent: 'Chrome/120',
    });
    // Should not throw
  });

  it('verifyDevice returns null when Redis is unavailable', async () => {
    const service = new DeviceFingerprintService(); // no redis
    const result = await service.verifyDevice('any-token');
    expect(result).toBeNull();
  });
});
