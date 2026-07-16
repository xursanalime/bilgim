/**
 * GET /api/media/playback-ticket?assetId=<uuid>&lessonId=<uuid>
 *
 * Media BFF — playback-ticket broker (Req 1.1, 1.2, 1.3).
 *
 * Forwards the authenticated viewer's request to the Bilgim API
 * (`GET /api/v1/media/assets/:id/playback-ticket?lessonId=`) and relays the
 * resulting Playback_Ticket JSON to the browser **verbatim**.
 *
 * The ticket's `manifestRef` and `licenseEndpoints` are short-lived,
 * API-relative/opaque references minted server-side — they carry no vendor
 * storage URL or DRM key — so they are passed through untouched (the design
 * mandates the BFF must not rewrite or enrich them).
 *
 * Fails closed:
 *   - no session cookie            → 401 (no upstream call is made);
 *   - upstream 401/403 (no/!APPROVED entitlement) → 401/403, no ticket;
 *   - any other upstream failure   → 502.
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  apiUrl,
  badRequest,
  getAccessToken,
  mapUpstreamStatus,
  protectedResponseHeaders,
  unauthorized,
  UUID_RE,
} from '../_lib/bff';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  // ── Auth: fail closed when there is no session token. ────────────────
  const token = getAccessToken(req);
  if (!token) return unauthorized();

  const { searchParams } = new URL(req.url);

  const assetId = searchParams.get('assetId') ?? '';
  if (!UUID_RE.test(assetId)) {
    return badRequest('Invalid assetId');
  }

  // `lessonId` is optional context recorded on the PlaybackSession for
  // tracing. Validate when present; the API resolves entitlement from the
  // asset's group regardless, so this can never widen access.
  const lessonId = searchParams.get('lessonId');
  if (lessonId !== null && !UUID_RE.test(lessonId)) {
    return badRequest('Invalid lessonId');
  }

  const upstream = new URL(
    apiUrl(`/media/assets/${encodeURIComponent(assetId)}/playback-ticket`),
  );
  if (lessonId) upstream.searchParams.set('lessonId', lessonId);

  let apiRes: Response;
  try {
    apiRes = await fetch(upstream, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch {
    return new NextResponse('Upstream unavailable', {
      status: 502,
      headers: protectedResponseHeaders(),
    });
  }

  if (!apiRes.ok) {
    return new NextResponse(null, {
      status: mapUpstreamStatus(apiRes.status),
      headers: protectedResponseHeaders(),
    });
  }

  // Relay the ticket JSON as-is. We re-serialize (rather than streaming the
  // body) so the response carries ONLY the ticket fields and none of the
  // upstream's transport headers.
  const ticket: unknown = await apiRes.json().catch(() => null);
  if (ticket === null) {
    return new NextResponse('Bad Gateway', {
      status: 502,
      headers: protectedResponseHeaders(),
    });
  }

  return NextResponse.json(ticket, {
    status: 200,
    headers: protectedResponseHeaders(),
  });
}
