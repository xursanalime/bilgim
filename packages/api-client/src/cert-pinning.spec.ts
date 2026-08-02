import { isPinningSupported, createPinnedFetch } from './cert-pinning';

describe('Cert Pinning', () => {
  let originalGlobalThis: any;

  beforeEach(() => {
    // Save original global state
    originalGlobalThis = { ...globalThis };
  });

  afterEach(() => {
    // Restore original global state
    for (const key in globalThis) {
      if (!(key in originalGlobalThis)) {
        delete (globalThis as any)[key];
      }
    }
    Object.assign(globalThis, originalGlobalThis);
    jest.restoreAllMocks();
  });

  describe('isPinningSupported()', () => {
    it('detects Node environment', () => {
      (globalThis as any).process = { versions: { node: '18.0.0' } };
      const support = isPinningSupported();
      expect(support).toEqual({ supported: true, runtime: 'node' });
    });

    it('detects React Native environment', () => {
      (globalThis as any).navigator = { product: 'ReactNative' };
      const support = isPinningSupported();
      expect(support.supported).toBe(false);
      if (!support.supported) {
        expect(support.runtime).toBe('react-native');
      }
    });

    it('detects Browser environment', () => {
      (globalThis as any).navigator = { product: 'Gecko' };
      (globalThis as any).window = {};
      (globalThis as any).document = {};
      (globalThis as any).process = undefined;
      const support = isPinningSupported();
      expect(support.supported).toBe(false);
      if (!support.supported) {
        expect(support.runtime).toBe('browser');
      }
    });
  });

  describe('createPinnedFetch()', () => {
    const mockFetch = jest.fn();

    it('returns base fetch and warns in unsupported environments', () => {
      (globalThis as any).navigator = { product: 'ReactNative' };
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const resultFetch = createPinnedFetch(
        { host: 'api.example.com', pinnedFingerprints: ['abcd'] },
        mockFetch as any
      );

      expect(resultFetch).toBe(mockFetch);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Certificate pinning requested but not supported')
      );
    });

    it('returns base fetch when no fingerprints provided', () => {
      (globalThis as any).process = { versions: { node: '18.0.0' } };
      
      const resultFetch = createPinnedFetch(
        { host: 'api.example.com', pinnedFingerprints: [] },
        mockFetch as any
      );

      expect(resultFetch).toBe(mockFetch);
    });

    // In a Node environment, we can't easily mock `nodeRequire` because the implementation uses
    // a globalThis.require cast which doesn't exist by default in Jest unless we set it.
    it('warns if require is unavailable in Node', () => {
      (globalThis as any).process = { versions: { node: '18.0.0' } };
      (globalThis as any).require = undefined;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const resultFetch = createPinnedFetch(
        { host: 'api.example.com', pinnedFingerprints: ['abcd'] },
        mockFetch as any
      );

      expect(resultFetch).toBe(mockFetch);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('require() is unavailable')
      );
    });
  });
});
