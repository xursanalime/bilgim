/**
 * @jest-environment node
 */
import {
  apiUrl,
  getAccessToken,
  mapUpstreamStatus,
  protectedResponseHeaders,
  UUID_RE,
} from './bff';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

function reqWithCookie(cookie?: string): Request {
  return new Request('http://localhost/api/media/stream', {
    headers: cookie ? { cookie } : {},
  });
}

describe('media BFF helpers', () => {
  describe('getAccessToken', () => {
    it('returns undefined when there is no Cookie header (fail closed)', () => {
      expect(getAccessToken(reqWithCookie())).toBeUndefined();
    });

    it('reads the canonical bilgim_access_token cookie', () => {
      expect(
        getAccessToken(reqWithCookie('foo=1; bilgim_access_token=tok123; bar=2')),
      ).toBe('tok123');
    });

    it('falls back to the legacy access_token cookie', () => {
      expect(getAccessToken(reqWithCookie('access_token=legacy'))).toBe(
        'legacy',
      );
    });

    it('prefers bilgim_access_token over the legacy cookie', () => {
      expect(
        getAccessToken(reqWithCookie('access_token=legacy; bilgim_access_token=canonical')),
      ).toBe('canonical');
    });

    it('url-decodes the cookie value', () => {
      expect(getAccessToken(reqWithCookie('bilgim_access_token=a%20b'))).toBe(
        'a b',
      );
    });
  });

  describe('UUID_RE', () => {
    it('accepts a valid uuid and rejects junk', () => {
      expect(UUID_RE.test(VALID_UUID)).toBe(true);
      expect(UUID_RE.test('not-a-uuid')).toBe(false);
      expect(UUID_RE.test('../../etc/passwd')).toBe(false);
    });
  });

  describe('mapUpstreamStatus', () => {
    it('surfaces auth/authorization/not-found verbatim', () => {
      expect(mapUpstreamStatus(401)).toBe(401);
      expect(mapUpstreamStatus(403)).toBe(403);
      expect(mapUpstreamStatus(404)).toBe(404);
    });

    it('collapses other upstream failures to 502', () => {
      expect(mapUpstreamStatus(500)).toBe(502);
      expect(mapUpstreamStatus(409)).toBe(502);
    });
  });

  describe('apiUrl', () => {
    it('builds an /api/v1-prefixed absolute url', () => {
      expect(apiUrl('/media/assets/x/stream')).toMatch(
        /\/api\/v1\/media\/assets\/x\/stream$/,
      );
    });
  });

  describe('protectedResponseHeaders', () => {
    it('marks responses as non-cacheable and non-sniffable', () => {
      const h = protectedResponseHeaders();
      expect(h['Cache-Control']).toContain('no-store');
      expect(h['X-Content-Type-Options']).toBe('nosniff');
    });
  });
});
