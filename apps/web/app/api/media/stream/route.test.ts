/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

import { GET } from './route';

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

function streamReq(
  query: string,
  opts: { cookie?: string; range?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  if (opts.range !== undefined) headers.range = opts.range;
  return new NextRequest(`http://localhost/api/media/stream${query}`, {
    headers,
  });
}

describe('GET /api/media/stream', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fails closed with 401 when there is no session cookie', async () => {
    const res = await GET(streamReq(`?assetId=${VALID_UUID}`));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid assetId with 400', async () => {
    const res = await GET(
      streamReq('?assetId=../etc/passwd', { cookie: 'bilgim_access_token=t' }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the inline Content-Disposition for restricted content', async () => {
    fetchMock.mockResolvedValue(
      new Response('PDFBYTES', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'inline',
          'content-length': '8',
          'accept-ranges': 'bytes',
        },
      }),
    );

    const res = await GET(
      streamReq(`?assetId=${VALID_UUID}`, { cookie: 'bilgim_access_token=tok' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain(
      `/api/v1/media/assets/${VALID_UUID}/stream`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });

  it('preserves the attachment Content-Disposition when downloads are allowed', async () => {
    fetchMock.mockResolvedValue(
      new Response('FILE', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="lesson.pdf"',
        },
      }),
    );

    const res = await GET(
      streamReq(`?assetId=${VALID_UUID}`, { cookie: 'bilgim_access_token=tok' }),
    );
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="lesson.pdf"',
    );
  });

  it('forwards Range and preserves a 206 partial response', async () => {
    fetchMock.mockResolvedValue(
      new Response('PART', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-3/100',
          'content-disposition': 'inline',
          'accept-ranges': 'bytes',
        },
      }),
    );

    const res = await GET(
      streamReq(`?assetId=${VALID_UUID}`, {
        cookie: 'bilgim_access_token=tok',
        range: 'bytes=0-3',
      }),
    );

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-3/100');

    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Range).toBe('bytes=0-3');
  });

  it('propagates a 403 from the API with no bytes', async () => {
    fetchMock.mockResolvedValue(new Response('denied', { status: 403 }));
    const res = await GET(
      streamReq(`?assetId=${VALID_UUID}`, { cookie: 'bilgim_access_token=tok' }),
    );
    expect(res.status).toBe(403);
  });
});
