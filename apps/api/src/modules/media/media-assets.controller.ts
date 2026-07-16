import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  MediaService,
  type MediaPlaybackResponse,
  MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
} from './media.service';
import { R2_MAX_SIGNED_URL_TTL_SECONDS } from '../../infra/r2/r2.service';

/**
 * Query schema for `GET /media/assets/:id/url`.
 *
 *  - `expiresIn` is optional. Default 3 hours (the service-level
 *    default), max 6 hours per Req 21.6. The service clamps the value
 *    again as defense in depth.
 *
 *  - `coerce.number()` is used because query strings always arrive as
 *    strings; the schema turns "3600" into `3600`.
 */
const PlaybackQuerySchema = z.object({
  expiresIn: z.coerce
    .number()
    .int('expiresIn must be an integer')
    .min(60, 'expiresIn must be ≥ 60 seconds')
    .max(
      R2_MAX_SIGNED_URL_TTL_SECONDS,
      `expiresIn must be ≤ ${R2_MAX_SIGNED_URL_TTL_SECONDS} seconds (Req 21.6)`,
    )
    .optional(),
});

type PlaybackQuery = z.infer<typeof PlaybackQuerySchema>;

/**
 * MediaAssetsController — read-side endpoints for MediaAsset playback
 * (Req 8.3, 8.7, 8.8, 21.6).
 *
 *   GET /media/assets/:id/url       [TEACHER, STUDENT, ADMIN]
 *
 * Authorization is delegated to `MediaService.getPlaybackUrls` which
 * runs `MediaAccessService.assertCanRead` before signing anything:
 *  - owner of the asset, OR
 *  - ADMIN (read-only audit), OR
 *  - TEACHER who owns a lesson referencing the asset, OR
 *  - STUDENT with an APPROVED Enrollment in a group whose lesson
 *    references the asset.
 *
 * The endpoint NEVER signs an URL before the access check completes,
 * so a 403 response leaks no information about the asset's R2 key.
 */
@Controller('media/assets')
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class MediaAssetsController {
  constructor(private readonly mediaService: MediaService) {}
@Get(':id')
@HttpCode(HttpStatus.OK)
async getAssetMetadata(
  @CurrentUser() user: JwtPayload,
  @Param('id', new ParseUUIDPipe()) assetId: string,
) {
  return this.mediaService.getAssetMetadata(user.sub, assetId);
}

/**
 * GET /media/assets/:id/url — Resolve a presigned playback URL for the
...
   * asset (Req 8.3 — HLS, 21.6 — TTL ≤ 6h).
   *
   * Response:
   *  - For HLS-ready video: master manifest + signed variant playlists.
   *  - For everything else: signed URL on the original key.
   *
   * Errors:
   *  - 404 MEDIA_NOT_FOUND      → no row with that id.
   *  - 403 MEDIA_ACCESS_DENIED  → user is not owner / admin / enrolled / owning teacher.
   *  - 409 MEDIA_NOT_READY      → asset still UPLOADING.
   *  - 409 MEDIA_FAILED         → asset upload or transcoding failed.
   *  - 409 MEDIA_KEY_MISSING    → row has no R2 key (corruption guard).
   */
  @Get(':id/url')
  @HttpCode(HttpStatus.OK)
  async getPlaybackUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Query(new ZodValidationPipe(PlaybackQuerySchema)) query: PlaybackQuery,
  ): Promise<MediaPlaybackResponse> {
    return this.mediaService.getPlaybackUrls(
      { sub: user.sub, role: user.role },
      assetId,
      query.expiresIn ?? MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
    );
  }

  /**
   * GET /media/assets/:id/hls-segment?seg=<variantName/segmentFile>
   *
   * HLS segment fayllarini imzolash — faqat proxy server dan chaqiriladi.
   * Brauzer to'g'ridan R2 ga murojaat qilmaydi: barcha .ts segment URL lari
   * `/api/media/proxy?seg=...` orqali o'tadi va bu endpoint imzolaydi.
   *
   * Xavfsizlik:
   *  - `seg` parametri faqat `variantName/filename.ts` formatida bo'lishi mumkin
   *  - `hlsManifestKey` dan olingan prefix bilan tekshiriladi (path traversal blok)
   *  - Foydalanuvchi ruxsati `assertCanRead` orqali tekshiriladi
   *  - TTL: 60 soniya (segment yuklanib bo'lishi uchun yetarli)
   */
  @Get(':id/hls-segment')
  @HttpCode(HttpStatus.OK)
  async getHlsSegmentUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Query('seg') seg: string,
  ): Promise<{ url: string }> {
    if (!seg || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(seg)) {
      throw new BadRequestException('Invalid segment path');
    }
    return this.mediaService.getHlsSegmentUrl(
      { sub: user.sub, role: user.role },
      assetId,
      seg,
    );
  }
}
