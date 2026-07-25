/**
 * Client-side auth utilities for the Bilgim web app.
 *
 * SECURITY MODEL (changed 2026-07-24):
 *   The session tokens are NO LONGER accessible to client JavaScript. They
 *   live exclusively in **httpOnly** cookies written by server code:
 *     - `app/api/auth/login`  — sets them on sign-in
 *     - `app/api/proxy/*`     — rotates them on a 401
 *     - `middleware.ts`       — silent-refresh on navigation
 *   Every authenticated API call goes through the same-origin BFF proxy
 *   (`/api/proxy/*`), which reads the httpOnly cookie server-side and
 *   attaches the Bearer header. Because no token is ever in `localStorage`
 *   or a JS-readable cookie, an XSS payload has nothing to steal.
 *
 *   This module now only reads the NON-secret `bilgim_user` profile cookie
 *   (id/email/role/name — no token) so the UI can render role-specific
 *   chrome without a round-trip.
 */

import { USER_COOKIE } from './auth-cookies';

/** Kept for backwards compatibility with existing callers. */
export interface DecodedToken {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  fullName?: string;
  iat: number;
  exp: number;
}

interface StoredUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  fullName: string;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function readStoredUser(): StoredUser | null {
  const raw = readCookie(USER_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredUser>;
    if (!parsed || typeof parsed.role !== 'string' || typeof parsed.id !== 'string') {
      return null;
    }
    return parsed as StoredUser;
  } catch {
    return null;
  }
}

// --- Public API (names preserved for existing callers) ---

/**
 * The current signed-in user, read from the readable profile cookie. Returns
 * `null` when signed out. This is a "who does the browser think it is" hint
 * for rendering — the API still verifies the real token on every request.
 */
export function getCurrentUser(): DecodedToken | null {
  const user = readStoredUser();
  if (!user) return null;
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    iat: 0,
    exp: 0,
  };
}

export function isAuthenticated(): boolean {
  return readStoredUser() !== null;
}

export function getUserRole(): DecodedToken['role'] | null {
  return readStoredUser()?.role ?? null;
}

/**
 * Sign out. The httpOnly token cookies can only be cleared by the server, so
 * this calls the BFF logout endpoint (which revokes the refresh session and
 * sends the clearing `Set-Cookie`s) and drops the readable profile cookie
 * locally. Returns the in-flight request so callers may `await` it before
 * redirecting; firing it without awaiting is also safe.
 */
export function clearTokens(): Promise<void> {
  if (typeof document !== 'undefined') {
    // Drop the readable profile cookie immediately so UI updates without
    // waiting for the round-trip. The httpOnly tokens are cleared by the
    // logout response below.
    document.cookie = `${USER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
  if (typeof window === 'undefined') return Promise.resolve();
  return fetch('/api/auth/logout', { method: 'POST' })
    .then(() => undefined)
    .catch(() => undefined);
}
