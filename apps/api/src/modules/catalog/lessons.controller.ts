import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { JwtPayload } from '../auth/tokens.service';
import { CatalogService } from './catalog.service';
import {
  CreateLessonDto,
  CreateLessonSchema,
  UpdateLessonDto,
  UpdateLessonSchema,
} from './dto';

/**
 * LessonsController — REST endpoints for the teacher Lesson catalog and the
 * gated student/teacher lesson reads (Req 7.4 – 7.6, 6.1 – 6.6).
 *
 * Routes:
 *   POST   /catalog/groups/:groupId/lessons        [TEACHER]
 *   GET    /catalog/groups/:groupId/lessons        [TEACHER, STUDENT]
 *   GET    /catalog/lessons/:id                    [TEACHER, STUDENT, ADMIN] — LessonAccessGuard
 *   PATCH  /catalog/lessons/:id                    [TEACHER]
 *   PATCH  /catalog/lessons/:id/publish            [TEACHER]
 *   DELETE /catalog/lessons/:id                    [TEACHER]
 */
@Controller('catalog')
export class LessonsController {
  constructor(private readonly catalogService: CatalogService) {}

  /**
   * POST /catalog/groups/:groupId/lessons — Create a Lesson(status=DRAFT)
   * (Req 7.4). Teacher must own the parent group.
   */
  @Roles('TEACHER')
  @Post('groups/:groupId/lessons')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodValidationPipe(CreateLessonSchema)) dto: CreateLessonDto,
  ) {
    return this.catalogService.createLesson(user.sub, groupId, dto);
  }

  /**
   * GET /catalog/groups/:groupId/lessons — list lessons in a group.
   *
   * - TEACHER (owner): all lessons regardless of status.
   * - STUDENT (APPROVED enrollment in the group): only READY lessons.
   * - Other roles / no enrollment: 403.
   */
  @Roles('TEACHER', 'STUDENT')
  @Get('groups/:groupId/lessons')
  async listForGroup(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    if (user.role === 'TEACHER') {
      return this.catalogService.listLessonsForTeacher(user.sub, groupId);
    }
    // STUDENT path — verify enrollment then return READY lessons only.
    await this.catalogService.assertStudentEnrolledInGroup(user.sub, groupId);
    return this.catalogService.listReadyLessonsForGroup(groupId);
  }

  /**
   * GET /catalog/lessons/:id — Single lesson, gated by LessonAccessGuard
   * (Req 6.1 – 6.6). The guard fetches the lesson, attaches it to
   * `request.lesson`, and only lets through:
   *   - STUDENT with APPROVED enrollment for the lesson's group,
   *   - TEACHER who owns the lesson's course,
   *   - ADMIN (read-only audit).
   *
   * `LessonAccessGuard.loadLesson()` only joins `group.course` (what the
   * access decision needs) — it deliberately doesn't pull attachments,
   * since most guarded routes don't need them and that guard is shared
   * across many lesson-scoped endpoints. This is the one route whose
   * response IS the lesson detail page, so we fetch attachments here and
   * merge them in; skipping this step is what made every teacher-uploaded
   * video/file invisible to students despite showing up fine on the
   * teacher's own materials view (same DB rows, just never returned).
   */
  @UseGuards(LessonAccessGuard)
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('lessons/:id')
  async getOne(@Req() req: any) {
    const attachments = await this.catalogService.getLessonAttachmentsUnchecked(
      req.lesson.id,
    );
    return { ...req.lesson, attachments };
  }

  /** PATCH /catalog/lessons/:id — Update title/description/type/etc. (own only). */
  @Roles('TEACHER')
  @Patch('lessons/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLessonSchema)) dto: UpdateLessonDto,
  ) {
    return this.catalogService.updateLesson(user.sub, id, dto);
  }

  /**
   * PATCH /catalog/lessons/:id/publish — DRAFT → READY (Req 7.5).
   * Emits `lesson.published` for notification fan-out (Req 7.6).
   * Requires active subscription (Req 3.8) — 403 SUBSCRIPTION_EXPIRED otherwise.
   */
  @Roles('TEACHER')
  @Patch('lessons/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.catalogService.publishLesson(user.sub, id);
  }

  /** DELETE /catalog/lessons/:id — Delete a lesson (own only). */
  @Roles('TEACHER')
  @Delete('lessons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.catalogService.deleteLesson(user.sub, id);
  }
}
