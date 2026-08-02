/**
 * Server-side auth helpers for the dashboard route group.
 *
 * The middleware (`apps/web/middleware.ts`) already redirects unauthenticated
 * requests away from `/dashboard`, `/courses`, `/groups`, `/lessons`, and
 * `/settings`. These helpers run in Server Components and provide:
 *   1. The decoded JWT payload (role, sub, email).
 *   2. A `requireRole(...)` guard that redirects a user to a sensible target
 *      page when they hit a route their role cannot use (e.g. STUDENT lands
 *      on `/dashboard` and gets bounced to the student dashboard later).
 *
 * The cookie value is the same access token the client uses; decoding it
 * server-side avoids round-tripping to the API for every dashboard render.
 * Signature verification happens on the API for every authenticated request,
 * so this is purely a "what role does the user claim to be" decode.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { defaultLocale } from '@edubridge/i18n';

const ACCESS_TOKEN_COOKIE = 'bilgim_access_token';

export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface ServerAuthUser {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Best-effort base64url → utf-8 decode (no external deps; works in the
 * Edge / Node Server Components runtime).
 */
function base64UrlDecode(input: string): string {
  // Pad to a multiple of 4
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(b64), (c: string) => {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(''),
    );
  }
  // Node fallback
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function decodeJwt(token: string): ServerAuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const json = base64UrlDecode(parts[1]);
    const payload = JSON.parse(json) as ServerAuthUser;
    if (!payload.sub || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Returns the decoded user from the cookie, or null when missing/expired. */
export function getServerUser(): ServerAuthUser | null {
  const token = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  if (decoded.exp && decoded.exp * 1000 <= Date.now()) return null;
  return decoded;
}

/** Returns the raw access token (for forwarding to the API). */
export function getServerAccessToken(): string | null {
  return cookies().get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

/**
 * Server-side role guard. Redirects:
 *   - Unauthenticated → `/{locale}/login` (defensive — middleware should
 *     already have done this).
 *   - Wrong role → `/{locale}/dashboard` (the role-specific dashboard
 *     bounce is handled by the dashboard page itself).
 */
export function requireRole(
  allowed: UserRole | UserRole[],
  locale: string = defaultLocale,
): ServerAuthUser {
  const user = getServerUser();
  if (!user) {
    redirect(`/${locale}/login`);
  }
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedRoles.includes(user.role)) {
    redirect(`/${locale}/dashboard`);
  }
  return user;
}
