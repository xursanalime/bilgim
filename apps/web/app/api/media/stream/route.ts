/**
 * GET /api/media/stream?assetId=<uuid>
 *
 * Media BFF — gated restricted-file streaming (Req 2.4, design §3.5).
 *
 * Proxies the API's gated byte stream
 * (`GET /api/v1/media/assets/:id/stream`) through to the browser so the DOM
 * never receives a raw, signed storage URL for restricted content. The
 * client `src` points at this same-origin endpoint, not at the vendor.
 *
 * The API is the single source of truth for the `Content-Disposition`
 * (`inline` while Download_Permission is disabled, `attachment` only when
 * the owning group enables downloads). The BFF preserves that header
 * verbatim and never overrides it from client input (Req 2.4 / Property 3).
 * `Range` requests are forwarded so seeking/partial fetches work, and the
 * `206 Partial Content` status + range headers are preserved.
 *
 * Fails closed:
 *   - no session cookie  → 401 (no upstream call is made);
 *   - upstream 401/403   → 401/403, no bytes;
 *   - any other failure  → 502.
 */

import { NextRequest } from 'next/server';

import {
  apiUrl,
  badRequest,
  getAccessToken,
  mapUpstreamStatus,
  unauthorized,
  UUID_RE,
} from '../_lib/bff';

export const dynamic = 'force-dynamic';

/**
 * Upstream response headers that are safe and meaningful to relay to the
 * browser. We allow-list rather than copy everything so no upstream
 * transport/storage header (e.g. a signed-URL `Location`, vendor cache
 * tags) can ride along.
 */
const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'content-range',
  'accept-ranges',
] as const;

export async function GET(req: NextRequest): Promise<Response> {
  // ── Auth: fail closed when there is no session token. ────────────────
  const token = getAccessToken(req);
  if (!token) return unauthorized();

  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get('assetId') ?? '';
  if (!UUID_RE.test(assetId)) {
    return badRequest('Invalid assetId');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  // Forward a Range request so media seeks / partial fetches work without
  // exposing the storage layer.
  const range = req.headers.get('range');
  if (range) headers.Range = range;

  const upstream = apiUrl(
    `/media/assets/${encodeURIComponent(assetId)}/stream`,
  );

  let apiRes: Response;
  try {
    apiRes = await fetch(upstream, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
  } catch {
    return new Response('Upstream unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!apiRes.ok && apiRes.status !== 206) {
    return new Response(null, {
      status: mapUpstreamStatus(apiRes.status),
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Relay the gated stream. The API's Content-Disposition (inline vs
  // attachment) is authoritative and preserved verbatim (Req 2.4).
  const outHeaders = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = apiRes.headers.get(name);
    if (value) outHeaders.set(name, value);
  }
  // Restricted content must never be cached by the browser or any shared
  // intermediary.
  outHeaders.set('Cache-Control', 'private, no-store');
  outHeaders.set('X-Content-Type-Options', 'nosniff');

  return new Response(apiRes.body, {
    status: apiRes.status,
    headers: outHeaders,
  });
}
