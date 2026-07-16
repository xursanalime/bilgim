/**
 * Shared helpers for the media BFF (Backend-For-Frontend) route handlers
 * under `app/api/media/*`.
 *
 * The BFF's single security job is to sit between the browser and the
 * Bilgim API (`/api/v1/media/...`) so that:
 *
 *   - the browser only ever talks to same-origin `/api/media/*` endpoints;
 *   - the user's session token is attached server-side as a `Bearer`
 *     header and is NEVER echoed back to the browser;
 *   - no vendor/storage URL, DRM key, or provider credential is ever
 *     serialized into a response the DOM can read (Req 1.1, 1.4, 2.4).
 *
 * These helpers are deliberately framework-light: they operate on the Web
 * Fetch `Request`/`Response` types (which `NextRequest`/`NextResponse`
 * extend) and read the session cookie from the request's `Cookie` header,
 * so the handlers stay trivially unit-testable with a plain `Request`.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const API_PREFIX = '/api/v1';

/**
 * Session cookie names, in priority order. `bilgim_access_token` is the
 * canonical cookie set on login (see `lib/auth.ts` / `lib/server-auth.ts`);
 * `access_token` is kept as a defensive fallback to match the legacy
 * `proxy/route.ts` behaviour.
 */
const TOKEN_COOKIES = ['bilgim_access_token', 'access_token'] as const;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build an absolute API URL for an `/api/v1`-relative path. */
export function apiUrl(path: string): string {
  return new URL(`${API_PREFIX}${path}`, API_BASE_URL).toString();
}

/**
 * Extract the user's access token from the incoming request's `Cookie`
 * header. Returns `undefined` when no recognised session cookie is set so
 * callers can fail closed with a 401.
 *
 * SECURITY: the returned token is only ever used to build an `Authorization`
 * header for the upstream API call. It is never written to a response.
 */
export function getAccessToken(req: Request): string | undefined {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return undefined;

  for (const name of TOKEN_COOKIES) {
    const token = readCookie(cookieHeader, name);
    if (token) return token;
  }
  return undefined;
}

function readCookie(cookieHeader: string, name: string): string | undefined {
  // Cookie header format: `a=1; b=2; bilgim_access_token=xyz`.
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

/** A plain 401 with a hardened, non-cacheable header set. */
export function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** A plain 400 with a hardened, non-cacheable header set. */
export function badRequest(message = 'Bad Request'): Response {
  return new Response(message, {
    status: 400,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * Map an upstream API failure status onto a safe BFF status. We surface
 * auth/authorization/not-found verbatim (so the client can fail closed and
 * re-authorize) and collapse everything else into a generic `502 Bad
 * Gateway` so upstream internals never leak through.
 */
export function mapUpstreamStatus(status: number): number {
  if (status === 401) return 401;
  if (status === 403) return 403;
  if (status === 404) return 404;
  return 502;
}

/**
 * Headers attached to every BFF response carrying protected media so the
 * browser/intermediaries never cache it and cannot sniff/embed it.
 */
export function protectedResponseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}
