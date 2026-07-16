import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  SetCourseLevelDto,
  SetCourseLevelSchema,
  SetGroupLevelDto,
  SetGroupLevelSchema,
} from './dto';
import { LevelingService } from './leveling.service';

/**
 * LevelingController — CEFR level + Exam_Track assignment for Courses and
 * Groups (Req 3.1 – 3.4).
 *
 * Auth: TEACHER for every route. Cross-teacher access is enforced in the
 * service layer via `course.teacherId` filters (same model as
 * CatalogController). Routes are nested under the existing `catalog/*`
 * prefixes so the frontend treats leveling as part of the catalog surface;
 * they do not collide with CatalogController routes (distinct sub-paths).
 */
@Controller('catalog')
@Roles('TEACHER')
export class LevelingController {
  constructor(private readonly levelingService: LevelingService) {}

  /**
   * PATCH /catalog/courses/:id/level — assign / update the Course CEFR level
   * and optional Exam_Track (Req 3.1, 3.2).
   */
  @Patch('courses/:id/level')
  @HttpCode(HttpStatus.OK)
  async setCourseLevel(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetCourseLevelSchema)) dto: SetCourseLevelDto,
  ) {
    return this.levelingService.setCourseLevel(user.sub, id, dto);
  }

  /**
   * PATCH /catalog/groups/:id/level — set or clear (null) the Group-specific
   * CEFR override; returns the resolved effective level (Req 3.3, 3.4).
   */
  @Patch('groups/:id/level')
  @HttpCode(HttpStatus.OK)
  async setGroupLevel(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetGroupLevelSchema)) dto: SetGroupLevelDto,
  ) {
    return this.levelingService.setGroupLevel(user.sub, id, dto);
  }

  /**
   * GET /catalog/groups/:id/effective-level — resolve a Group's effective
   * CEFR level (override → inherited → unassigned) (Req 3.3, 3.4).
   */
  @Get('groups/:id/effective-level')
  async getEffectiveGroupLevel(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.levelingService.getEffectiveGroupLevel(user.sub, id);
  }
}
