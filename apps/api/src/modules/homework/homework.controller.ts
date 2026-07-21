import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  ListAvailableModulesQueryDto,
  ListAvailableModulesQuerySchema,
} from './dto';
import { HomeworkService } from './homework.service';

/**
 * HomeworkController — Phase 6 / Task 17.1 surface area.
 *
 * Endpoints:
 *   GET  /homework/available-modules               [TEACHER, ADMIN]
 *
 * Admin-managed SpecialtyModule catalog endpoints (`GET / PUT
 * /admin/specialties/:id/modules`) moved to `AdminController` in
 * Task 23.1; the cap-enforced bulk-upsert still lives in
 * `HomeworkService.bulkUpsertSpecialtyModules` and is invoked from the
 * admin module via dependency injection.
 *
 * Subsequent tasks (17.2 / 17.3) add per-Group toggle and assignment
 * builder routes here — when that lands the controller will branch by
 * sub-path rather than role.
 */
@Controller()
export class HomeworkController {
  constructor(private readonly homeworkService: HomeworkService) {}

  // ==================================================================
  // Teacher — SpecialtyModule listing (read-only catalog view)
  // ==================================================================

  /**
   * GET /homework/available-modules
   *
   * Phase 6 / Task 17.1 read surface for the AssignmentBuilder picker.
   *
   * Behaviour:
   *   - TEACHER (default): returns the caller's own specialty catalog —
   *     i.e. the active `SpecialtyModule` rows for `teacher.specialtyId`.
   *     The teacher must have completed onboarding; otherwise 404
   *     `ONBOARDING_REQUIRED` is returned.
   *   - ADMIN with `?specialtyId=...`: returns the active catalog for the
   *     specified specialty.
   *
   * Task 17.2 will extend this endpoint to accept `?groupId=...` and
   * return only the modules currently enabled for that group; the
   * pre-existing branches keep working unchanged.
   */
  @Roles('TEACHER', 'ADMIN')
  @Get('homework/available-modules')
  @HttpCode(HttpStatus.OK)
  async listAvailableModules(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(ListAvailableModulesQuerySchema))
    query: ListAvailableModulesQueryDto,
  ) {
    if (query.specialtyId && user.role === 'ADMIN') {
      return this.homeworkService.listActiveModulesBySpecialty(
        query.specialtyId,
      );
    }
    return this.homeworkService.listActiveModulesForTeacher(user.sub);
  }
}
