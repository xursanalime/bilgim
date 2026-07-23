import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PreviewProfileResponse, TeacherPublicProfileService } from './public-profile.service';
import { ResolvePreviewDto, ResolvePreviewSchema } from './dto';

/**
 * TeacherPreviewController — a standalone controller (deliberately
 * separate from `TeacherController`, which carries a class-level
 * `@Roles('TEACHER')`) for the ONE public route in this feature.
 *
 * `RolesGuard` reads `@Roles` at both handler and class level regardless
 * of `@Public()`, so a `@Public()` route inside a `@Roles('TEACHER')`
 * controller would still 403 unauthenticated callers. This controller has
 * no class-level `@Roles`, so `@Public()` here correctly skips both guards.
 */
@Controller('teacher-preview')
export class TeacherPreviewController {
  constructor(private readonly publicProfileService: TeacherPublicProfileService) {}

  /**
   * GET /teacher-preview?token=…
   *
   * Resolves a short-lived preview token (Task 6 "Ko'rib chiqish" flow)
   * into the profile + course data the subdomain preview page renders.
   * The token itself is the credential — no auth cookie is required or
   * expected (the request comes from a Server Component, not the browser).
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Query(new ZodValidationPipe(ResolvePreviewSchema)) query: ResolvePreviewDto,
  ): Promise<PreviewProfileResponse> {
    return this.publicProfileService.getPreviewProfile(query.token);
  }
}
