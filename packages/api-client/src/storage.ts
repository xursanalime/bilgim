/**
 * Token storage adapter — pluggable storage interface.
 *
 * Both web and mobile need to persist `{ accessToken, refreshToken }`
 * pairs, but the right backend differs by platform:
 *
 *   - Web      → cookies + localStorage (`document.cookie` for SSR
 *                middleware, localStorage for client-side reads).
 *   - Mobile   → `expo-secure-store` (Keychain / Keystore).
 *   - Tests    → in-memory map.
 *
 * Rather than ship platform-specific transports inside this package, we
 * expose a tiny async key-value contract and let each app wire up the
 * adapter that fits its runtime. The defaults below cover the common
 * cases: an in-memory map (always available) and a `localStorage`
 * adapter (web-only).
 */

/**
 * Async key/value contract that the API client uses to persist tokens.
 *
 * All methods accept arbitrary string keys so adapters can multiplex
 * many slots (the client uses three: access token, refresh token,
 * cached user blob).
 */
export interface TokenStorageAdapter {
  /**
   * Read a value. Returns `null` when the key is unset or the
   * underlying store is unavailable (e.g. SSR with no `localStorage`).
   */
  get(key: string): Promise<string | null>;
  /** Write a value. Implementations should resolve only after the write
   * is durable (e.g. await the SecureStore promise on mobile). */
  set(key: string, value: string): Promise<void>;
  /** Delete a value. Idempotent — a missing key is not an error. */
  remove(key: string): Promise<void>;
}

/**
 * In-memory adapter — always available, never persisted. Useful for
 * Node-side rendering, tests, and as a fallback when no platform
 * adapter is registered.
 */
export function createMemoryStorage(): TokenStorageAdapter {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

/**
 * Browser `localStorage` adapter. Falls back to in-memory storage when
 * `localStorage` is unavailable (Node, private mode, SSR).
 */
export function createLocalStorageAdapter(): TokenStorageAdapter {
  const memory = createMemoryStorage();
  const hasLocalStorage = (): boolean => {
    try {
      return (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as { localStorage?: Storage }).localStorage !==
          'undefined'
      );
    } catch {
      return false;
    }
  };

  return {
    async get(key) {
      if (!hasLocalStorage()) return memory.get(key);
      try {
        return (
          (globalThis as { localStorage: Storage }).localStorage.getItem(
            key,
          ) ?? null
        );
      } catch {
        return memory.get(key);
      }
    },
    async set(key, value) {
      if (!hasLocalStorage()) {
        await memory.set(key, value);
        return;
      }
      try {
        (globalThis as { localStorage: Storage }).localStorage.setItem(
          key,
          value,
        );
      } catch {
        await memory.set(key, value);
      }
    },
    async remove(key) {
      if (!hasLocalStorage()) {
        await memory.remove(key);
        return;
      }
      try {
        (globalThis as { localStorage: Storage }).localStorage.removeItem(key);
      } catch {
        await memory.remove(key);
      }
    },
  };
}

/**
 * Standard storage keys used by the API client. Apps SHOULD prefer
 * these constants over hard-coded strings so token migrations across
 * platforms stay aligned.
 */
export const StorageKeys = {
  /** Short-lived JWT (~15m). Sent as `Authorization: Bearer …`. */
  ACCESS_TOKEN: 'bilgim_access_token',
  /** Opaque refresh token (~30d). Rotated on each `/auth/refresh`. */
  REFRESH_TOKEN: 'bilgim_refresh_token',
  /** Cached `LoginResponse.user` JSON — UI shell only, never trusted. */
  USER: 'bilgim_user',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
