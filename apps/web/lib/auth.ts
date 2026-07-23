/**
 * Authentication utilities for Bilgim web app.
 * Handles JWT token storage, retrieval, and refresh logic.
 *
 * Tokens are stored in both:
 * - localStorage (for client-side access)
 * - httpOnly cookies (for middleware/SSR auth checks)
 */

import { cookieDomainFor } from './tenant';

const ACCESS_TOKEN_KEY = 'bilgim_access_token';
const REFRESH_TOKEN_KEY = 'bilgim_refresh_token';

/** Cookie lifetime — outlives the short JWT `exp` so the middleware can use
 * the refresh token to mint a new access token instead of forcing re-login. */
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface DecodedToken {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  iat: number;
  exp: number;
}

// --- Cookie helpers (client-side) ---

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string, maxAgeSec?: number): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // Scope to the root domain (".bilgim.uz") so the session set on the main
  // app is also valid on every teacher's "{slug}.bilgim.uz" — enrollment,
  // payment, live-join, and homework submission all live on the subdomain.
  const domain = cookieDomainFor(window.location.hostname);
  const domainAttr = domain ? `; domain=${domain}` : '';
  // Omitting max-age makes it a session cookie — deleted when the browser closes.
  const maxAge = typeof maxAgeSec === 'number' ? `; max-age=${maxAgeSec}` : '';
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )}; path=/${maxAge}; SameSite=Lax${secure}${domainAttr}`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  const domain = cookieDomainFor(window.location.hostname);
  const domainAttr = domain ? `; domain=${domain}` : '';
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
}

// --- Token Storage ---
//
// Tokens live in cookies so that the Next.js middleware and Server
// Components (which cannot read localStorage) share the exact same source
// of truth as the client. The access-token cookie outlives the JWT `exp`;
// the middleware refreshes it transparently using the refresh-token cookie,
// so a user stays signed in until they explicitly log out.

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return readCookie(ACCESS_TOKEN_KEY) ?? localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    readCookie(REFRESH_TOKEN_KEY) ?? localStorage.getItem(REFRESH_TOKEN_KEY)
  );
}

/**
 * Persists tokens after a successful login.
 *
 * @param remember - When true (checkbox checked), the session survives
 *   browser restarts for up to 30 days. When false, tokens live only for
 *   the current browser session (session cookie, no localStorage mirror),
 *   so closing the browser signs the user out.
 */
export function setTokens(tokens: AuthTokens, remember = true): void {
  if (typeof window === 'undefined') return;

  // Cookies are the shared source of truth (middleware + SSR + client).
  const maxAge = remember ? COOKIE_MAX_AGE : undefined;
  writeCookie(ACCESS_TOKEN_KEY, tokens.accessToken, maxAge);
  writeCookie(REFRESH_TOKEN_KEY, tokens.refreshToken, maxAge);

  try {
    if (remember) {
      // Best-effort mirror for backwards-compat — only when "remember me" is on,
      // otherwise localStorage would outlive the intended session-only cookie.
      localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota / privacy-mode errors — cookies are enough.
  }
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Ignore.
  }
  deleteCookie(ACCESS_TOKEN_KEY);
  deleteCookie(REFRESH_TOKEN_KEY);
}

// --- Token Decoding ---

export function decodeToken(token: string): DecodedToken | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload));
    return decoded as DecodedToken;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded) return true;
  // Consider token expired 30 seconds before actual expiry
  const bufferMs = 30 * 1000;
  return Date.now() >= decoded.exp * 1000 - bufferMs;
}

// --- Token Refresh ---

let refreshPromise: Promise<AuthTokens | null> | null = null;

/**
 * Refreshes the access token using the refresh token.
 * Deduplicates concurrent refresh requests.
 */
export async function refreshAccessToken(): Promise<AuthTokens | null> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = performRefresh();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function performRefresh(): Promise<AuthTokens | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const tokens: AuthTokens = await response.json();
    setTokens(tokens);
    return tokens;
  } catch {
    clearTokens();
    return null;
  }
}

// --- Auth State ---

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) return false;
  return !isTokenExpired(token);
}

export function getCurrentUser(): DecodedToken | null {
  const token = getAccessToken();
  if (!token) return null;
  if (isTokenExpired(token)) return null;
  return decodeToken(token);
}

export function getUserRole(): DecodedToken['role'] | null {
  const user = getCurrentUser();
  return user?.role ?? null;
}
