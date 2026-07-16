/**
 * `@bilgim/api-client` — shared HTTP client for web + mobile.
 *
 * Exports:
 *   - `ApiClient` / `createApiClient` — low-level transport with
 *     auth, refresh, error envelopes.
 *   - `createApiSdk` — convenience SDK that bundles the client with
 *     typed endpoint groups (`auth`, `lessons`, `groups`, `homework`).
 *   - `TokenStorageAdapter` + factories — pluggable persistence so
 *     each platform can wire up its own backend (cookies + localStorage
 *     on web, expo-secure-store on mobile, in-memory in tests).
 *   - JWT helpers (`decodeJwt`, `isJwtExpired`) — used by app-level auth
 *     contexts to decide when to hydrate / clear sessions.
 *   - Error types (`ApiClientError`, `parseErrorBody`) — surface
 *     `{ code, message, details, traceId }` envelopes from the NestJS
 *     `AllExceptionsFilter`.
 *
 * The package is **runtime-agnostic** and pure TypeScript / standard
 * `fetch` — no React Native, browser, or Node-only imports — so it is
 * safe to ship into any of the three runtimes.
 */

// Core transport
export {
  ApiClient,
  createApiClient,
  type ApiClientConfig,
} from './client';

// SDK convenience surface
export {
  createApiSdk,
  createApiSdkFromClient,
  type ApiSdk,
} from './sdk';

// Endpoint groups — exported so callers can swap the SDK out for the
// raw factories, or extend with their own.
export * from './endpoints';

// Storage primitives
export {
  StorageKeys,
  createMemoryStorage,
  createLocalStorageAdapter,
  type TokenStorageAdapter,
  type StorageKey,
} from './storage';

// Errors
export {
  ApiClientError,
  NETWORK_ERROR_CODE,
  isNetworkError,
  parseErrorBody,
  type ApiErrorEnvelope,
} from './errors';

// JWT helpers
export {
  decodeJwt,
  isJwtExpired,
  type DecodedJwtPayload,
} from './jwt';

// Cross-cutting types
export type {
  AuthTokens,
  AuthUser,
  PaginatedResponse,
  CursorPage,
  RequestOptions,
  UserRole,
} from './types';

// Certificate pinning (Task 28.4, Req 28.9 — Node-only enforcement)
export {
  isPinningSupported,
  createPinnedFetch,
  type CertPinningConfig,
  type Sha256SpkiPin,
  type PinningSupport,
} from './cert-pinning';
