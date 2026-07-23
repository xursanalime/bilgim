import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Redirect } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { MediaService } from './media.service';

/**
 * Freshly re-signed on every request; the browser follows the redirect
 * immediately, so this only needs to outlive one round trip.
 */
const PUBLIC_IMAGE_URL_TTL_SECONDS = 300;

/**
 * MediaPublicController — a standalone controller (deliberately separate
 * from `MediaAssetsController`, which carries a class-level
 * `@Roles('TEACHER', 'STUDENT', 'ADMIN')`) for the one unauthenticated
 * media route in this module.
 *
 * `RolesGuard` reads `@Roles` at both handler and class level regardless
 * of `@Public()`, so a `@Public()` route inside a `@Roles(...)` controller
 * would still 403 unauthenticated callers (verified directly against
 * `roles.guard.ts` — see the same gotcha documented on
 * `TeacherPreviewController`).
 */
@Controller('media/public')
export class MediaPublicController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * GET /media/public/:id
   *
   * Redirects to a freshly-signed R2 GET URL for an IMAGE-kind asset —
   * see `MediaService.getPublicImageUrl` for the security scoping
   * rationale. Used as the stable, never-expiring value stored in
   * `TeacherProfile.coverUrl`.
   */
  @Public()
  @Get(':id')
  @Redirect()
  async getPublicImageUrl(@Param('id', new ParseUUIDPipe()) assetId: string) {
    const url = await this.mediaService.getPublicImageUrl(assetId, PUBLIC_IMAGE_URL_TTL_SECONDS);
    return { url, statusCode: HttpStatus.FOUND };
  }
}
