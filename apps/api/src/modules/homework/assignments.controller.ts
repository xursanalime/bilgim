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
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { AssignmentService } from './assignment.service';
import {
  CreateAssignmentDto,
  CreateAssignmentSchema,
  UpdateAssignmentDto,
  UpdateAssignmentSchema,
} from './dto';

/**
 * AssignmentsController — REST endpoints for the AssignmentBuilder
 * (Task 17.3, Req 11.5, 11.8).
 *
 * Routes (mounted under the global `api/v1` prefix):
 *   POST   /lessons/:lessonId/assignments          [TEACHER, ADMIN]
 *   GET    /lessons/:lessonId/assignments          [TEACHER, ADMIN]
 *   GET    /assignments/:id                        [TEACHER, ADMIN]
 *   PATCH  /assignments/:id                        [TEACHER, ADMIN]
 *   DELETE /assignments/:id                        [TEACHER, ADMIN]
 *   POST   /assignments/:id/publish                [TEACHER, ADMIN]
 *
 * Authorization:
 *   - All routes require JWT auth + role TEACHER or ADMIN (TEACHER is the
 *     primary path; ADMIN is allowed for moderation).
 *   - Ownership: the service layer verifies the caller's userId matches
 *     `lesson.group.course.teacherId` for TEACHER actors. ADMIN bypasses
 *     the ownership check.
 *
 * Module validation:
 *   - On create / update / publish, every module type is checked against
 *     `GroupModule.isEnabled = true` for the lesson's group. Mismatches
 *     produce a 409 `MODULE_NOT_ENABLED_FOR_GROUP`.
 *
 * Notifications:
 *   - `POST /assignments/:id/publish` flips `isPublished=true` and
 *     emits a `homework.assigned` outbox event. The notification
 *     fan-out worker translates that into one HOMEWORK_ASSIGNED
 *     Notification per APPROVED student of the group.
 */
@Controller()
@Roles('TEACHER', 'ADMIN')
export class AssignmentsController {
  constructor(private readonly assignmentService: AssignmentService) {}

  /**
   * POST /lessons/:lessonId/assignments — Create a draft Assignment with
   * one or more AssignmentModule rows.
   */
  @Post('lessons/:lessonId/assignments')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(CreateAssignmentSchema))
    dto: CreateAssignmentDto,
  ) {
    return this.assignmentService.createForLesson(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      lessonId,
      dto,
    );
  }

  /** GET /lessons/:lessonId/assignments — List a lesson's assignments. */
  @Get('lessons/:lessonId/assignments')
  async listForLesson(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.assignmentService.listForLesson(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      lessonId,
    );
  }

  /** GET /assignments/:id — Single assignment with its modules. */
  @Get('assignments/:id')
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assignmentService.getById(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      id,
    );
  }

  /**
   * PATCH /assignments/:id — Partial update. Supports editing scalar
   * fields and / or replacing the entire module set.
   */
  @Patch('assignments/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateAssignmentSchema))
    dto: UpdateAssignmentDto,
  ) {
    return this.assignmentService.update(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      id,
      dto,
    );
  }

  /**
   * DELETE /assignments/:id — Delete a draft assignment with no
   * submissions. Returns 204 on success, 409 otherwise.
   */
  @Delete('assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.assignmentService.delete(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      id,
    );
  }

  /**
   * POST /assignments/:id/publish — Flip `isPublished=true` and emit a
   * HOMEWORK_ASSIGNED fan-out via the transactional outbox.
   */
  @Post('assignments/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assignmentService.publish(
      { userId: user.sub, role: user.role as 'TEACHER' | 'ADMIN' },
      id,
    );
  }
}
