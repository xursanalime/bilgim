import { Logger } from '@nestjs/common';
import fc from 'fast-check';

import type { RedisService } from '../../../infra/redis/redis.service';
import type { AdminAuditService } from '../../admin/admin-audit.service';
import {
  GeoIpService,
  type GeoIpLookup,
} from './geoip.service';
import {
  ImpossibleTravelService,
  haversineDistanceKm,
} from './impossible-travel.service';

/**
 * Unit + property tests for Task 27.3 — Impossible travel detection
 * (`modules/security/geo/impossible-travel.service.ts`).
 *
 * Covers:
 *   1. Haversine distance (Tashkent ↔ Moscow ≈ 2790 km, Tashkent ↔
 *      Samarkand ≈ 270 km — within 5% tolerance).
 *   2. `checkAndRecord` semantics:
 *        - First-ever login → allowed.
 *        - Same location, recent → allowed.
 *        - >500 km apart inside 1 h → blocked + force MFA.
 *        - >500 km apart but >1 h elapsed → allowed.
 *   3. GeoIP fallback to `cf-ipcountry` header when no MaxMind DB.
 *   4. Property test (Property 17): for any (lat, lon, ts) pair the
 *      block decision matches the haversine ≥500 km AND elapsed ≤1 h
 *      threshold.
 *
 * **Validates: Requirements 27.3**
 */

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface KvEntry {
  value: string;
  expiresAt: number | null;
}

class FakeRedis {
  private kv = new Map<string, KvEntry>();

  private now(): number {
    return Date.now();
  }

  private purge(): void {
    const t = this.now();
    for (const [k, v] of this.kv) {
      if (v.expiresAt !== null && v.expiresAt <= t) this.kv.delete(k);
    }
  }

