/**
 * Server-side auth cookie contract — the single source of truth for how the
 * session is stored in the browser.
 *
 * SECURITY MODEL (the reason this file exists):
 *   - `bilgim_access_token` / `bilgim_refresh_token` are **httpOnly** so no
 *     client-side JavaScript (and therefore no XSS payload) can ever read
 *     them. They are written ONLY from server code — the Next.js Route
 *     Handlers under `app/api/auth/*` and `app/api/proxy/*`, plus the
 *     middleware's silent-refresh path.
 *   - `bilgim_user` is a NON-httpOnly JSON cookie holding only non-secret
 *     profile fields (id, email, role, name). The client reads it to render
 *     role-specific UI. It carries NO token, so leaking it via XSS is
 *     worthless for authentication.
 *
 * This module is server-only (it is imported from Route Handlers and the
 * middleware, never from a Client Component).
 */

export const ACCESS_COOKIE = 'bilgim_access_token';
export const REFRESH_COOKIE = 'bilgim_refresh_token';
export const USER_COOKIE = 'bilgim_user';

/** 30 days — outlives the short access-token `exp`; refresh keeps it alive. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  fullName: string;
}

interface CookieAttrs {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge?: number;
  domain?: string;
}

/**
 * Base attributes shared by every session cookie. `sameSite: 'lax'` is what
 * makes the httpOnly cookies safe against CSRF: the browser withholds them
 * from cross-site POST/PUT/DELETE, so a malicious third-party page cannot
 * drive an authenticated state change through our same-origin proxy.
 */
function baseAttrs(domain: string | undefined, maxAge?: number): CookieAttrs {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
    ...(domain ? { domain } : {}),
  };
}

/** Options for the two httpOnly token cookies. */
export function tokenCookieOptions(
  domain: string | undefined,
  persistent: boolean,
): CookieAttrs {
  // Persistent = "remember me": survives browser restarts for 30d. Otherwise
  // omit maxAge so it becomes a session cookie (cleared when the browser closes).
  return baseAttrs(domain, persistent ? SESSION_MAX_AGE : undefined);
}

/** Options for the readable (non-httpOnly) profile cookie. */
export function userCookieOptions(
  domain: string | undefined,
  persistent: boolean,
): CookieAttrs {
  return { ...baseAttrs(domain, persistent ? SESSION_MAX_AGE : undefined), httpOnly: false };
}

/** Options used to clear a cookie (maxAge 0, same domain/path). */
export function clearCookieOptions(domain: string | undefined): CookieAttrs {
  return { ...baseAttrs(domain, 0), httpOnly: false };
}
