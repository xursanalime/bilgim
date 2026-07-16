import { ForbiddenException } from '@nestjs/common';
import { PassThrough, Readable } from 'stream';

import * as fc from 'fast-check';

import { MediaService, type ProtectedStream } from './media.service';
import { ProtectedFileController } from './protected-file.controller';

/**
 * Property test — Task 3.3 (content-protection-backend).
 *
 * Property 3: "Download gating is server-enforced"
 *   Restricted files are never served as a downloadable/attachment
 *   response to learners while Download_Permission is disabled,
 *   regardless of client flags.
 *   **Validates: Requirements 4.1, 4.2, 4.4**
 *
 * Strategy: drive the REAL {@link ProtectedFileController} with a mocked
 * {@link MediaService.openProtectedStream}. Over arbitrary combinations of
 *   - entitlement state (entitled / not entitled),
 *   - server-side `downloadAllowed` (true / false),
 *   - arbitrary client-supplied "force download" inputs (headers like
 *     `x-download`, `content-disposition`, and query-ish flags),
 * we assert:
 *   1. A non-entitled caller ALWAYS gets a 403 and ZERO bytes / no
 *      disposition header (Req 4.1 / 4.4).
 *   2. For an entitled caller, `Content-Disposition` is `attachment` IFF
 *      the server-side `downloadAllowed` is true, and `inline` otherwise —
 *      REGARDLESS of any client-supplied flag (Req 4.2 / 4.4).
 *   3. No response header ever contains a permanent/addressable storage
 *      URL (`https?://`, `X-Amz-Signature`, `r2.cloudflarestorage`).
 */
describe('ProtectedFileController — Property 3 (download gating server-enforced)', () => {
  const ASSET_ID = '11111111-1111-1111-1111-111111111111';
  const USER = { sub: 'user-1', email: 'u@e.com', role: 'STUDENT' } as any;
  const FILE_BYTES = 'protected-file-bytes';

  const URL_PATTERN = /https?:\/\//;
  const STORAGE_LEAK_PATTERN = /X-Amz-Signature|r2\.cloudflarestorage/;

  /**
   * Express response fake — reused from `protected-file.controller.spec.ts`.
   * A PassThrough (so `stream.pipe(res)` works) with the express-flavoured
   * header/status methods tacked on.
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

  function buildStream(downloadAllowed: boolean): ProtectedStream {
    return {
      stream: Readable.from([FILE_BYTES]),
      downloadAllowed,
      fileName: 'lesson-notes.pdf',
      contentType: 'application/pdf',
      contentLength: FILE_BYTES.length,
      acceptRanges: 'bytes',
      isPartial: false,
    };
  }

  /**
   * Arbitrary client-supplied "force download" request headers. These are
   * the exact kinds of flags a malicious/eager client would set to try to
   * coerce an attachment disposition. The controller must ignore all of
   * them — the disposition is decided purely server-side.
   */
  const clientForceDownloadHeaders = fc.record(
    {
      'x-download': fc.constantFrom('1', 'true', 'yes', 'force', 'attachment'),
      'content-disposition': fc.constantFrom(
        'attachment',
        'attachment; filename="hacked.pdf"',
        'attachment; filename="https://evil.example.com/leak.pdf"',
      ),
      download: fc.constantFrom('1', 'true', 'forceDownload'),
      'x-force-attachment': fc.constantFrom('on', 'true', '1'),
      range: fc.constantFrom(undefined, 'bytes=0-1023'),
    },
    { requiredKeys: [] },
  );

  let mediaService: jest.Mocked<MediaService>;
  let controller: ProtectedFileController;

  beforeEach(() => {
    mediaService = {
      openProtectedStream: jest.fn(),
    } as any;
    controller = new ProtectedFileController(mediaService);
  });

  it('a non-entitled caller ALWAYS gets 403 with no bytes / no disposition, regardless of client flags (Req 4.1/4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        clientForceDownloadHeaders,
        // downloadAllowed is irrelevant for the rejection path, but we vary
        // it to prove it never leaks into the (absent) response.
        fc.boolean(),
        async (headers, _downloadAllowed) => {
          mediaService.openProtectedStream.mockReset();
          mediaService.openProtectedStream.mockRejectedValue(
            new ForbiddenException({ code: 'MEDIA_ACCESS_DENIED' }),
          );

          const { res, headers: written } = buildResponse();

          await expect(
            controller.stream(USER, ASSET_ID, { headers }, res),
          ).rejects.toBeInstanceOf(ForbiddenException);

          // The 403 is asserted above (rejects → ForbiddenException);
          // Nest's exception filter — not the controller — sets the HTTP
          // status. The controller's contract is that it writes NOTHING on
          // the rejection path: no headers, no disposition, no bytes.
          expect(res.setHeader).not.toHaveBeenCalled();
          expect(written['Content-Disposition']).toBeUndefined();
          // Nothing addressable could possibly have leaked.
          expect(Object.keys(written)).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('for an entitled caller, disposition is attachment IFF server downloadAllowed is true — client flags never change it (Req 4.2/4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        clientForceDownloadHeaders,
        async (downloadAllowed, headers) => {
          mediaService.openProtectedStream.mockReset();
          mediaService.openProtectedStream.mockResolvedValue(
            buildStream(downloadAllowed),
          );

          const { res, headers: written, waitForBody } = buildResponse();

          await controller.stream(USER, ASSET_ID, { headers }, res);
          const body = await waitForBody();

          const disposition = String(written['Content-Disposition']);

          // The decision is bound EXACTLY to the server-side grant.
          if (downloadAllowed) {
            expect(disposition.startsWith('attachment')).toBe(true);
          } else {
            // Disabled Download_Permission ⇒ never an attachment.
            expect(disposition).toBe('inline');
            expect(disposition.includes('attachment')).toBe(false);
          }

          // The bytes are still the raw file (proxied), never a URL.
          expect(body).toBe(FILE_BYTES);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never emits a header containing an addressable storage URL, for any entitled outcome (Req 4.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        clientForceDownloadHeaders,
        async (downloadAllowed, headers) => {
          mediaService.openProtectedStream.mockReset();
          mediaService.openProtectedStream.mockResolvedValue(
            buildStream(downloadAllowed),
          );

          const { res, headers: written, waitForBody } = buildResponse();

          await controller.stream(USER, ASSET_ID, { headers }, res);
          const body = await waitForBody();

          for (const value of Object.values(written)) {
            expect(String(value)).not.toMatch(URL_PATTERN);
            expect(String(value)).not.toMatch(STORAGE_LEAK_PATTERN);
          }
          expect(body).not.toMatch(URL_PATTERN);
          expect(body).not.toMatch(STORAGE_LEAK_PATTERN);
        },
      ),
      { numRuns: 200 },
    );
  });
});
