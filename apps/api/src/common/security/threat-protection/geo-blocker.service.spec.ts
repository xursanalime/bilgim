import type { ConfigService } from '@nestjs/config';

import { GeoBlockerService } from './geo-blocker.service';

/**
 * Unit tests for the geo-blocker (Task 27.1).
 *
 * The service has two resolution sources (CF header, static overrides)
 * and three observable outcomes (`countryCode`, `blocked`,
 * `isCountryBlocked`). The tests cover each axis independently.
 */

function makeConfig(env: Record<string, unknown> = {}): any {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('GeoBlockerService', () => {
  describe('configuration parsing', () => {
    it('defaults to an empty block list', () => {
      const svc = new GeoBlockerService(makeConfig());
      expect(svc.blockedList).toEqual([]);
    });

    it('parses a comma-separated list of ISO codes (case-insensitive)', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'kp,Ir, sy , us ' }),
      );
      const list = svc.blockedList.sort();
      expect(list).toEqual(['IR', 'KP', 'SY', 'US']);
    });

    it('drops invalid country codes silently', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP,XYZ,1A,IR' }),
      );
      expect(svc.blockedList.sort()).toEqual(['IR', 'KP']);
    });
  });

  describe('isCountryBlocked', () => {
    it('returns false for an empty / unset country', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      expect(svc.isCountryBlocked(null)).toBe(false);
      expect(svc.isCountryBlocked('')).toBe(false);
      expect(svc.isCountryBlocked(undefined as unknown as string)).toBe(false);
    });

    it('matches country codes case-insensitively', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      expect(svc.isCountryBlocked('KP')).toBe(true);
      expect(svc.isCountryBlocked('kp')).toBe(true);
      expect(svc.isCountryBlocked('Kp')).toBe(true);
    });

    it('returns false for codes not on the list', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP,IR' }),
      );
      expect(svc.isCountryBlocked('US')).toBe(false);
      expect(svc.isCountryBlocked('UZ')).toBe(false);
    });
  });

  describe('evaluate via cf-ipcountry header', () => {
    it('blocks when the CF header reports a listed country', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: { 'cf-ipcountry': 'KP' },
      });
      expect(decision.countryCode).toBe('KP');
      expect(decision.blocked).toBe(true);
    });

    it('honours mixed-case CF header values', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: { 'cf-ipcountry': 'kp' },
      });
      expect(decision.countryCode).toBe('KP');
      expect(decision.blocked).toBe(true);
    });

    it('returns blocked=false when the CF country is not on the list', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: { 'cf-ipcountry': 'US' },
      });
      expect(decision.countryCode).toBe('US');
      expect(decision.blocked).toBe(false);
    });

    it('rejects malformed CF header values', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: { 'cf-ipcountry': 'KOREA' },
      });
      expect(decision.countryCode).toBeNull();
      expect(decision.blocked).toBe(false);
    });
  });

  describe('evaluate via static overrides', () => {
    it('matches a single-IP override', () => {
      const svc = new GeoBlockerService(
        makeConfig({
          BLOCKED_COUNTRIES: 'KP',
          GEO_OVERRIDES: '198.51.100.5=KP',
        }),
      );
      const decision = svc.evaluate({
        ip: '198.51.100.5',
        headers: {},
      });
      expect(decision.countryCode).toBe('KP');
      expect(decision.blocked).toBe(true);
    });

    it('matches a CIDR override', () => {
      const svc = new GeoBlockerService(
        makeConfig({
          BLOCKED_COUNTRIES: 'KP',
          GEO_OVERRIDES: '203.0.113.0/24=KP',
        }),
      );
      const inside = svc.evaluate({
        ip: '203.0.113.42',
        headers: {},
      });
      expect(inside.countryCode).toBe('KP');
      expect(inside.blocked).toBe(true);

      const outside = svc.evaluate({
        ip: '198.51.100.1',
        headers: {},
      });
      expect(outside.countryCode).toBeNull();
      expect(outside.blocked).toBe(false);
    });

    it('CF header takes precedence over the static override', () => {
      const svc = new GeoBlockerService(
        makeConfig({
          BLOCKED_COUNTRIES: 'KP',
          GEO_OVERRIDES: '203.0.113.0/24=KP',
        }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.5',
        headers: { 'cf-ipcountry': 'US' },
      });
      // CF says US — respect it; the override would have said KP.
      expect(decision.countryCode).toBe('US');
      expect(decision.blocked).toBe(false);
    });

    it('drops invalid override entries silently', () => {
      const svc = new GeoBlockerService(
        makeConfig({
          BLOCKED_COUNTRIES: 'KP',
          // First entry has an invalid country, third has a malformed CIDR
          GEO_OVERRIDES:
            '198.51.100.1=XYZ, 203.0.113.0/24=KP, 999.999.0.0/24=IR',
        }),
      );
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: {},
      });
      expect(decision.countryCode).toBe('KP');
      expect(decision.blocked).toBe(true);
    });
  });

  describe('fail-open posture', () => {
    it('returns blocked=false when no source can resolve a country', () => {
      const svc = new GeoBlockerService(
        makeConfig({ BLOCKED_COUNTRIES: 'KP' }),
      );
      const decision = svc.evaluate({
        ip: '198.51.100.99',
        headers: {},
      });
      expect(decision.countryCode).toBeNull();
      expect(decision.blocked).toBe(false);
    });

    it('returns blocked=false when the block list is empty regardless of country', () => {
      const svc = new GeoBlockerService(makeConfig());
      const decision = svc.evaluate({
        ip: '203.0.113.1',
        headers: { 'cf-ipcountry': 'KP' },
      });
      expect(decision.countryCode).toBe('KP');
      expect(decision.blocked).toBe(false);
    });
  });
});
