import { HibpService } from './hibp.service';

/**
 * Unit tests for `HibpService` (Task 29.3, Req 29.5).
 *
 * Covers:
 *   - SHA-1 hashing correctness
 *   - k-anonymity prefix/suffix splitting
 *   - Response parsing (found, not found, padded entries)
 *   - HTTP fetch with timeout and error handling
 *   - User-Agent and Add-Padding headers
 */

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('HibpService', () => {
  let service: HibpService;

  beforeEach(() => {
    service = new HibpService();
    mockFetch.mockReset();
  });

  describe('sha1', () => {
    it('computes correct SHA-1 hash for known input', () => {
      // SHA-1 of "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      const hash = service.sha1('password');
      expect(hash).toBe('5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8');
    });

    it('computes correct SHA-1 for empty string', () => {
      // SHA-1 of "" = da39a3ee5e6b4b0d3255bfef95601890afd80709
      const hash = service.sha1('');
      expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });

    it('handles unicode characters', () => {
      const hash = service.sha1('пароль');
      expect(hash).toHaveLength(40);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('parseResponse', () => {
    it('finds matching suffix and returns count', () => {
      const response = [
        '0018A45C4D1DEF81644B54AB7F969B88D65:1',
        '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
        '011053FD0102E94D6AE2F8B83D76FAF94F6:42',
        '012A7CA357541F0AC487871FEEC1891C49C:5',
      ].join('\r\n');

      const count = service.parseResponse(
        response,
        '011053FD0102E94D6AE2F8B83D76FAF94F6',
      );
      expect(count).toBe(42);
    });

    it('returns 0 when suffix is not found', () => {
      const response = [
        '0018A45C4D1DEF81644B54AB7F969B88D65:1',
        '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
      ].join('\r\n');

      const count = service.parseResponse(response, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
      expect(count).toBe(0);
    });

    it('treats padded entries (count=0) as not found', () => {
      const response = [
        '0018A45C4D1DEF81644B54AB7F969B88D65:0',
        '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:5',
      ].join('\r\n');

      const count = service.parseResponse(
        response,
        '0018A45C4D1DEF81644B54AB7F969B88D65',
      );
      expect(count).toBe(0);
    });

    it('handles empty response', () => {
      const count = service.parseResponse('', 'ABCDE');
      expect(count).toBe(0);
    });

    it('is case-insensitive for suffix matching', () => {
      const response = '0018A45C4D1DEF81644B54AB7F969B88D65:10\r\n';

      const count = service.parseResponse(
        response,
        '0018a45c4d1def81644b54ab7f969b88d65',
      );
      expect(count).toBe(10);
    });

    it('handles lines without colon separator', () => {
      const response = [
        'INVALID_LINE_NO_COLON',
        '0018A45C4D1DEF81644B54AB7F969B88D65:7',
      ].join('\r\n');

      const count = service.parseResponse(
        response,
        '0018A45C4D1DEF81644B54AB7F969B88D65',
      );
      expect(count).toBe(7);
    });

    it('handles non-numeric count gracefully', () => {
      const response = '0018A45C4D1DEF81644B54AB7F969B88D65:abc\r\n';

      const count = service.parseResponse(
        response,
        '0018A45C4D1DEF81644B54AB7F969B88D65',
      );
      expect(count).toBe(0);
    });
  });

  describe('getBreachCount', () => {
    it('sends correct prefix to API and returns breach count', async () => {
      // SHA-1 of "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      // Prefix: 5BAA6, Suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      const apiResponse = [
        '1D72CD07550416C216F8024D40D316B4DAF:2',
        '1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493',
        '1E4D5B57BC4C0A6D1BADF3C8A2D7400F0C6:1',
      ].join('\r\n');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => apiResponse,
      });

      const count = await service.getBreachCount('password');

      expect(count).toBe(3861493);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.pwnedpasswords.com/range/5BAA6',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'User-Agent': 'Bilgim-PasswordPolicy/1.0',
            'Add-Padding': 'true',
          }),
        }),
      );
    });

    it('returns 0 when password is not in any breach', async () => {
      const apiResponse = [
        '0018A45C4D1DEF81644B54AB7F969B88D65:1',
        '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2',
      ].join('\r\n');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => apiResponse,
      });

      const count = await service.getBreachCount('my-unique-password-xyz-2024');
      expect(count).toBe(0);
    });

    it('throws when API returns non-OK status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(service.getBreachCount('test')).rejects.toThrow(
        'HIBP API returned 503',
      );
    });

    it('throws when fetch is aborted (timeout)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('The operation was aborted'));

      await expect(service.getBreachCount('test')).rejects.toThrow(
        'The operation was aborted',
      );
    });
  });

  describe('constants', () => {
    it('uses 5-character prefix length', () => {
      expect(HibpService.PREFIX_LENGTH).toBe(5);
    });

    it('has a reasonable timeout', () => {
      expect(HibpService.TIMEOUT_MS).toBe(5000);
    });

    it('uses correct API base URL', () => {
      expect(HibpService.API_BASE).toBe(
        'https://api.pwnedpasswords.com/range',
      );
    });
  });
});
