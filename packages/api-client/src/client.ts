/**
 * Core API client.
 *
 * Responsibilities:
 *   1. Build absolute URLs from relative paths using `baseUrl + /api/v1`.
 *   2. Inject `Authorization: Bearer <accessToken>` for non-`public`
 *      requests, refreshing the token first when it's about to expire.
 *   3. Surface non-2xx responses as `ApiClientError` with the
 *      `{ code, message, details, traceId }` envelope intact.
 *   4. On 401 for an authenticated request, attempt a single refresh +
 *      retry. Concurrent refreshes are deduped with a shared promise.
 *   5. Apply per-request timeouts via `AbortController`.
 *
 * The client is **storage-agnostic**: it never touches `localStorage`,
 * `expo-secure-store`, or cookies directly. Each app passes a
 * `TokenStorageAdapter` (see `./storage.ts`) when constructing the
 * client.
 */

import {
  ApiClientError,
  NETWORK_ERROR_CODE,
  parseErrorBody,
} from './errors';
import { isJwtExpired } from './jwt';
import { StorageKeys, type TokenStorageAdapter } from './storage';
import type { AuthTokens, RequestOptions } from './types';
import {
  createPinnedFetch,
  isPinningSupported,
  type CertPinningConfig,
  type PinningSupport,
  type Sha256SpkiPin,
} from './cert-pinning';

const API_PREFIX = '/api/v1';

