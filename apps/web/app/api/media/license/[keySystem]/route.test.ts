/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

import { POST } from './route';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

function licenseReq(
  keySystem: string,
  opts: { cookie?: string; ticket?: string; body?: BufferSource } = {},
): { req: NextRequest; ctx: { params: { keySystem: string } } } {
  const headers: Record<string, string> = {};
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  if (opts.ticket !== undefined) headers['x-playback-ticket'] = opts.ticket;

  const req = new NextRequest(
    `http://localhost/api/media/license/${keySystem}?assetId=${VALID_UUID}`,
    {
      method: 'POST',
      headers,
      body: opts.body ?? new Uint8Array([1, 2, 3, 4]),
    },
  );
  return { req, ctx: { params: { keySystem } } };
}

describe('POST /api/media/license/[keySystem]', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fails closed with 401 when there is no session cookie', async () => {
    const { req, ctx } = licenseReq('widevine', { ticket: 'tkt' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported key system with 400', async () => {
    const { req, ctx } = licenseReq('clearkey', {
      cookie: 'bilgim_access_token=t',
      ticket: 'tkt',
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses (403) when the playback ticket header is missing', async () => {
    const { req, ctx } = licenseReq('widevine', {
      cookie: 'bilgim_access_token=t',
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relays the challenge with auth + ticket and returns opaque license bytes', async () => {
    const licenseBytes = new Uint8Array([9, 8, 7, 6, 5]);
    fetchMock.mockResolvedValue(
      new Response(licenseBytes, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );

    const { req, ctx } = licenseReq('widevine', {
      cookie: 'bilgim_access_token=tok',
      ticket: 'signed-ticket',
      body: new Uint8Array([42, 43, 44]),
    });
    const res = await POST(req, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('no-store');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain(
      `/api/v1/media/assets/${VALID_UUID}/license/widevine`,
    );
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['x-playback-ticket']).toBe('signed-ticket');

    const out = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(out)).toEqual([9, 8, 7, 6, 5]);
  });

  it('rejects an empty challenge body with 400', async () => {
    const { req, ctx } = licenseReq('fairplay', {
      cookie: 'bilgim_access_token=tok',
      ticket: 'signed-ticket',
      body: new Uint8Array([]),
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates a 403 from the API with no license bytes', async () => {
    fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const { req, ctx } = licenseReq('playready', {
      cookie: 'bilgim_access_token=tok',
      ticket: 'signed-ticket',
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});
