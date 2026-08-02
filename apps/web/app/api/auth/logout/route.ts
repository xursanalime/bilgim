import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { cookieDomainFor } from '../../../../lib/tenant';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  USER_COOKIE,
  clearCookieOptions,
} from '../../../../lib/auth-cookies';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * BFF logout — best-effort revokes the refresh session on the API, then
 * clears all three session cookies. Cookies must be cleared with the SAME
 * `domain` they were set with, or the browser keeps the domain-scoped
 * originals alongside a new host-only tombstone.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    // Best-effort revoke — never block logout on the API being reachable.
    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      /* ignore — we still clear the local session below */
    }
  }

  const domain = cookieDomainFor(request.headers.get('host'));
  const res = NextResponse.json({ ok: true });
  const clear = clearCookieOptions(domain);
  res.cookies.set(ACCESS_COOKIE, '', clear);
  res.cookies.set(REFRESH_COOKIE, '', clear);
  res.cookies.set(USER_COOKIE, '', clear);
  return res;
}
