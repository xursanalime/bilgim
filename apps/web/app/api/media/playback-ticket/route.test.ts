/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

import { GET } from './route';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';
const LESSON_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const TICKET = {
  ticket: 'signed.ticket.value',
  manifestRef: '/media/assets/x/manifest?sig=opaque',
  licenseEndpoints: {
    widevine: `/media/assets/${VALID_UUID}/license/widevine`,
    fairplay: `/media/assets/${VALID_UUID}/license/fairplay`,
    playready: `/media/assets/${VALID_UUID}/license/playready`,
  },
  watermark: { label: 'a***@b.com', tag: 'tag-123' },
  downloadAllowed: false,
  expiresAt: '2030-01-01T00:00:00.000Z',
};

function req(query: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost/api/media/playback-ticket${query}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe('GET /api/media/playback-ticket', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fails closed with 401 when there is no session cookie', async () => {
    const res = await GET(req(`?assetId=${VALID_UUID}`));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid assetId with 400', async () => {
    const res = await GET(req('?assetId=not-a-uuid', 'bilgim_access_token=t'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the bearer token and relays the ticket JSON verbatim', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(TICKET), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const res = await GET(
      req(`?assetId=${VALID_UUID}&lessonId=${LESSON_UUID}`, 'bilgim_access_token=tok'),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = fetchMock.mock.calls[0];
    const urlStr = String(calledUrl);
    expect(urlStr).toContain(
      `/api/v1/media/assets/${VALID_UUID}/playback-ticket`,
    );
    expect(urlStr).toContain(`lessonId=${LESSON_UUID}`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );

    const body = await res.json();
    expect(body).toEqual(TICKET);

    // The token must never be echoed back to the browser.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('tok');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('propagates a 403 from the API without issuing a ticket', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const res = await GET(
      req(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
    );
    expect(res.status).toBe(403);
  });

  it('collapses an upstream 500 into a 502', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await GET(
      req(`?assetId=${VALID_UUID}`, 'bilgim_access_token=tok'),
    );
    expect(res.status).toBe(502);
  });
});
