/**
 * Mobile API client — instantiates the shared `@edubridge/api-client`
 * SDK with the platform-specific `expo-secure-store` adapter.
 *
 * Resolution order for the API base URL:
 *   1. `process.env.EXPO_PUBLIC_API_URL`        (Metro inlines at build time)
 *   2. `Constants.expoConfig.extra.apiUrl`      (set by `app.config.ts`)
 *   3. `Constants.expoConfig.extra.EXPO_PUBLIC_API_URL`  (alternate key)
 *   4. `http://localhost:4000`                   (last-resort default)
 *
 * The SDK already appends `/api/v1`, so this module is allowed to pass
 * either `http://host` or `http://host/api/v1` — both behave identically.
 */

import {
  ApiClientError,
  createApiSdk,
  isJwtExpired,
  type ApiSdk,
  type AuthTokens,
  type AuthUser,
} from '@edubridge/api-client';
import Constants from 'expo-constants';

import { tokenStorageAdapter } from './secure-storage';

const DEFAULT_API_URL = 'http://localhost:4000';

function resolveApiBase(): string {
  const fromProcess = process.env.EXPO_PUBLIC_API_URL;
  if (fromProcess && fromProcess.length > 0) return fromProcess;

  const extra = Constants.expoConfig?.extra as
    | Record<string, unknown>
    | undefined;
  const fromExtra =
    (extra?.apiUrl as string | undefined) ??
    (extra?.EXPO_PUBLIC_API_URL as string | undefined);
  if (fromExtra && fromExtra.length > 0) return fromExtra;

  return DEFAULT_API_URL;
}

/**
 * Side-channel hook fired when the SDK wipes tokens (refresh failed,
 * 401 retry exhausted). The auth context subscribes to this so it can
 * push the user back to the login screen without each call site having
 * to listen for ApiClientError(401).
 */
let onUnauthenticatedListener: (() => void) | null = null;

export function setUnauthenticatedListener(listener: (() => void) | null) {
  onUnauthenticatedListener = listener;
}

export const sdk: ApiSdk = createApiSdk({
  baseUrl: resolveApiBase(),
  storage: tokenStorageAdapter,
  onUnauthenticated: () => onUnauthenticatedListener?.(),
});

/**
 * Bare `apiClient` proxy that exposes the verb-style helpers most code
 * already imports. Backed by the shared SDK so refresh dedup, error
 * envelopes, and 401 retry remain in one place.
 */
export const apiClient = {
  get: sdk.client.get.bind(sdk.client),
  post: sdk.client.post.bind(sdk.client),
  put: sdk.client.put.bind(sdk.client),
  patch: sdk.client.patch.bind(sdk.client),
  delete: sdk.client.delete.bind(sdk.client),
};

export type { AuthTokens, AuthUser };
export { ApiClientError, isJwtExpired };

export default apiClient;
