/**
 * Auth helpers — thin re-exports over the shared SDK.
 *
 * Token persistence is handled by `@bilgim/api-client`'s storage
 * adapter (wired up in `lib/api-client.ts` against `expo-secure-store`).
 * This module keeps the legacy `getAccessToken` / `setTokens` / etc.
 * exports so existing screens compile, but every call funnels through
 * the SDK so refresh dedup and the unauthenticated callback stay in
 * one place.
 */

import {
  decodeJwt,
  isJwtExpired,
  StorageKeys,
  type AuthTokens,
  type DecodedJwtPayload,
} from '@bilgim/api-client';

import { sdk } from './api-client';
import { tokenStorageAdapter } from './secure-storage';

// ────────────────────────────────────────────────────────────────
// Storage keys (re-exported for places that import the constants
// directly — e.g. legacy code wiping the user blob).
// ────────────────────────────────────────────────────────────────

export const ACCESS_TOKEN_KEY = StorageKeys.ACCESS_TOKEN;
export const REFRESH_TOKEN_KEY = StorageKeys.REFRESH_TOKEN;
export const USER_KEY = StorageKeys.USER;

export type { AuthTokens };

/**
 * `DecodedJwtPayload` from the SDK uses `string | undefined` for
 * `email` and `role`. The mobile UI assumes both are present (the
 * NestJS auth controller always emits them), so we narrow the type
 * here for ergonomic use in components.
 */
export interface DecodedToken extends DecodedJwtPayload {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  iat: number;
  exp: number;
}

// ────────────────────────────────────────────────────────────────
// Storage passthroughs — these all delegate to the SDK's adapter so
// the auth context, screens, and SDK never disagree on token state.
// ────────────────────────────────────────────────────────────────

export function getAccessToken(): Promise<string | null> {
  return sdk.client.getAccessToken();
}

export function getRefreshToken(): Promise<string | null> {
  return sdk.client.getRefreshToken();
}

export function setTokens(tokens: AuthTokens): Promise<void> {
  return sdk.client.setTokens(tokens);
}

export function clearTokens(): Promise<void> {
  return sdk.client.clearTokens();
}

/**
 * Cached `LoginResponse.user` blob — written by `sdk.auth.login()` on
 * success. The mobile auth context reads it on cold start so it can
 * render the user's name before `/auth/me` returns.
 */
export function getCachedUser(): Promise<string | null> {
  return tokenStorageAdapter.get(USER_KEY);
}

// ────────────────────────────────────────────────────────────────
// JWT helpers (no native deps)
// ────────────────────────────────────────────────────────────────

export function decodeToken(token: string): DecodedToken | null {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  if (
    typeof decoded.email !== 'string' ||
    typeof decoded.role !== 'string' ||
    typeof decoded.sub !== 'string'
  ) {
    return null;
  }
  return decoded as DecodedToken;
}

export function isTokenExpired(token: string): boolean {
  return isJwtExpired(token);
}
