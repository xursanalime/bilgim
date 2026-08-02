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
import {
  CreateScheduleEventDto,
  CreateScheduleEventSchema,
  UpdateScheduleEventDto,
  UpdateScheduleEventSchema,
} from './dto';
import { ScheduleService } from './schedule.service';

/**
 * ScheduleController — REST endpoints for the per-group recurring schedule
 * (Req 10.1, 10.2, 10.3, 10.5).
 *
 * Routes:
 *   POST   /schedule/events                       [TEACHER]
 *   PATCH  /schedule/events/:id                   [TEACHER]
 *   DELETE /schedule/events/:id                   [TEACHER]
 *   GET    /schedule/groups/:groupId/events       [TEACHER, STUDENT, ADMIN]
 *
 * Authorization:
 *   - Mutating routes are TEACHER-only; ownership of the parent group is
 *     enforced inside `ScheduleService` (404 / 403 NOT_OWNING_TEACHER).
 *   - GET branches on the caller's role:
 *       TEACHER → must own the group  (`assertTeacherOwnsGroup`)
 *       STUDENT → must have APPROVED enrollment in the group
 *                 (`assertStudentEnrolledInGroup` — same predicate as
 *                 `LessonAccessGuard`).
 *       ADMIN  → read-only audit access (Req 6.4 generalized to schedules).
 */
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /**
   * POST /schedule/events — Create the (one) schedule for a group. The
   * group must be owned by the calling teacher. Bumps version to 1 and
   * emits `schedule.changed` (Req 10.1).
   */
  @Roles('TEACHER')
  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateScheduleEventSchema))
    dto: CreateScheduleEventDto,
  ) {
    return this.scheduleService.createScheduleEvent(user.sub, dto);
  }

  /**
   * PATCH /schedule/events/:id — Update an existing schedule. Bumps
   * version by exactly 1 and emits `schedule.changed` (Req 10.1).
   */
  @Roles('TEACHER')
  @Patch('events/:id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateScheduleEventSchema))
    dto: UpdateScheduleEventDto,
  ) {
    return this.scheduleService.updateScheduleEvent(user.sub, id, dto);
  }

  /**
   * DELETE /schedule/events/:id — Remove the schedule. Still bumps the
   * version (so subscribers see a fresh value) and emits
   * `schedule.changed { changeType: DELETED }` (Req 10.1).
   */
  @Roles('TEACHER')
  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.scheduleService.deleteScheduleEvent(user.sub, id);
  }

  /**
   * GET /schedule/groups/:groupId/events — Return the current schedule
   * for the group plus a bounded list of upcoming RRULE occurrences.
   *
   * Access:
   *   - TEACHER must own the group (404 GROUP_NOT_FOUND / 403
   *     NOT_OWNING_TEACHER otherwise).
   *   - STUDENT must have an APPROVED enrollment (403 GROUP_ACCESS_DENIED
   *     otherwise).
   *   - ADMIN is allowed read-only.
   */
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('groups/:groupId/events')
  async listForGroup(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    if (user.role === 'TEACHER') {
      await this.scheduleService.assertTeacherOwnsGroup(user.sub, groupId);
    } else if (user.role === 'STUDENT') {
      await this.scheduleService.assertStudentEnrolledInGroup(
        user.sub,
        groupId,
      );
    }
    // ADMIN — no further check (audit access).
    return this.scheduleService.listEventsForGroup(groupId);
  }
}