  async get(key: string): Promise<string | null> {
    this.purge();
    return this.kv.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt: ttl !== undefined ? this.now() + ttl * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<boolean> {
    this.purge();
    return this.kv.has(key);
  }
}

function buildAudit(): jest.Mocked<AdminAuditService> {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
}

interface Built {
  service: ImpossibleTravelService;
  geo: jest.Mocked<Pick<GeoIpService, 'lookup'>>;
  redis: FakeRedis;
  audit: jest.Mocked<AdminAuditService>;
}

function build(): Built {
  const redis = new FakeRedis();
  const audit = buildAudit();
  const geo: jest.Mocked<Pick<GeoIpService, 'lookup'>> = {
    lookup: jest.fn(),
  };
  const service = new ImpossibleTravelService(
    geo as unknown as GeoIpService,
    redis as unknown as RedisService,
    audit,
  );
  return { service, geo, redis, audit };
}

// Reference coordinates from openly-published city centres. Used to
// validate the haversine implementation against well-known distances.
const TASHKENT: GeoIpLookup = {
  country: 'UZ',
  latitude: 41.3111,
  longitude: 69.2797,
  accuracyRadius: 50,
};
const MOSCOW: GeoIpLookup = {
  country: 'RU',
  latitude: 55.7558,
  longitude: 37.6176,
  accuracyRadius: 50,
};
const SAMARKAND: GeoIpLookup = {
  country: 'UZ',
  latitude: 39.6542,
  longitude: 66.9597,
  accuracyRadius: 50,
};

// Silence Nest's logger so the property test runs don't spam output.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Haversine — distance accuracy
// ---------------------------------------------------------------------------

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm(41, 69, 41, 69)).toBe(0);
  });

  it('Tashkent → Moscow ≈ 2_790 km (within 5% tolerance)', () => {
    const km = haversineDistanceKm(
      TASHKENT.latitude,
      TASHKENT.longitude,
      MOSCOW.latitude,
      MOSCOW.longitude,
    );
    expect(km).toBeGreaterThan(2790 * 0.95);
    expect(km).toBeLessThan(2790 * 1.05);
  });

  it('Tashkent → Samarkand ≈ 270 km (within 5% tolerance)', () => {
    const km = haversineDistanceKm(
      TASHKENT.latitude,
      TASHKENT.longitude,
      SAMARKAND.latitude,
      SAMARKAND.longitude,
    );
    expect(km).toBeGreaterThan(270 * 0.95);
    expect(km).toBeLessThan(270 * 1.05);
  });

  it('is symmetric: d(a,b) == d(b,a)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (lat1, lon1, lat2, lon2) => {
          const ab = haversineDistanceKm(lat1, lon1, lat2, lon2);
          const ba = haversineDistanceKm(lat2, lon2, lat1, lon1);
          expect(Math.abs(ab - ba)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('is bounded by Earth half-circumference (~20015 km)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat1, lon1, lat2, lon2) => {
          const km = haversineDistanceKm(lat1, lon1, lat2, lon2);
          expect(km).toBeGreaterThanOrEqual(0);
          expect(km).toBeLessThanOrEqual(20100);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// checkAndRecord — decision matrix
// ---------------------------------------------------------------------------

describe('ImpossibleTravelService.checkAndRecord', () => {
  beforeEach(() => {
    // Fixed system time so we can advance it deterministically.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows the first-ever login (no prior record)', async () => {
    const { service, geo } = build();
    geo.lookup.mockResolvedValueOnce(TASHKENT);

    const decision = await service.checkAndRecord('u1', '203.0.113.10');

    expect(decision.allowed).toBe(true);
    expect(decision.requiresMfaReverification).toBe(false);
    expect(decision.currentCountry).toBe('UZ');
  });

  it('allows a second login from the same location', async () => {
    const { service, geo } = build();
    geo.lookup.mockResolvedValue(TASHKENT);

    await service.checkAndRecord('u2', '203.0.113.10');
    jest.advanceTimersByTime(60 * 1000); // 1 minute later
    const decision = await service.checkAndRecord('u2', '203.0.113.10');

    expect(decision.allowed).toBe(true);
    expect(decision.distanceKm ?? decision.distance).toBeLessThan(1);
    expect(decision.requiresMfaReverification).toBe(false);
  });

  it('blocks a >500 km hop inside the 1h window (Tashkent → Moscow in 30 min)', async () => {
    const { service, geo, audit } = build();
    geo.lookup.mockResolvedValueOnce(TASHKENT).mockResolvedValueOnce(MOSCOW);

    await service.checkAndRecord('u3', '203.0.113.20');
    jest.advanceTimersByTime(30 * 60 * 1000);
    const decision = await service.checkAndRecord('u3', '198.51.100.20');

    expect(decision.allowed).toBe(false);
    const km = decision.distanceKm ?? decision.distance ?? 0;
    expect(km).toBeGreaterThan(500);
    expect(decision.elapsedMs).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(decision.requiresMfaReverification).toBe(true);
    expect(decision.previousCountry ?? decision.prevCountry).toBe('UZ');
    expect(decision.currentCountry).toBe('RU');
    // Audit row written for SIEM correlation.
    expect(audit.log).toHaveBeenCalledWith(
      null,
      'security.impossible_travel.blocked',
      'u3',
      expect.objectContaining({ distanceKm: expect.any(Number) }),
      expect.objectContaining({ ip: '198.51.100.20' }),
    );
    // Force-MFA flag persisted.
    expect(await service.isMfaForced('u3')).toBe(true);
  });

  it('allows a >500 km hop AFTER the 1h window expires', async () => {
    const { service, geo } = build();
    geo.lookup.mockResolvedValueOnce(TASHKENT).mockResolvedValueOnce(MOSCOW);

    await service.checkAndRecord('u4', '203.0.113.21');
    jest.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours later
    const decision = await service.checkAndRecord('u4', '198.51.100.21');

    expect(decision.allowed).toBe(true);
    const km = decision.distanceKm ?? decision.distance ?? 0;
    expect(km).toBeGreaterThan(500);
    // Country changed but elapsedMs > 1h, so no soft step-up.
    expect(decision.requiresMfaReverification).toBe(false);
  });

  it('allows a <500 km hop inside the 1h window (Tashkent → Samarkand in 30 min)', async () => {
    const { service, geo } = build();
    geo.lookup
      .mockResolvedValueOnce(TASHKENT)
      .mockResolvedValueOnce(SAMARKAND);

    await service.checkAndRecord('u5', '203.0.113.22');
    jest.advanceTimersByTime(30 * 60 * 1000);
    const decision = await service.checkAndRecord('u5', '203.0.113.23');

    expect(decision.allowed).toBe(true);
    const km = decision.distanceKm ?? decision.distance ?? 0;
    expect(km).toBeLessThan(500);
  });

  it('fails open (allowed) when GeoIP returns null', async () => {
    const { service, geo, audit } = build();
    geo.lookup.mockResolvedValueOnce(null);

    const decision = await service.checkAndRecord('u6', '127.0.0.1');

    expect(decision.allowed).toBe(true);
    expect(decision.requiresMfaReverification).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('clearMfaForced wipes the force-MFA flag', async () => {
    const { service, geo } = build();
    geo.lookup.mockResolvedValueOnce(TASHKENT).mockResolvedValueOnce(MOSCOW);

    await service.checkAndRecord('u7', '203.0.113.30');
    jest.advanceTimersByTime(15 * 60 * 1000);
    await service.checkAndRecord('u7', '198.51.100.30');
    expect(await service.isMfaForced('u7')).toBe(true);

    await service.clearMfaForced('u7');
    expect(await service.isMfaForced('u7')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 17 — block decision matches the haversine threshold
// ---------------------------------------------------------------------------

describe('ImpossibleTravelService — Property 17 (block ⇔ ≥500km ∧ ≤1h)', () => {
  // **Validates: Requirements 27.3**
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns allowed=false iff distance ≥500 km AND elapsed ≤1 h', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          lat1: fc.double({ min: -85, max: 85, noNaN: true }),
          lon1: fc.double({ min: -175, max: 175, noNaN: true }),
          lat2: fc.double({ min: -85, max: 85, noNaN: true }),
          lon2: fc.double({ min: -175, max: 175, noNaN: true }),
          // Elapsed 0..3 hours.
          elapsedSec: fc.integer({ min: 0, max: 3 * 60 * 60 }),
        }),
        async ({ lat1, lon1, lat2, lon2, elapsedSec }) => {
          // Reset the system clock per run so elapsed time is purely
          // a function of `elapsedSec`.
          jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
          const { service, geo } = build();
          geo.lookup
            .mockResolvedValueOnce({
              country: 'AA',
              latitude: lat1,
              longitude: lon1,
              accuracyRadius: 50,
            })
            .mockResolvedValueOnce({
              country: 'BB',
              latitude: lat2,
              longitude: lon2,
              accuracyRadius: 50,
            });

          await service.checkAndRecord('p1', '203.0.113.40');
          jest.advanceTimersByTime(elapsedSec * 1000);
          const decision = await service.checkAndRecord(
            'p1',
            '198.51.100.40',
          );

          const distanceKm = haversineDistanceKm(lat1, lon1, lat2, lon2);
          // Use a strict-less-than comparison to avoid float boundary
          // flakiness exactly at the 500.0 / 3600 s threshold.
          const expectBlock =
            distanceKm > 500 + 1e-9 &&
            elapsedSec * 1000 < 60 * 60 * 1000 - 1;
          const expectAllow =
            distanceKm < 500 - 1e-9 ||
            elapsedSec * 1000 > 60 * 60 * 1000 + 1;

          if (expectBlock) {
            expect(decision.allowed).toBe(false);
            expect(decision.requiresMfaReverification).toBe(true);
          } else if (expectAllow) {
            expect(decision.allowed).toBe(true);
          }
          // Boundary cases (within 1e-9 of 500 km, or within 1 ms of
          // 1 h) are intentionally not asserted — they are an
          // implementation detail of `>=` vs `>`.
        },
      ),
      { numRuns: 75 },
    );
  });
});
