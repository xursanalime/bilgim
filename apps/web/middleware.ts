import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { supportedLocales, defaultLocale } from '@edubridge/i18n';

const AUTH_COOKIE = 'edubridge_access_token';
const REFRESH_COOKIE = 'edubridge_refresh_token';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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

/**
 * Basic JWT expiry check (without signature verification — server validates fully).
 * Returns true if token appears valid and not expired.
 */
function isTokenValid(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const payload = JSON.parse(atob(parts[1]!));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Exchange a refresh token for a fresh access/refresh pair via the API.
 * Returns the new tokens or null when the refresh token is invalid/expired.
 */
async function refreshTokens(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken || !data.refreshToken) return null;
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch {
    return null;
  }
}

function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const secure = process.env.NODE_ENV === 'production';
  const common = {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax' as const,
    secure,
  };
  response.cookies.set(AUTH_COOKIE, tokens.accessToken, common);
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, common);
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
    const accessToken = request.cookies.get(AUTH_COOKIE)?.value;

    // Happy path: a valid (unexpired) access token is present.
    if (accessToken && isTokenValid(accessToken)) {
      return intlMiddleware(request);
    }

    // Access token missing/expired — try to silently refresh using the
    // long-lived refresh token cookie so the user is NOT bounced to login.
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (refreshToken) {
      const refreshed = await refreshTokens(refreshToken);
      if (refreshed) {
        // Mirror the fresh access token onto the incoming request cookies so
        // any Server Component reading it in this same pass sees the new one.
        request.cookies.set(AUTH_COOKIE, refreshed.accessToken);
        // Re-run the i18n middleware to build the normal response, then
        // attach the rotated cookies so the browser keeps the new session.
        const response = intlMiddleware(request) ?? NextResponse.next();
        setAuthCookies(response, refreshed);
        return response;
      }
    }

    // No way to authenticate → redirect to login with a callback.
    const locale = pathname.match(/^\/(uz|ru|en)\//)?.[1] || defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    const redirect = NextResponse.redirect(loginUrl);
    // Clear any stale auth cookies so we don't loop.
    redirect.cookies.set(AUTH_COOKIE, '', { path: '/', maxAge: 0 });
    redirect.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 });
    return redirect;
  }

  // Apply i18n middleware for all other routes
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
