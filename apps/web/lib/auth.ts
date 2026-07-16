/**
 * Authentication utilities for Bilgim web app.
 *
 * The real access/refresh JWTs live ONLY in HttpOnly cookies set by the
 * API (`apps/api/.../auth.controller.ts`) — this module never reads or
 * writes them, so an XSS bug in this app can no longer steal a session.
 * The browser attaches those cookies automatically on same-site requests
 * (see `lib/api-client.ts`'s `credentials: 'include'`); nothing here needs
 * to know the token's value to use it.
 *
 * For UI/routing decisions (Am I logged in? What's my role?) this module
 * reads a second, deliberately non-sensitive `bilgim_session_hint` cookie
 * that the API sets alongside the HttpOnly ones. It mirrors the JWT's
 * claims but grants no access on its own — the API never trusts it.
 */

export interface DecodedToken {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  /**
   * 6-digit public user identifier (e.g. "100001"). Optional because tokens
   * minted before this claim was introduced won't carry it.
   */
  publicId?: string;
  exp: number;
}

const SESSION_HINT_COOKIE = 'bilgim_session_hint';

function readSessionHint(): DecodedToken | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${SESSION_HINT_COOKIE}=`));
  if (!match) return null;
  try {
    return JSON.parse(
      decodeURIComponent(match.slice(SESSION_HINT_COOKIE.length + 1)),
    ) as DecodedToken;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const hint = readSessionHint();
  if (!hint) return false;
  return Date.now() < hint.exp * 1000;
}

export function getCurrentUser(): DecodedToken | null {
  const hint = readSessionHint();
  if (!hint) return null;
  if (Date.now() >= hint.exp * 1000) return null;
  return hint;
}

export function getUserRole(): DecodedToken['role'] | null {
  return getCurrentUser()?.role ?? null;
}

/**
 * End the session: revokes the refresh token server-side and clears all
 * auth cookies (HttpOnly ones can only be cleared by the server). Safe to
 * call even if the session is already gone.
 */
export async function logout(): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  try {
    await fetch(`${apiUrl}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Best-effort — even if this fails, the caller still navigates away;
    // cookies will simply expire naturally (15m access / 30d refresh).
  }
}
