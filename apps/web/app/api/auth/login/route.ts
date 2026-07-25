import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { cookieDomainFor } from '../../../../lib/tenant';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  USER_COOKIE,
  tokenCookieOptions,
  userCookieOptions,
  type SessionUser,
} from '../../../../lib/auth-cookies';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface LoginUpstream {
  accessToken?: string;
  refreshToken?: string;
  user?: SessionUser;
  [k: string]: unknown;
}

/**
 * BFF login endpoint.
 *
 * The browser posts credentials HERE (same origin) instead of to the NestJS
 * API directly. We relay them to the API, and on success write the returned
 * tokens into **httpOnly** cookies that client JavaScript can never read.
 * Only the non-secret profile (`user`) is echoed back to the caller — the
 * tokens never touch the browser's JS context, so an XSS payload has nothing
 * to steal. See `lib/auth-cookies.ts` for the full rationale.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: { email?: string; password?: string; remember?: boolean };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const remember = payload.remember !== false;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_UNREACHABLE', message: 'Auth service unavailable' } },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as LoginUpstream;

  // Auth failure OR an MFA challenge (no tokens issued yet) — pass the body
  // straight through without setting any cookie. The client handles the
  // challenge and re-submits via /api/auth/mfa if needed.
  if (!upstream.ok || !data.accessToken || !data.refreshToken) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const domain = cookieDomainFor(request.headers.get('host'));
  const res = NextResponse.json({ user: data.user });

  res.cookies.set(ACCESS_COOKIE, data.accessToken, tokenCookieOptions(domain, remember));
  res.cookies.set(REFRESH_COOKIE, data.refreshToken, tokenCookieOptions(domain, remember));
  if (data.user) {
    res.cookies.set(
      USER_COOKIE,
      encodeURIComponent(JSON.stringify(data.user)),
      userCookieOptions(domain, remember),
    );
  }
  return res;
}
