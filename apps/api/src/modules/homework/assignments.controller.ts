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
import { AssignmentActorRole, AssignmentService } from './assignment.service';
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
 *   GET    /lessons/:lessonId/assignments          [TEACHER, ADMIN, STUDENT]
 *   GET    /assignments/:id                        [TEACHER, ADMIN, STUDENT]
 *   PATCH  /assignments/:id                        [TEACHER, ADMIN]
 *   DELETE /assignments/:id                        [TEACHER, ADMIN]
 *   POST   /assignments/:id/publish                [TEACHER, ADMIN]
 *
 * Authorization:
 *   - Every route requires JWT auth. Writes are TEACHER or ADMIN; the two
 *     reads additionally serve STUDENT.
 *   - Ownership: the service layer verifies the caller's userId matches
 *     `lesson.group.course.teacherId` for TEACHER actors. ADMIN bypasses
 *     the ownership check.
 *   - Students: authorized by an APPROVED `Enrollment` in the lesson's
 *     group, and only see `isPublished` assignments.
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
/**
 * Roles are declared per route, not on the class.
 *
 * The two read routes are also a STUDENT surface — `/homework/[assignmentId]`
 * and the assignment list on a lesson page both call them. A class-level
 * `@Roles('TEACHER','ADMIN')` made every student request 403, so the student
 * homework pages could never load their data. Reads authorize students
 * through an APPROVED enrollment inside `AssignmentService`; writes stay
 * teacher-only.
 */
@Controller()
export class AssignmentsController {
  constructor(private readonly assignmentService: AssignmentService) {}

  /**
   * POST /lessons/:lessonId/assignments — Create a draft Assignment with
   * one or more AssignmentModule rows.
   */
  @Roles('TEACHER', 'ADMIN')
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

  /**
   * GET /lessons/:lessonId/assignments — List a lesson's assignments.
   * Students see only published ones, and only for groups they are
   * APPROVED in.
   */
  @Roles('TEACHER', 'ADMIN', 'STUDENT')
  @Get('lessons/:lessonId/assignments')
  async listForLesson(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.assignmentService.listForLesson(
      { userId: user.sub, role: user.role as AssignmentActorRole },
      lessonId,
    );
  }

  /**
   * GET /assignments/:id — Single assignment with its modules. Students
   * must be APPROVED in the group and the assignment must be published.
   */
  @Roles('TEACHER', 'ADMIN', 'STUDENT')
  @Get('assignments/:id')
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assignmentService.getById(
      { userId: user.sub, role: user.role as AssignmentActorRole },
      id,
    );
  }

  /**
   * PATCH /assignments/:id — Partial update. Supports editing scalar
   * fields and / or replacing the entire module set.
   */
  @Roles('TEACHER', 'ADMIN')
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
  @Roles('TEACHER', 'ADMIN')
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
  @Roles('TEACHER', 'ADMIN')
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
