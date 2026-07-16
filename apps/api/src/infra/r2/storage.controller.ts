import { Readable } from 'node:stream';

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { BodyLimit } from '../../common/decorators/body-limit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LocalStorage } from './local-storage';

/**
 * Per-part upload cap for the local storage driver. Media multipart parts are
 * `MEDIA_DEFAULT_PART_SIZE_BYTES` (8 MiB) each, so the part-upload route must
 * widen the platform-default 1 MiB body cap (otherwise every part is rejected
 * by `BodyLimitGuard`). 12 MiB leaves headroom while staying under the 10 MiB
 * request-limits ceiling is not required here because the part stream is read
 * directly (never buffered by the JSON parser); the request-limits middleware
 * still applies its own cap.
 */
const LOCAL_UPLOAD_PART_LIMIT_BYTES = 12 * 1024 * 1024;

/**
 * StorageController — local-filesystem object endpoints used ONLY when
 * `STORAGE_DRIVER=local`. These are the "presigned URL" targets that
 * {@link LocalStorage} hands out:
 *
 *   PUT /storage/part?key&uploadId&partNumber&token   — browser uploads a part
 *   GET /storage/object?key&token                     — byte stream (Range-aware)
 *
 * Authorization is by the short-lived HMAC `token` (op + key + exp), NOT a JWT
 * — exactly like an S3 presigned URL. The routes are `@Public()` so the global
 * JwtAuthGuard skips them; the token check is the gate. Path traversal is
 * refused inside `LocalStorage`.
 */
@Public()
@Controller('storage')
export class StorageController {
  constructor(private readonly local: LocalStorage) {}

  @Put('part')
  @BodyLimit(LOCAL_UPLOAD_PART_LIMIT_BYTES)
  @HttpCode(HttpStatus.OK)
  async uploadPart(
    @Query('key') key: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumberRaw: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const partNumber = Number(partNumberRaw);
    if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
      throw new BadRequestException('Invalid part parameters');
    }
    if (!this.local.verifyToken(token, 'put', key, uploadId, partNumber)) {
      throw new ForbiddenException('Invalid or expired upload token');
    }

    const etag = await this.local.writePart(
      uploadId,
      partNumber,
      req as unknown as Readable,
    );

    // The resumable uploader reads the ETag off this response; it is exposed
    // to the browser via CORS `exposedHeaders` (see configure-security).
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-store');
    res.status(HttpStatus.OK).end();
  }

  @Public()
  @Get('object')
  async getObject(
    @Query('key') key: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!key) throw new BadRequestException('Missing key');
    if (!this.local.verifyToken(token, 'get', key)) {
      throw new ForbiddenException('Invalid or expired object token');
    }

    if (!(await this.local.objectExists(key))) {
      throw new NotFoundException('Object not found');
    }

    const range = req.headers.range;
    const stream = await this.local.getObjectStream(key, range);

    res.setHeader('Accept-Ranges', stream.acceptRanges);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    if (stream.contentType) res.setHeader('Content-Type', stream.contentType);
    if (typeof stream.contentLength === 'number') {
      res.setHeader('Content-Length', String(stream.contentLength));
    }
    if (stream.isPartial && stream.contentRange) {
      res.setHeader('Content-Range', stream.contentRange);
      res.status(HttpStatus.PARTIAL_CONTENT);
    } else {
      res.status(HttpStatus.OK);
    }

    stream.body.pipe(res);
    stream.body.on('error', () => {
      if (!res.headersSent) res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      res.end();
    });
  }
}
