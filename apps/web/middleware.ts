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

/**
 * Whether `slug` is actually claimed by a TeacherProfile — backs the
 * "unclaimed subdomain → redirect to the root domain" rule (Task 6). Fails
 * OPEN (treats the slug as claimed) on a network/API error so a transient
 * API outage doesn't take down every teacher's subdomain at once; the page
 * itself still 404s gracefully if something is genuinely wrong.
 */
async function slugIsClaimed(slug: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/discovery/teachers/slug/${encodeURIComponent(slug)}/exists`,
    );
    if (!res.ok) return true;
    const data = (await res.json()) as { exists?: boolean };
    return data.exists !== false;
  } catch {
    return true;
  }
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

async function handleRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
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

/**
 * Build the Content-Security-Policy for a request. The XSS-critical
 * `script-src` is locked to `'self'` + a per-request nonce + `'strict-dynamic'`
 * (so no injected inline `<script>` or event handler can run), while the
 * connection/media directives stay permissive enough not to break WebRTC
 * (LiveKit/mediasoup), R2 media, or the API. `'wasm-unsafe-eval'` is needed
 * by tldraw/mediasoup WASM. Next.js reads the nonce from the CSP header we
 * put on the request and stamps it onto its own hydration scripts.
 */
function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `media-src 'self' blob: data: https:`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `connect-src 'self' https: wss: ws:`,
    `frame-src 'self' https: blob:`,
  ].join('; ');
}

/** Base64 nonce from the Edge-runtime WebCrypto UUID. */
function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Public entry point. Wraps the routing/auth logic in `handleRequest` and
 * layers on a nonce-based CSP.
 *
 * CSP is enforced in production (or when `WEB_CSP=1`) but skipped in dev,
 * because Next's HMR / react-refresh inject un-nonced inline scripts and use
 * eval — a strict `script-src` would break the dev overlay. Everything else
 * (httpOnly cookies, the BFF proxy, the static headers from next.config) is
 * always on; CSP is the one piece that must wait for a production build.
 */
export async function middleware(request: NextRequest) {
  const cspEnabled =
    process.env.NODE_ENV === 'production' || process.env.WEB_CSP === '1';

  let csp: string | undefined;
  if (cspEnabled) {
    const nonce = generateNonce();
    csp = buildCsp(nonce);
    // Next reads the nonce off the request's CSP header to nonce its scripts.
    request.headers.set('x-nonce', nonce);
    request.headers.set('content-security-policy', csp);
  }

  const response = await handleRequest(request);

  if (csp) {
    response.headers.set('content-security-policy', csp);
  }
  return response;
}

export const config = {
  // Match all paths except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
