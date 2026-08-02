/**
 * AuthContext — single source of truth for the mobile session.
 *
 * Backed by the shared `@edubridge/api-client` SDK:
 *   - `sdk.auth.login()` / `sdk.auth.logout()` handle token persistence
 *     in `expo-secure-store` (via the `tokenStorageAdapter`).
 *   - `sdk.auth.register()` is a public POST; verification is gated
 *     server-side.
 *   - The SDK's `onUnauthenticated` callback (wired in
 *     `lib/api-client.ts`) tells this provider to clear the user when
 *     a refresh attempt finally fails.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { setUnauthenticatedListener, sdk } from './api-client';
import { unregisterExpoPushToken } from './notifications/token';
import { tokenStorageAdapter } from './secure-storage';
import {
  ACCESS_TOKEN_KEY,
  USER_KEY,
  clearTokens,
  getAccessToken,
  isTokenExpired,
} from './auth';
import { isMfaChallenge, type LoginOrMfaResponse } from './api/auth';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER';
}

export type LoginResult =
  | { kind: 'authenticated'; user: AuthUser }
  | {
      kind: 'mfa-required';
      mfaToken: string;
      expiresIn: number;
      methods: Array<'totp' | 'webauthn' | 'backup'>;
    };

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (payload: RegisterPayload) => Promise<{ userId: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Hydrate session on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [token, rawUser] = await Promise.all([
          getAccessToken(),
          tokenStorageAdapter.get(USER_KEY),
        ]);

        if (cancelled) return;

        if (token && !isTokenExpired(token) && rawUser) {
          setUser(JSON.parse(rawUser) as AuthUser);
        } else {
          setUser(null);
        }
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ── SDK → context bridge for forced-logout events ─────────────
  useEffect(() => {
    setUnauthenticatedListener(() => setUser(null));
    return () => setUnauthenticatedListener(null);
  }, []);

  // ── Login ─────────────────────────────────────────────────────
  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const response = (await sdk.auth.login({
        email,
        password,
      })) as LoginOrMfaResponse;

      if (isMfaChallenge(response)) {
        return {
          kind: 'mfa-required',
          mfaToken: response.mfaToken,
          expiresIn: response.expiresIn,
          methods: response.methods,
        };
      }

      // sdk.auth.login() already persisted tokens + user blob to
      // secure storage, so we just need to mirror the user into
      // React state for the UI to react.
      setUser(response.user);
      return { kind: 'authenticated', user: response.user };
    },
    [],
  );

  // ── Register ──────────────────────────────────────────────────
  const register = useCallback(
    async (payload: RegisterPayload): Promise<{ userId: string }> => {
      const result = await sdk.auth.register(payload);
      return { userId: result.userId };
    },
    [],
  );

  // ── Logout ────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    // Unregister push token before clearing tokens — once the access
    // token is gone the DELETE call to `/notifications/devices/:token`
    // will fail. Best-effort: unregister errors are swallowed inside
    // `unregisterExpoPushToken`.
    await unregisterExpoPushToken();
    await clearTokens();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      register,
      logout,
    }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

// Re-export the constant so callers can clear it without importing auth.ts
export { ACCESS_TOKEN_KEY };