export interface ApiClientConfig {
  /** Root URL — `/api/v1` is appended automatically. */
  baseUrl: string;
  /** Token persistence adapter (in-memory by default). */
  storage: TokenStorageAdapter;
  /**
   * Called whenever the client clears tokens (signed out, refresh
   * failed). Apps use this to redirect to /login or reset their
   * in-memory user state. Optional — the client itself works fine
   * without a hook.
   */
  onUnauthenticated?: () => void;
  /** Default per-request timeout. Defaults to 30s. */
  defaultTimeoutMs?: number;
  /** `fetch` implementation override for tests. */
  fetch?: typeof fetch;
  /**
   * Certificate pinning fingerprints (Task 28.4, Req 28.9). Each
   * value is the base64 SHA-256 hash of the server leaf
   * certificate's SubjectPublicKeyInfo (SPKI). Always supply two —
   * the active leaf cert AND a backup — so an emergency rotation
   * does not require a code release.
   *
   * **Runtime support.** Pinning at the transport layer is enforced
   * **only on Node** (server-to-server callers, scheduled jobs,
   * e2e tests). Browsers and React Native cannot inspect the TLS
   * certificate chain from JavaScript and rely on the platform
   * pinning surfaces instead:
   *
   *   - Mobile: `apps/mobile/security/network-security-config.xml`
   *     (Android) / `ats-info.plist.snippet` (iOS).
   *   - Web:   Cloudflare HSTS + zone TLS 1.3 enforcement.
   *
   * Setting this option in an unsupported runtime emits a single
   * `console.warn` and is otherwise a no-op.
   */
  pinnedFingerprints?: Sha256SpkiPin[];
  /**
   * Optional override for the host the pin set applies to. Defaults
   * to the hostname extracted from `baseUrl`. Useful when fronting
   * the API behind a regional alias whose cert chain is independent.
   */
  pinnedHost?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly storage: TokenStorageAdapter;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthenticated: (() => void) | undefined;
  private refreshPromise: Promise<AuthTokens | null> | null = null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.storage = config.storage;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
    const baseFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    if (config.pinnedFingerprints && config.pinnedFingerprints.length > 0) {
      const host = config.pinnedHost ?? extractHost(config.baseUrl);
      this.fetchImpl = createPinnedFetch(
        { host, pinnedFingerprints: config.pinnedFingerprints },
        baseFetch,
      );
    } else {
      this.fetchImpl = baseFetch;
    }
    this.onUnauthenticated = config.onUnauthenticated;
  }

  // ── Storage passthroughs (used by auth helpers) ───────────────────

  getStorage(): TokenStorageAdapter {
    return this.storage;
  }

  async getAccessToken(): Promise<string | null> {
    return this.storage.get(StorageKeys.ACCESS_TOKEN);
  }

  async getRefreshToken(): Promise<string | null> {
    return this.storage.get(StorageKeys.REFRESH_TOKEN);
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    await Promise.all([
      this.storage.set(StorageKeys.ACCESS_TOKEN, tokens.accessToken),
      this.storage.set(StorageKeys.REFRESH_TOKEN, tokens.refreshToken),
    ]);
  }

  async clearTokens(): Promise<void> {
    await Promise.all([
      this.storage.remove(StorageKeys.ACCESS_TOKEN),
      this.storage.remove(StorageKeys.REFRESH_TOKEN),
      this.storage.remove(StorageKeys.USER),
    ]);
  }

  // ── Public verb helpers (parallel each other; thin wrappers) ─────

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  // ── Core request ─────────────────────────────────────────────────

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const result = await this.executeRequest<T>(method, path, options);

    // Authenticated request rejected with 401 → attempt one refresh
    // and retry. Public routes (login, register) treat 401 as a
    // legitimate domain error so we never retry them.
    if (
      result.status === 'unauthorized' &&
      !options.public &&
      !options.skipRefresh
    ) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        const retry = await this.executeRequest<T>(method, path, options);
        if (retry.status === 'ok') return retry.value;
        if (retry.status === 'unauthorized') {
          await this.clearTokens();
          this.onUnauthenticated?.();
        }
        throw retry.error;
      }
      await this.clearTokens();
      this.onUnauthenticated?.();
      throw result.error;
    }

    if (result.status === 'ok') return result.value;
    throw result.error;
  }

  // ── Internal: execute one fetch ─────────────────────────────────

  private async executeRequest<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<RequestResult<T>> {
    const {
      body,
      params,
      idempotencyKey,
      public: isPublic,
      skipRefresh: _skipRefresh,
      timeoutMs,
      ...fetchOptions
    } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((fetchOptions.headers as Record<string, string>) ?? {}),
    };

    if (!isPublic) {
      const auth = await this.buildAuthHeader();
      Object.assign(headers, auth);
    }

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const url = this.buildUrl(path, params);
    const controller = new AbortController();
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    const timer = effectiveTimeout
      ? setTimeout(() => controller.abort(), effectiveTimeout)
      : null;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...fetchOptions,
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : null,
        signal: fetchOptions.signal ?? controller.signal,
      });
    } catch (cause) {
      if (timer) clearTimeout(timer);
      const message =
        cause instanceof Error ? cause.message : 'Network request failed';
      return {
        status: 'error',
        error: new ApiClientError(0, message, NETWORK_ERROR_CODE, undefined),
      };
    }
    if (timer) clearTimeout(timer);

    if (response.status === 401) {
      const err = await parseErrorBody(response);
      return {
        status: 'unauthorized',
        error: new ApiClientError(
          response.status,
          err.message,
          err.code,
          err.details,
          err.traceId,
        ),
      };
    }

    if (!response.ok) {
      const err = await parseErrorBody(response);
      return {
        status: 'error',
        error: new ApiClientError(
          response.status,
          err.message,
          err.code,
          err.details,
          err.traceId,
        ),
      };
    }

    if (response.status === 204) {
      return { status: 'ok', value: undefined as T };
    }

    const value = (await response.json()) as T;
    return { status: 'ok', value };
  }

  // ── Auth header + refresh ─────────────────────────────────────

  private async buildAuthHeader(): Promise<Record<string, string>> {
    let token = await this.getAccessToken();
    if (token && isJwtExpired(token)) {
      const refreshed = await this.refreshAccessToken();
      token = refreshed?.accessToken ?? null;
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Refresh the access token. Concurrent calls share the same
   * in-flight promise, so a fan-out of stale-token requests only
   * burns one refresh token.
   */
  async refreshAccessToken(): Promise<AuthTokens | null> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(): Promise<AuthTokens | null> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await this.fetchImpl(
        this.buildUrl('/auth/refresh'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ refreshToken }),
        },
      );
      if (!response.ok) {
        await this.clearTokens();
        return null;
      }
      const tokens = (await response.json()) as AuthTokens;
      await this.setTokens(tokens);
      return tokens;
    } catch {
      await this.clearTokens();
      return null;
    }
  }

  // ── URL building ──────────────────────────────────────────────

  private buildUrl(
    path: string,
    params?: RequestOptions['params'],
  ): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${this.baseUrl}${cleanPath}`;

    if (params) {
      const search = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
        )
        .join('&');
      if (search) {
        url += url.includes('?') ? `&${search}` : `?${search}`;
      }
    }
    return url;
  }
}

/** Internal helper — discriminated union returned from `executeRequest`. */
type RequestResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'unauthorized'; error: ApiClientError }
  | { status: 'error'; error: ApiClientError };

function normalizeBaseUrl(input: string): string {
  const trimmed = input.replace(/\/+$/, '');
  if (trimmed.endsWith(API_PREFIX)) return trimmed;
  return `${trimmed}${API_PREFIX}`;
}

/**
 * Extract the bare hostname from a URL string. Falls back to the
 * raw input when parsing fails so callers always get a stable
 * pinning host string (cert pinning then becomes a no-op on the
 * malformed input rather than throwing at boot).
 */
function extractHost(input: string): string {
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

/**
 * Convenience factory — most callers don't need to subclass.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
