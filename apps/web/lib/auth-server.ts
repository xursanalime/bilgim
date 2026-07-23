/**
 * Server-side authentication helpers for App Router pages.
 *
 * The cookie `bilgim_access_token` is set on login (see `lib/auth.ts`)
 * and is what the middleware already inspects. These helpers decode the
 * JWT payload (without verifying the signature — the API enforces auth
 * server-side) so that server components can run a coarse role guard
 * before rendering and pass the user shape into client components.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const ACCESS_COOKIE = 'bilgim_access_token';

export interface ServerUser {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  iat: number;
  exp: number;
}

/**
 * Decode a JWT body. We do NOT verify the signature here — the API has
 * the JwtAuthGuard on every protected route and is the source of truth.
 * This decode is purely so a server component can render the right shell.
 */
function decodeJwt(token: string): ServerUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    // base64url → base64
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) as ServerUser;
  } catch {
    return null;
  }
}

function isExpired(user: ServerUser): boolean {
  if (!user.exp) return true;
  return user.exp * 1000 < Date.now();
}

/**
 * Read the access token from the request cookies and decode it. Returns
 * `null` when the cookie is missing, malformed, or expired.
 */
export function getServerUser(): ServerUser | null {
  const cookieStore = cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const user = decodeJwt(token);
  if (!user || isExpired(user)) return null;
  return user;
}

interface RequireAuthOptions {
  /** Restrict to one or more roles. Defaults to "any authenticated user". */
  roles?: ServerUser['role'][];
  /** Locale to embed in the redirect target. */
  locale: string;
  /** Where to send the user after successful login. */
  callbackUrl?: string;
}

/**
 * Server-side guard for pages. Redirects to `/login` when no valid
 * session cookie is present, or to `/dashboard` when the user is
 * authenticated but lacks the required role (so we never render a
 * student dashboard for a teacher and vice-versa).
 */
export function requireAuth({
  roles,
  locale,
  callbackUrl,
}: RequireAuthOptions): ServerUser {
  const user = getServerUser();
  if (!user) {
    const target = callbackUrl
      ? `/${locale}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : `/${locale}/login`;
    redirect(target);
  }
  if (roles && !roles.includes(user.role)) {
    redirect(`/${locale}/dashboard`);
  }
  return user;
}
