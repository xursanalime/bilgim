/**
 * POST /api/media/license/<keySystem>?assetId=<uuid>
 *
 * Media BFF — EME License_Proxy relay (Req 1.1, 1.2, 2.4).
 *
 * The DRM-capable player (Task 1.3) sends each EME license challenge here;
 * the BFF relays the opaque challenge bytes to the Bilgim API
 * (`POST /api/v1/media/assets/:id/license/:keySystem`) together with the
 * caller's session `Bearer` token and the short-lived `x-playback-ticket`,
 * then streams the API's opaque license bytes straight back.
 *
 * SECURITY INVARIANTS:
 *   - The DRM vendor keys/URLs live ONLY on the API. The BFF never sees or
 *     forwards them; it relays opaque challenge → opaque license bytes.
 *   - Nothing is logged about the challenge, ticket, or license.
 *   - No session token is ever written to the response.
 *   - The response body is exactly the API's `application/octet-stream`
 *     license blob; no JSON envelope, no extra headers.
 *
 * Fails closed:
 *   - no session cookie       → 401;
 *   - unsupported keySystem   → 400;
 *   - missing playback ticket → 403 (the API also enforces this);
 *   - upstream 401/403        → 401/403, no license bytes;
 *   - any other failure       → 502.
 */

import { NextRequest } from 'next/server';

import {
  apiUrl,
  badRequest,
  getAccessToken,
  mapUpstreamStatus,
  unauthorized,
  UUID_RE,
} from '../../_lib/bff';

export const dynamic = 'force-dynamic';

/** Key systems the API License_Proxy brokers (mirrors the backend). */
const SUPPORTED_KEY_SYSTEMS = ['widevine', 'fairplay', 'playready'] as const;
type KeySystem = (typeof SUPPORTED_KEY_SYSTEMS)[number];

function isSupportedKeySystem(value: string): value is KeySystem {
  return (SUPPORTED_KEY_SYSTEMS as readonly string[]).includes(value);
}

const PLAYBACK_TICKET_HEADER = 'x-playback-ticket';

export async function POST(
  req: NextRequest,
  context: { params: { keySystem: string } },
): Promise<Response> {
  // ── Auth: fail closed when there is no session token. ────────────────
  const token = getAccessToken(req);
  if (!token) return unauthorized();

  const keySystem = (context.params.keySystem ?? '').toLowerCase();
  if (!isSupportedKeySystem(keySystem)) {
    return badRequest('Unsupported key system');
  }

  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get('assetId') ?? '';
  if (!UUID_RE.test(assetId)) {
    return badRequest('Invalid assetId');
  }

  // The signed Playback_Ticket is relayed via the dedicated header. Refuse
  // closed when absent (the API enforces this too, but we avoid a pointless
  // round-trip). The ticket is opaque to the BFF — never inspected/logged.
  const playbackTicket = req.headers.get(PLAYBACK_TICKET_HEADER);
  if (!playbackTicket) {
    return new Response('Missing playback ticket', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // The EME challenge is opaque binary; relay the raw bytes verbatim.
  const challenge = await req.arrayBuffer();
  if (challenge.byteLength === 0) {
    return badRequest('Empty license challenge');
  }

  const upstream = apiUrl(
    `/media/assets/${encodeURIComponent(assetId)}/license/${keySystem}`,
  );

  let apiRes: Response;
  try {
    apiRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        [PLAYBACK_TICKET_HEADER]: playbackTicket,
        'Content-Type': 'application/octet-stream',
        Accept: 'application/octet-stream',
      },
      body: challenge,
      cache: 'no-store',
    });
  } catch {
    return new Response('Upstream unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!apiRes.ok) {
    return new Response(null, {
      status: mapUpstreamStatus(apiRes.status),
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Relay ONLY the opaque license bytes. Stream the body through unchanged.
  return new Response(apiRes.body, {
    status: 200,
    headers: {
      'Content-Type':
        apiRes.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
