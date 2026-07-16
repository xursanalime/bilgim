import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { supportedLocales, defaultLocale } from '@bilgim/i18n';

// Real access/refresh JWTs are HttpOnly (`access_token` / `refresh_token`,
// set by apps/api's AuthController) — middleware never reads or writes
// their value directly, it only forwards them. Routing decisions here use
// the non-sensitive `bilgim_session_hint` cookie the API sets alongside
// them (`{ sub, email, role, publicId, exp }`, mirrors the JWT's claims
// but grants no access on its own).
const SESSION_HINT_COOKIE = 'bilgim_session_hint';
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SessionHint {
  sub: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  publicId?: string;
  exp: number;
}

// Routes that don't require authentication
const publicPaths = [
  '/login',
  '/signup',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/password-reset',
  '/verify-email',
  '/i/', // invite links
];

// Routes that are always public (marketing/landing pages)
const marketingPaths = [
  '/',
  '/about',
  '/pricing',
  '/search',
  '/t/',
  '/discover',
  '/teachers',
  '/courses',
  '/talabalar-uchun',
];

// Dashboard routes that require authentication
const protectedPrefixes = [
  '/dashboard',
  '/admin',
  '/student',
  '/groups',
  '/lessons',
  '/live',
  '/schedule',
  '/my-courses',
  '/notifications',
  '/messages',
  '/settings',
  '/onboarding',
  '/assignments',
  '/submissions',
  '/teacher',
  '/requests',
];

// i18n middleware
const intlMiddleware = createMiddleware({
  locales: [...supportedLocales],
  defaultLocale,
  localePrefix: 'as-needed',
});

function stripLocalePrefix(pathname: string): string {
  const localePattern = /^\/(uz|ru|en)(\/|$)/;
  return pathname.replace(localePattern, '/');
}

function isProtectedPath(pathname: string): boolean {
  const pathWithoutLocale = stripLocalePrefix(pathname);
  return protectedPrefixes.some(
    (prefix) =>
      pathWithoutLocale === prefix || pathWithoutLocale.startsWith(`${prefix}/`),
  );
}

function isPublicPath(pathname: string): boolean {
  const pathWithoutLocale = stripLocalePrefix(pathname);

  return (
    marketingPaths.some(
      (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(p),
    ) ||
    publicPaths.some((p) => pathWithoutLocale.startsWith(p))
  );
}

function readSessionHint(request: NextRequest): SessionHint | null {
  const raw = request.cookies.get(SESSION_HINT_COOKIE)?.value;
  if (!raw) return null;
  try {
    const hint = JSON.parse(raw) as SessionHint;
    if (!hint.exp || hint.exp * 1000 < Date.now()) return null;
    return hint;
  } catch {
    return null;
  }
}

/**
 * Ask the API to rotate the refresh token, forwarding the browser's
 * cookies along (middleware runs server-side, so `fetch` does not
 * automatically attach the incoming request's cookies — they must be
 * passed explicitly). Returns the raw `Set-Cookie` header values from
 * the API response so the caller can mirror them onto the outgoing
 * response verbatim (they're already correctly HttpOnly/Secure/SameSite).
 */
async function refreshSessionCookies(
  request: NextRequest,
): Promise<string[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const setCookies = res.headers.getSetCookie?.() ?? [];
    return setCookies.length > 0 ? setCookies : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check authentication for protected routes (dashboard, courses, etc.)
  if (isProtectedPath(pathname)) {
    const hint = readSessionHint(request);

    // Happy path: a valid (unexpired) session hint is present — the real
    // HttpOnly access token cookie rides along automatically on the
    // eventual API calls, nothing to do here.
    if (hint) {
      return intlMiddleware(request);
    }

    // Hint missing/expired — try a silent refresh using the HttpOnly
    // refresh token cookie so the user isn't bounced to login.
    const setCookies = await refreshSessionCookies(request);
    if (setCookies) {
      const response = intlMiddleware(request) ?? NextResponse.next();
      for (const cookie of setCookies) {
        response.headers.append('set-cookie', cookie);
      }
      return response;
    }

    // No way to authenticate → redirect to login with a callback.
    const locale = pathname.match(/^\/(uz|ru|en)\//)?.[1] || defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    const redirect = NextResponse.redirect(loginUrl);
    // Clear the stale hint so we don't loop; the HttpOnly cookies (if any)
    // are already invalid/expired server-side or will be on next use.
    redirect.cookies.set(SESSION_HINT_COOKIE, '', { path: '/', maxAge: 0 });
    return redirect;
  }

  // Apply i18n middleware for all other routes
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
