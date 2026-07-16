import { Controller, Get, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/tokens.service';
import { MediaService } from './media.service';

/**
 * Minimal Express request/response surfaces we depend on. Declared
 * structurally (rather than importing `Request`/`Response` from
 * `express`) to match the convention used elsewhere in this package and
 * avoid a hard dependency on `@types/express` in unit tests.
 */
export interface ProtectedFileRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface ProtectedFileResponse {
  setHeader(name: string, value: string | number): unknown;
  status(code: number): unknown;
  end(): unknown;
  headersSent: boolean;
}

/**
 * ProtectedFileController — hardened, gated file streaming
 * (content-protection-backend Req 4.1 – 4.4).
 *
 *   GET /media/assets/:id/stream   [TEACHER, STUDENT, ADMIN]
 *
 * The endpoint proxies the file's bytes through the API instead of
 * handing the caller a signed storage URL (Req 4.1). Access is enforced
 * entirely server-side by {@link MediaService.openProtectedStream}:
 *
 *   - A caller without an APPROVED Entitlement (or owner/admin/owning-
 *     teacher access) is rejected with `403 MEDIA_ACCESS_DENIED` and no
 *     bytes are written (Req 4.1 / 4.4).
 *   - `Content-Disposition` is `inline` while the owning group's
 *     `downloadAllowed` is false, and only becomes `attachment` when it
 *     is true (Req 4.2 / 4.3). The decision is server-authoritative; any
 *     client-supplied flag is ignored (Req 4.4 / Property 3).
 *   - HTTP `Range` requests are honoured so media seeks/partial fetches
 *     work without exposing the storage layer.
 */
@Controller('media/assets')
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class ProtectedFileController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':id/stream')
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Req() req: ProtectedFileRequest,
    @Res() res: ProtectedFileResponse,
  ): Promise<void> {
    const rangeHeader = req.headers['range'];
    const range = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;

    // Entitlement + Download_Permission are resolved BEFORE any byte is
    // written. A ForbiddenException here surfaces as a 403 with no media
    // payload (Req 4.1 / 4.4).
    const result = await this.mediaService.openProtectedStream(
      { sub: user.sub, role: user.role },
      assetId,
      range,
    );

    // Never cache protected content in shared/intermediary caches.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', result.acceptRanges);
    res.setHeader('Content-Type', result.contentType);

    // Req 4.2 / 4.3 / 4.4: disposition is decided server-side from the
    // group's Download_Permission, never from a client flag.
    res.setHeader(
      'Content-Disposition',
      result.downloadAllowed
        ? `attachment; filename="${result.fileName}"`
        : 'inline',
    );

    if (typeof result.contentLength === 'number') {
      res.setHeader('Content-Length', result.contentLength);
    }
    if (result.isPartial && result.contentRange) {
      res.setHeader('Content-Range', result.contentRange);
      res.status(206);
    }

    result.stream.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
      // eslint-disable-next-line no-console
      console.error(`Protected file stream error for asset ${assetId}`, err);
    });

    // `res` is an Express Writable at runtime; pipe the proxied bytes.
    result.stream.pipe(res as unknown as NodeJS.WritableStream);
  }
}
