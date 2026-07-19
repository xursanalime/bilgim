import { ApiClient, ApiClientConfig } from './client';
import { ApiClientError } from './errors';
import { StorageKeys } from './storage';

// ── Helpers ─────────────────────────────────────────────────────────────
function makeJwt(expOffsetSeconds: number) {
  // Buffer is available globally in Node/Jest
  const payload = { exp: Math.floor(Date.now() / 1000) + expOffsetSeconds };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `header.${b64}.signature`;
}

// ── Mock Storage ────────────────────────────────────────────────────────
class MockStorage {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async remove(key: string) { this.store.delete(key); }
  has(key: string) { return this.store.has(key); }
}

describe('ApiClient', () => {
  let storage: MockStorage;
  let mockFetch: jest.Mock;
  let onUnauthenticated: jest.Mock;

  beforeEach(() => {
    storage = new MockStorage();
    mockFetch = jest.fn();
    onUnauthenticated = jest.fn();
    
    // Default mock returns 200 OK with empty object
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({})
    });
  });

  function createClient(config: Partial<ApiClientConfig> = {}) {
    return new ApiClient({
      baseUrl: 'https://api.example.com',
      storage,
      fetch: mockFetch as any,
      onUnauthenticated,
      ...config,
    });
  }

  describe('Token Rotation and Refresh', () => {
    it('sends Authorization header when accessToken exists', async () => {
      const validToken = makeJwt(3600);
      await storage.set(StorageKeys.ACCESS_TOKEN, validToken);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      const client = createClient();
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/test'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validToken}`,
          }),
        }),
      );
    });

    it('attempts to refresh token on 401 Unauthorized', async () => {
      const initialToken = makeJwt(3600);
      const refreshedToken = makeJwt(3600);
      await storage.set(StorageKeys.ACCESS_TOKEN, initialToken);
      await storage.set(StorageKeys.REFRESH_TOKEN, 'valid-refresh');

      // Call 1: Original request returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
      });
      // Call 2: Refresh request returns 200 with new tokens
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: refreshedToken, refreshToken: 'new-refresh' }),
      });
      // Call 3: Retry request returns 200 with actual data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'secret' }),
      });

      const client = createClient();
      const result = await client.get('/test');

      expect(result).toEqual({ data: 'secret' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      
      // Verify first call used initial token
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${initialToken}`);
      // Verify refresh call happened
      expect(mockFetch.mock.calls[1][0]).toContain('/auth/refresh');
      // Verify retry call used refreshed token
      expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${refreshedToken}`);
    });

    it('deduplicates concurrent refresh requests', async () => {
      await storage.set(StorageKeys.ACCESS_TOKEN, makeJwt(-3600));
      await storage.set(StorageKeys.REFRESH_TOKEN, 'valid-refresh');

      let refreshResolve: any;
      const refreshPromise = new Promise((r) => { refreshResolve = r; });

      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/auth/refresh')) {
          await refreshPromise;
          return {
            ok: true,
            status: 200,
            json: async () => ({ accessToken: makeJwt(3600), refreshToken: 'new-refresh' }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      });

      const client = createClient();
      
      const promise1 = client.refreshAccessToken();
      const promise2 = client.refreshAccessToken();
      const promise3 = client.refreshAccessToken();

      refreshResolve();

      const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);
      
      expect(res1?.accessToken).toBeDefined();
      expect(res2?.accessToken).toBe(res1?.accessToken);
      expect(res3?.accessToken).toBe(res1?.accessToken);
      
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears tokens and calls onUnauthenticated if refresh fails', async () => {
      await storage.set(StorageKeys.ACCESS_TOKEN, makeJwt(-3600));
      await storage.set(StorageKeys.REFRESH_TOKEN, 'bad-refresh');

      // Proactive refresh call triggered by buildAuthHeader
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'REFRESH_FAILED' } }),
      });
      // Subsequent fetch for /test (after refresh failed)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'UNAUTHORIZED' } }),
      });

      const client = createClient();
      await expect(client.get('/test')).rejects.toThrow();

      expect(await storage.get(StorageKeys.ACCESS_TOKEN)).toBeNull();
      expect(onUnauthenticated).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('wraps network errors in ApiClientError', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      const client = createClient();
      try {
        await client.get('/test');
        throw new Error('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiClientError);
        expect(e.code).toBe('NETWORK_ERROR');
      }
    });

    it('parses standard API error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid input',
            details: { field: 'email' },
            traceId: 'trace-123'
          }
        }),
      });

      const client = createClient();
      try {
        await client.get('/test');
        throw new Error('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiClientError);
        expect(e.statusCode).toBe(400);
        expect(e.code).toBe('VALIDATION_FAILED');
        expect(e.traceId).toBe('trace-123');
      }
    });
  });
});
