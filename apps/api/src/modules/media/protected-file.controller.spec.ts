import { ForbiddenException } from '@nestjs/common';
import { PassThrough, Readable } from 'stream';

import { MediaService, type ProtectedStream } from './media.service';
import { ProtectedFileController } from './protected-file.controller';

/**
 * Unit tests for ProtectedFileController — Task 3.1
 * (content-protection-backend Req 4.1 – 4.4).
 *
 *   GET /media/assets/:id/stream
 *
 * Verifies the access-control boundary:
 *   - a non-entitled caller receives a 403 and NO bytes (Req 4.1 / 4.4);
 *   - `downloadAllowed === false` → `Content-Disposition: inline` (Req 4.2);
 *   - `downloadAllowed === true`  → `Content-Disposition: attachment` (Req 4.3);
 *   - the response never carries a signed/addressable storage URL (Req 4.1);
 *   - HTTP Range requests are surfaced as a 206 partial response.
 */
describe('ProtectedFileController', () => {
  const ASSET_ID = '11111111-1111-1111-1111-111111111111';
  const USER = { sub: 'user-1', email: 'u@e.com', role: 'STUDENT' } as any;

  /**
   * Express response fake: a PassThrough (so `stream.pipe(res)` works)
   * with the express-flavoured header/status methods tacked on.
   */
  function buildResponse() {
    const headers: Record<string, string | number> = {};
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];
    passthrough.on('data', (c) => chunks.push(Buffer.from(c)));

    const res: any = passthrough;
    res.headersSent = false;
    res.statusCode = 200;
    res.setHeader = jest.fn((name: string, value: string | number) => {
      headers[name] = value;
    });
    res.status = jest.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    });

    return {
      res,
      headers,
      waitForBody: async () => {
        await new Promise<void>((resolve, reject) => {
          passthrough.once('finish', () => resolve());
          passthrough.once('end', () => resolve());
          passthrough.once('error', reject);
        });
        return Buffer.concat(chunks).toString('utf8');
      },
    };
  }

  function buildStream(overrides: Partial<ProtectedStream> = {}): ProtectedStream {
    return {
      stream: Readable.from(['file-bytes']),
      downloadAllowed: false,
      fileName: 'lesson-notes.pdf',
      contentType: 'application/pdf',
      contentLength: 9,
      acceptRanges: 'bytes',
      isPartial: false,
      ...overrides,
    };
  }

  let mediaService: jest.Mocked<MediaService>;
  let controller: ProtectedFileController;

  beforeEach(() => {
    mediaService = {
      openProtectedStream: jest.fn(),
    } as any;
    controller = new ProtectedFileController(mediaService);
  });

  it('rejects a non-entitled caller with 403 and writes no bytes (Req 4.1/4.4)', async () => {
    mediaService.openProtectedStream.mockRejectedValue(
      new ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' }),
    );
    const { res } = buildResponse();

    await expect(
      controller.stream(USER, ASSET_ID, { headers: {} }, res),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // No headers and no body were ever written.
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('serves inline when downloadAllowed is false (Req 4.2)', async () => {
    mediaService.openProtectedStream.mockResolvedValue(
      buildStream({ downloadAllowed: false }),
    );
    const { res, headers, waitForBody } = buildResponse();

    await controller.stream(USER, ASSET_ID, { headers: {} }, res);
    const body = await waitForBody();

    expect(headers['Content-Disposition']).toBe('inline');
    expect(body).toBe('file-bytes');
  });

  it('serves attachment when downloadAllowed is true (Req 4.3)', async () => {
    mediaService.openProtectedStream.mockResolvedValue(
      buildStream({ downloadAllowed: true, fileName: 'syllabus.pdf' }),
    );
    const { res, headers, waitForBody } = buildResponse();

    await controller.stream(USER, ASSET_ID, { headers: {} }, res);
    await waitForBody();

    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="syllabus.pdf"',
    );
  });

  it('never exposes a signed/addressable storage URL in the response (Req 4.1)', async () => {
    mediaService.openProtectedStream.mockResolvedValue(
      buildStream({ downloadAllowed: true }),
    );
    const { res, headers, waitForBody } = buildResponse();

    await controller.stream(USER, ASSET_ID, { headers: {} }, res);
    const body = await waitForBody();

    // No header value leaks an R2 / signed URL, and the body is raw bytes.
    for (const value of Object.values(headers)) {
      expect(String(value)).not.toMatch(/https?:\/\//);
      expect(String(value)).not.toMatch(/X-Amz-Signature|r2\.cloudflarestorage/);
    }
    expect(body).not.toMatch(/https?:\/\//);
    // Disposition + content-type were the only "addressing" headers set.
    expect(headers['Content-Type']).toBe('application/pdf');
  });

  it('ignores a client-provided download flag — server decides disposition (Req 4.4)', async () => {
    // Server state says downloads are NOT allowed for this group.
    mediaService.openProtectedStream.mockResolvedValue(
      buildStream({ downloadAllowed: false }),
    );
    // A malicious/eager client tries to force an attachment via headers
    // and a query-ish flag. The controller never reads such a flag — the
    // disposition is derived purely from the server-side grant.
    const { res, headers, waitForBody } = buildResponse();

    await controller.stream(
      USER,
      ASSET_ID,
      {
        headers: {
          'x-download': 'true',
          'content-disposition': 'attachment; filename="hacked.pdf"',
        },
      },
      res,
    );
    await waitForBody();

    // Server wins: inline, never attachment, regardless of client intent.
    expect(headers['Content-Disposition']).toBe('inline');
    // And the grant the service returned was honoured verbatim.
    expect(mediaService.openProtectedStream).toHaveBeenCalledWith(
      { sub: 'user-1', role: 'STUDENT' },
      ASSET_ID,
      undefined,
    );
  });

  it('forwards the JWT actor (sub + role) and Range header to the service', async () => {
    mediaService.openProtectedStream.mockResolvedValue(buildStream());
    const { res, waitForBody } = buildResponse();

    await controller.stream(
      USER,
      ASSET_ID,
      { headers: { range: 'bytes=0-1023' } },
      res,
    );
    await waitForBody();

    expect(mediaService.openProtectedStream).toHaveBeenCalledWith(
      { sub: 'user-1', role: 'STUDENT' },
      ASSET_ID,
      'bytes=0-1023',
    );
  });

  it('mirrors a partial (206) response for satisfied Range requests', async () => {
    mediaService.openProtectedStream.mockResolvedValue(
      buildStream({
        isPartial: true,
        contentRange: 'bytes 0-1023/2048',
        contentLength: 1024,
      }),
    );
    const { res, headers, waitForBody } = buildResponse();

    await controller.stream(
      USER,
      ASSET_ID,
      { headers: { range: 'bytes=0-1023' } },
      res,
    );
    await waitForBody();

    expect(res.status).toHaveBeenCalledWith(206);
    expect(headers['Content-Range']).toBe('bytes 0-1023/2048');
    expect(headers['Accept-Ranges']).toBe('bytes');
  });
});
