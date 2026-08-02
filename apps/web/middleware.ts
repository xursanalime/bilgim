import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { supportedLocales, defaultLocale } from '@edubridge/i18n';
import { cookieDomainFor, mapTeacherHomePath, resolveTeacherSlug, rootHostFor } from './lib/tenant';

const TEACHER_SLUG_HEADER = 'x-teacher-slug';
const PREVIEW_QUERY_PARAM = 'preview';

const AUTH_COOKIE = 'bilgim_access_token';
const REFRESH_COOKIE = 'bilgim_refresh_token';
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

/**
 * `true` for routes that never require a session — the marketing surface
 * and the auth screens themselves.
 *
 * Used by `isStaticAsset` to decide whether a dotted path is a real file
 * request or a page. It is deliberately *not* used to grant access:
 * authorization is allow-by-exception via {@link isProtectedPath}, so a
 * route missing from these lists fails safe (unprotected-but-harmless)
 * rather than becoming publicly readable.
 */
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
 * File extensions that identify a genuine static asset.
 *
 * The middleware used to skip *any* path containing a `.`, and the
 * `matcher` below excluded them too. That meant a dotted path segment
 * bypassed the middleware entirely — `/dashboard/courses/abc.def` never
 * reached the auth check and rendered the protected shell to an
 * anonymous visitor. Matching a known extension at the END of the path
 * closes that hole while still short-circuiting real asset requests.
 */
const STATIC_ASSET_EXT =
  /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|json|txt|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf)$/i;

function isStaticAsset(pathname: string): boolean {
  return STATIC_ASSET_EXT.test(pathname);
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

/**
 * Whether `slug` is actually claimed by a TeacherProfile — backs the
 * "unclaimed subdomain → redirect to the root domain" rule (Task 6). Fails
 * OPEN (treats the slug as claimed) on a network/API error so a transient
 * API outage doesn't take down every teacher's subdomain at once; the page
 * itself still 404s gracefully if something is genuinely wrong.
 */
/**
 * In-process memo for {@link slugIsClaimed}.
 *
 * Without it every single request to a teacher subdomain fanned out to an
 * extra API call — an unauthenticated 1:1 request amplifier against the
 * API, and a latency tax on every page load. The window is short so a
 * newly claimed (or released) slug still takes effect promptly.
 */
const SLUG_CACHE_TTL_MS = 60_000;
const slugCache = new Map<string, { claimed: boolean; expiresAt: number }>();

async function slugIsClaimed(slug: string): Promise<boolean> {
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.claimed;
  }

  let claimed = true; // fail OPEN — see the doc comment above
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/discovery/teachers/slug/${encodeURIComponent(slug)}/exists`,
    );
    if (res.ok) {
      const data = (await res.json()) as { exists?: boolean };
      claimed = data.exists !== false;
    } else {
      // Don't cache a transient upstream failure as a result.
      return true;
    }
  } catch {
    return true;
  }

  slugCache.set(slug, { claimed, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return claimed;
}

function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
  domain: string | undefined,
): void {
  const secure = process.env.NODE_ENV === 'production';
  const common = {
    // httpOnly: the rotated tokens must stay unreadable to client JS, exactly
    // like the ones the BFF login/proxy endpoints set — otherwise a silent
    // refresh would quietly re-introduce a JS-readable token and undo the
    // XSS-hardening. Server code (this middleware, the proxy) reads them fine.
    httpOnly: true,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax' as const,
    secure,
    ...(domain && { domain }),
  };
  response.cookies.set(AUTH_COOKIE, tokens.accessToken, common);
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, common);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals. Note this checks for a real
  // asset *extension*, not merely "contains a dot" — see `isStaticAsset`.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    isStaticAsset(pathname)
  ) {
    return NextResponse.next();
  }

  // Multi-tenant subdomain routing: "{slug}.bilgim.uz" is a teacher's public
  // "onlayn maktab". Mutate the incoming request's headers (not a clone) so
  // every downstream response construction in this function — including
  // next-intl's own `NextResponse.rewrite(url, { request: { headers } })`,
  // which clones `request.headers` at call time — forwards the slug to the
  // Server Component render, readable via `headers().get('x-teacher-slug')`.
  const teacherSlug = resolveTeacherSlug(request.headers.get('host'));
  if (teacherSlug) {
    request.headers.set(TEACHER_SLUG_HEADER, teacherSlug);

    // Unclaimed subdomain (publicSlug not yet set on any TeacherProfile) →
    // bounce to the root domain, UNLESS this is a "Ko'rib chiqish" preview
    // request (Task 6) — those intentionally target a slug that may not be
    // saved yet, and the signed preview token is its own authorization.
    const isPreview = request.nextUrl.searchParams.has(PREVIEW_QUERY_PARAM);
    if (!isPreview && !(await slugIsClaimed(teacherSlug))) {
      const rootUrl = new URL(request.nextUrl);
      rootUrl.host = rootHostFor(request.headers.get('host'));
      rootUrl.pathname = '/';
      rootUrl.search = '';
      return NextResponse.redirect(rootUrl, 302);
    }
  }

  const cookieDomain = cookieDomainFor(request.headers.get('host'));

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
        setAuthCookies(response, refreshed, cookieDomain);
        return response;
      }
    }

    // No way to authenticate → redirect to login with a callback.
    const locale = pathname.match(/^\/(uz|ru|en)\//)?.[1] || defaultLocale;
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    const redirect = NextResponse.redirect(loginUrl);
    // Clear any stale auth cookies so we don't loop. Must repeat the same
    // `domain` the cookie was set with — otherwise the browser drops a new
    // host-only cookie alongside the old domain-scoped one instead of
    // clearing it.
    const clear = { path: '/', maxAge: 0, ...(cookieDomain && { domain: cookieDomain }) };
    redirect.cookies.set(AUTH_COOKIE, '', clear);
    redirect.cookies.set(REFRESH_COOKIE, '', clear);
    return redirect;
  }

  // Teacher subdomain home page: internally rewrite "/" (or a locale root
  // like "/ru") to the existing `/teachers/[publicSlug]` route so the
  // browser URL stays "aziz.bilgim.uz/" while next-intl's own rewrite (see
  // the header-forwarding comment above) renders that page underneath.
  if (teacherSlug) {
    const mapped = mapTeacherHomePath(pathname, teacherSlug);
    if (mapped) {
      request.nextUrl.pathname = mapped;
    }
  }

  // Apply i18n middleware for all other routes
  return intlMiddleware(request);
}

export const config = {
  // Match all paths except Next.js internals and genuine static assets.
  //
  // The previous pattern ended in `.*\\..*`, excluding EVERY path with a
  // dot in it — so `/dashboard/courses/abc.def` skipped the middleware and
  // its auth check entirely. The extension list below mirrors
  // `STATIC_ASSET_EXT`, so only real asset requests are excluded and a
  // dotted route param still gets authenticated.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|json|txt|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf)$).*)',
  ],
};
