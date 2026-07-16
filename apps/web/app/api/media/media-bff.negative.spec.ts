/**
 * @jest-environment node
 */
/**
 * NEGATIVE reachability — restricted bytes / URLs are UNREACHABLE without
 * permission (Req 1.1, 1.7, 2.4).
 *
 * This is the web-side stand-in for the e2e negative assertion. A TRUE
 * browser e2e (Playwright against a running API + R2) is required to prove
 * the full stack denies access end-to-end; that needs a live stack and is
 * tracked separately. Here we pin the BFF's fail-closed contract by mocking
 * the upstream `fetch` so the Bilgim API denies access, and assert that the
 * media BFF (`/api/media/stream`, `/api/media/playback-ticket`):
 *
 *   1. fails closed with 401 when there is NO session (no upstream call);
 *   2. propagates the API's 401/403 when the viewer is NOT entitled;
 *   3. NEVER lets a raw signed storage URL (`https://…r2…`, `X-Amz-Signature`)
 *      or a Playback_Ticket reach the browser — not in the body, not in the
 *      response headers — even if a misbehaving upstream were to leak one in a
 *      denied response.
 */
import { NextRequest } from 'next/server';

import { GET as streamGET } from './stream/route';
import { GET as ticketGET } from './playback-ticket/route';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

// Leak-shaped artifacts that must NEVER reach the browser on a denied request.
const LEAKED_SIGNED_URL =
  'https://bilgim-media.abc123.r2.cloudflarestorage.com/private/secret.mp4' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefcafebabe';
const SIGNED_URL_RE = /https?:\/\/[^\s"']*r2[^\s"']*/i;
const AMZ_SIG_RE = /x-amz-signature/i;
const TICKET_FIELD_RE = /"(ticket|manifestRef|licenseEndpoints)"/;

function streamReq(query: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  return new NextRequest(`http://localhost/api/media/stream${query}`, {
    headers,
  });
}

function ticketReq(query: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  return new NextRequest(`http://localhost/api/media/playback-ticket${query}`, {
    headers,
  });
}

/** Assert a BFF response carries no signed URL / ticket — anywhere. */
async function assertNoLeak(res: Response): Promise<void> {
  // No signed-URL location / vendor header rides along.
  for (const [name, value] of res.headers.entries()) {
    expect(AMZ_SIG_RE.test(name)).toBe(false);
    expect(SIGNED_URL_RE.test(value)).toBe(false);
    expect(AMZ_SIG_RE.test(value)).toBe(false);
  }
  // No signed URL, no AWS signature, no ticket fields in the body.
  const body = await res.text();
  expect(SIGNED_URL_RE.test(body)).toBe(false);
  expect(AMZ_SIG_RE.test(body)).toBe(false);
  expect(TICKET_FIELD_RE.test(body)).toBe(false);
}

describe('media BFF — negative reachability (fail closed, no leak)', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('GET /api/media/stream', () => {
    it('no session → 401, no upstream call, no bytes/URL leaked', async () => {
      const res = await streamGET(streamReq(`?assetId=${VALID_UUID}`));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      await assertNoLeak(res);
    });

    it('not entitled (upstream 403) → 403 with no bytes and no signed URL', async () => {
      // Simulate the API denying access — and (defensively) leaking a signed
      // URL in the denied body/headers. The BFF must swallow it entirely.
      fetchMock.mockResolvedValue(
        new Response(LEAKED_SIGNED_URL, {
          status: 403,
          headers: {
            'content-type': 'text/plain',
            location: LEAKED_SIGNED_URL,
            'x-amz-signature': 'deadbeefcafebabe',
          },
        }),
      );

      const res = await streamGET(
        streamReq(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
      );

      expect(res.status).toBe(403);
      await assertNoLeak(res);
    });

    it('unauthorized (upstream 401) → 401 with no bytes and no signed URL', async () => {
      fetchMock.mockResolvedValue(
        new Response(LEAKED_SIGNED_URL, {
          status: 401,
          headers: { location: LEAKED_SIGNED_URL },
        }),
      );

      const res = await streamGET(
        streamReq(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
      );

      expect(res.status).toBe(401);
      await assertNoLeak(res);
    });
  });

  describe('GET /api/media/playback-ticket', () => {
    it('no session → 401, no upstream call, no ticket issued', async () => {
      const res = await ticketGET(ticketReq(`?assetId=${VALID_UUID}`));
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      await assertNoLeak(res);
    });

    it('not entitled (upstream 403) → 403 and NO playback ticket', async () => {
      // Even if upstream leaks a full ticket on a denied response, the BFF
      // must not relay it.
      const leakedTicket = JSON.stringify({
        ticket: 'signed.leaked.value',
        manifestRef: LEAKED_SIGNED_URL,
        licenseEndpoints: { widevine: LEAKED_SIGNED_URL },
        watermark: { label: 'x', tag: 'y' },
        downloadAllowed: true,
        expiresAt: '2030-01-01T00:00:00.000Z',
      });
      fetchMock.mockResolvedValue(
        new Response(leakedTicket, {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-amz-signature': 'deadbeefcafebabe',
          },
        }),
      );

      const res = await ticketGET(
        ticketReq(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
      );

      expect(res.status).toBe(403);
      await assertNoLeak(res);
    });

    it('unauthorized (upstream 401) → 401 and NO playback ticket', async () => {
      fetchMock.mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );

      const res = await ticketGET(
        ticketReq(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
      );

      expect(res.status).toBe(401);
      await assertNoLeak(res);
    });

    it('an invalid assetId is rejected before any upstream call', async () => {
      const res = await ticketGET(
        ticketReq('?assetId=not-a-uuid', 'bilgim_access_token=tok'),
      );
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      await assertNoLeak(res);
    });
  });
});
