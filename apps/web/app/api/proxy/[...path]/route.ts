import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { clientIpHeaders } from '../../../../lib/client-ip';
import { cookieDomainFor } from '../../../../lib/tenant';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  tokenCookieOptions,
} from '../../../../lib/auth-cookies';

export const dynamic = 'force-dynamic';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Backend-for-Frontend proxy.
 *
 * Every authenticated browser→API call is routed through here (same origin
 * as the web app). The access token lives in an httpOnly cookie that only
 * this server code can read; we attach it as `Authorization: Bearer` on the
 * way out, so the token never enters the browser's JS context. On a 401 we
 * transparently rotate the token using the httpOnly refresh cookie and retry
 * once, then hand the browser fresh httpOnly cookies — the client never sees
 * either token.
 *
 * CSRF: the session cookies are `SameSite=Lax`, so the browser already
 * withholds them from cross-site state-changing requests. As defense in
 * depth we additionally reject mutating methods whose `Origin` is not our
 * own host.
 */

// Request headers we copy verbatim from the browser. Everything else
// (cookie, host, authorization) is dropped/replaced so the client cannot
// smuggle a different identity past the cookie. The client-IP headers are
// added separately from a trusted source — never copied from the inbound
// request — so a caller cannot choose its own rate-limit bucket.
const FORWARD_REQ_HEADERS = [
  'content-type',
  'accept',
  'idempotency-key',
  'x-trace-id',
];

// Upstream response headers worth surfacing back to the browser.
const FORWARD_RES_HEADERS = ['content-type', 'x-trace-id', 'retry-after'];

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Per the Fetch spec, responses with these statuses must have a null body —
// constructing a Response/NextResponse with a non-null body (even an empty
// ArrayBuffer) for one of these throws "Invalid response status code".
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // non-CORS (same-origin fetch, curl) — no Origin sent
  const host = request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function pickHeaders(src: Headers, allow: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of allow) {
    const v = src.get(name);
    if (v) out[name] = v;
  }
  return out;
}

async function callUpstream(
  method: string,
  targetUrl: string,
  accessToken: string | undefined,
  reqHeaders: Record<string, string>,
  body: Uint8Array | undefined,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      ...reqHeaders,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    redirect: 'manual',
  };
  if (body && body.byteLength > 0) {
    init.body = body as unknown as BodyInit;
  }
  return fetch(targetUrl, init);
}

async function handle(
  request: NextRequest,
  ctx: { params: { path?: string[] } },
): Promise<NextResponse> {
  const method = request.method.toUpperCase();

  if (MUTATING.has(method) && !isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'CSRF_ORIGIN_REJECTED', message: 'Cross-origin request blocked' } },
      { status: 403 },
    );
  }

  const segments = ctx.params.path ?? [];
  const search = request.nextUrl.search ?? '';
  const targetUrl = `${API_BASE_URL}/${segments.join('/')}${search}`;

  // Forward the caller's real IP. Without it the API sees every request
  // in the system as coming from this one web server, which collapses all
  // of its per-IP rate limiting and brute-force protection into a single
  // shared bucket. See `lib/client-ip.ts`.
  const reqHeaders = {
    ...pickHeaders(request.headers, FORWARD_REQ_HEADERS),
    ...clientIpHeaders(request),
  };
  const rawBody = MUTATING.has(method)
    ? new Uint8Array(await request.arrayBuffer())
    : undefined;

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let upstream = await callUpstream(method, targetUrl, accessToken, reqHeaders, rawBody);

  // Transparent refresh-and-retry on a rejected access token.
  let rotated: { accessToken: string; refreshToken: string } | null = null;
  if (upstream.status === 401 && refreshToken) {
    rotated = await refresh(refreshToken);
    if (rotated) {
      accessToken = rotated.accessToken;
      upstream = await callUpstream(method, targetUrl, accessToken, reqHeaders, rawBody);
    }
  }

  const resBody = NULL_BODY_STATUSES.has(upstream.status)
    ? null
    : await upstream.arrayBuffer();
  const res = new NextResponse(resBody, {
    status: upstream.status,
    headers: pickHeaders(upstream.headers, FORWARD_RES_HEADERS),
  });

  if (rotated) {
    const domain = cookieDomainFor(request.headers.get('host'));
    const opts = tokenCookieOptions(domain, true);
    res.cookies.set(ACCESS_COOKIE, rotated.accessToken, opts);
    res.cookies.set(REFRESH_COOKIE, rotated.refreshToken, opts);
  }

  return res;
}

async function refresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const r = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { accessToken?: string; refreshToken?: string };
    if (!d.accessToken || !d.refreshToken) return null;
    return { accessToken: d.accessToken, refreshToken: d.refreshToken };
  } catch {
    return null;
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
