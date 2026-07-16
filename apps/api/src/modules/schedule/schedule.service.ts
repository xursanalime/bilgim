import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Group, PrismaClient, Schedule } from '@prisma/client';
import { RRule } from 'rrule';

import { OutboxService } from '../../infra/outbox/outbox.service';
import {
  CreateScheduleEventDto,
  UpdateScheduleEventDto,
} from './dto';
import { ScheduleRepository } from './repositories/schedule.repository';

export interface ScheduleEventOccurrence {
  /** UTC start instant of this occurrence. */
  start: string;
  /** UTC end instant (`start + durationMin`). */
  end: string;
}

export interface ScheduleEventResource {
  id: string;
  groupId: string;
  rrule: string;
  timezone: string;
  durationMin: number;
  version: number;
  updatedAt: string;
}

export interface ScheduleEventsForGroupResult {
  groupId: string;
  version: number;
  schedule: ScheduleEventResource | null;
  /** Concrete occurrences derived from the RRULE (UTC). */
  occurrences: ScheduleEventOccurrence[];
}

/**
 * ScheduleService — owns the per-group recurring schedule CRUD and the
 * monotonic versioning + `schedule.changed` outbox emission (Req 10.1).
 *
 * Concurrency / monotonicity:
 *   - On create: `Schedule.version = 1` (first row).
 *   - On every PATCH or DELETE: `version` is bumped by exactly 1 inside
 *     the same DB transaction as the data change. Two concurrent updates
 *     end up with consecutive versions (`v`, `v+1`) — the SQL `version =
 *     version + 1` is atomic — so Property 8 holds even under load.
 *
 * Outbox emission:
 *   - Idempotency key includes the post-bump `version`, so the same logical
 *     change can be retried safely without producing duplicate events.
 *   - The outbox INSERT happens in the same transaction as the schedule
 *     mutation; the BEGIN/COMMIT pair is the design-doc contract.
 *
 * Authorization:
 *   - Mutations: TEACHER must own the parent course
 *     (`schedule.group.course.teacherId == teacherId`); else 403
 *     NOT_OWNING_TEACHER. 404 SCHEDULE_NOT_FOUND for missing rows.
 *   - GET (list events for group): caller is gated outside this service
 *     (controller verifies role + enrollment).
 */
@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  /**
   * Cap occurrence expansion. RRULE can produce infinite sequences (e.g.
   * `FREQ=WEEKLY` without `UNTIL`/`COUNT`), and a runaway expansion would
   * blow up the response and the JSON serializer. The cap is generous
   * enough to cover ~1 year of weekly classes.
   */
  private static readonly MAX_OCCURRENCES = 200;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly scheduleRepository: ScheduleRepository,
    private readonly outboxService: OutboxService,
  ) {}

  // ==================================================================
  // Mutations (TEACHER only) — Req 10.1
  // ==================================================================

  /**
   * Create the (one) schedule for a group. The teacher must own the parent
   * course. Sets `version = 1` and emits `schedule.changed` v1 atomically.
   *
   * Errors:
   *   - 404 GROUP_NOT_FOUND       — group does not exist
   *   - 403 NOT_OWNING_TEACHER    — group belongs to another teacher
   *   - 409 SCHEDULE_ALREADY_EXISTS — group already has a schedule (use PATCH)
   */
  async createScheduleEvent(
    teacherId: string,
    dto: CreateScheduleEventDto,
  ): Promise<ScheduleEventResource> {
    const group = await this.assertGroupOwnership(teacherId, dto.groupId);

    // Pre-check: surface the friendlier 409 before we hit the unique index.
    const existing = await this.scheduleRepository.findByGroupId(group.id);
    if (existing) {
      throw new ConflictException({
        code: 'SCHEDULE_ALREADY_EXISTS',
        message: `Group ${group.id} already has a schedule. Use PATCH /schedule/events/:id to update it.`,
      });
    }

    const schedule = await this.prisma.$transaction(async (tx) => {
      const created = await this.scheduleRepository.create(
        {
          groupId: group.id,
          rrule: dto.rrule,
          timezone: dto.timezone,
          durationMin: dto.durationMin,
        },
        tx,
      );

      await this.outboxService.create(tx, {
        topic: 'schedule.changed',
        payload: {
          groupId: created.groupId,
          version: created.version,
          scheduleId: created.id,
          rrule: created.rrule,
          timezone: created.timezone,
          durationMin: created.durationMin,
          changeType: 'CREATED',
        },
        idempotencyKey: `schedule.changed:${created.id}:v${created.version}`,
      });

      return created;
    });

    this.logger.log(
      `Schedule created: id=${schedule.id} group=${schedule.groupId} version=${schedule.version} (teacher=${teacherId})`,
    );
    return this.toResource(schedule);
  }

  /**
   * PATCH a schedule. Bumps `version` by exactly 1 (atomic UPDATE) and
   * emits `schedule.changed` with the new version.
   *
   * Errors:
   *   - 404 SCHEDULE_NOT_FOUND
   *   - 403 NOT_OWNING_TEACHER
   */
  async updateScheduleEvent(
    teacherId: string,
    id: string,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleEventResource> {
    await this.assertScheduleOwnership(teacherId, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await this.scheduleRepository.incrementAndUpdate(
        id,
        {
          ...(dto.rrule !== undefined && { rrule: dto.rrule }),
          ...(dto.timezone !== undefined && { timezone: dto.timezone }),
          ...(dto.durationMin !== undefined && {
            durationMin: dto.durationMin,
          }),
        },
        tx,
      );

      await this.outboxService.create(tx, {
        topic: 'schedule.changed',
        payload: {
          groupId: next.groupId,
          version: next.version,
          scheduleId: next.id,
          rrule: next.rrule,
          timezone: next.timezone,
          durationMin: next.durationMin,
          changeType: 'UPDATED',
        },
        idempotencyKey: `schedule.changed:${next.id}:v${next.version}`,
      });

      return next;
    });

    this.logger.log(
      `Schedule updated: id=${updated.id} group=${updated.groupId} version=${updated.version} (teacher=${teacherId})`,
    );
    return this.toResource(updated);
  }

  /**
   * DELETE a schedule. Bumps `version` by exactly 1 (so subscribers see a
   * fresh value), emits `schedule.changed` with `changeType=DELETED`, and
   * removes the row — all in one transaction.
   *
   * Errors:
   *   - 404 SCHEDULE_NOT_FOUND
   *   - 403 NOT_OWNING_TEACHER
   */
  async deleteScheduleEvent(teacherId: string, id: string): Promise<void> {
    await this.assertScheduleOwnership(teacherId, id);

    await this.prisma.$transaction(async (tx) => {
      // Bump the version BEFORE we delete so the outbox payload carries
      // a strictly-increasing value. Subscribers (notification fan-out)
      // use this to dedupe per `(groupId, version)`.
      const bumped = await this.scheduleRepository.incrementVersionForDelete(
        id,
        tx,
      );

      await this.outboxService.create(tx, {
        topic: 'schedule.changed',
        payload: {
          groupId: bumped.groupId,
          version: bumped.version,
          scheduleId: bumped.id,
          changeType: 'DELETED',
        },
        idempotencyKey: `schedule.changed:${bumped.id}:v${bumped.version}`,
      });

      const result = await this.scheduleRepository.delete(id, tx);
      if (result.count === 0) {
        // Row vanished between the bump and the delete; the bumped row
        // already updated the version, but the outbox event will lack a
        // schedule to point at. Treat as 404.
        throw new NotFoundException({
          code: 'SCHEDULE_NOT_FOUND',
          message: `Schedule ${id} no longer exists`,
        });
      }
    });

    this.logger.log(
      `Schedule deleted: id=${id} (teacher=${teacherId})`,
    );
  }

  // ==================================================================
  // Reads — used by GET /schedule/groups/:groupId/events
  // ==================================================================

  /**
   * Resolve the (one) schedule for a group plus a bounded list of upcoming
   * RRULE occurrences. Returns `schedule = null` and an empty `occurrences`
   * list when the group has no schedule yet.
   *
   * The controller is responsible for caller authorization (TEACHER who
   * owns the group, STUDENT with APPROVED enrollment, or ADMIN audit).
   */
  async listEventsForGroup(
    groupId: string,
    options?: {
      /** Window start. Defaults to "now". */
      after?: Date;
      /** Window end. Defaults to `after + 90 days`. */
      until?: Date;
    },
  ): Promise<ScheduleEventsForGroupResult> {
    const schedule = await this.scheduleRepository.findByGroupId(groupId);
    if (!schedule) {
      return {
        groupId,
        version: 0,
        schedule: null,
        occurrences: [],
      };
    }

    const after = options?.after ?? new Date();
    const until =
      options?.until ?? new Date(after.getTime() + 90 * 24 * 60 * 60 * 1000);

    const occurrences = this.expandOccurrences(schedule, after, until);

    return {
      groupId,
      version: schedule.version,
      schedule: this.toResource(schedule),
      occurrences,
    };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private toResource(schedule: Schedule): ScheduleEventResource {
    return {
      id: schedule.id,
      groupId: schedule.groupId,
      rrule: schedule.rrule,
      timezone: schedule.timezone,
      durationMin: schedule.durationMin,
      version: schedule.version,
      updatedAt: schedule.updatedAt.toISOString(),
    };
  }

  /**
   * Expand the RRULE within `[after, until]`, returning at most
   * `MAX_OCCURRENCES` results. Out-of-range or malformed RRULE values
   * fall back to an empty list and log a warning — the validation pipe
   * already rejected obviously invalid strings, so this branch only
   * fires on edge-case rules (e.g. UNTIL in the past).
   */
  private expandOccurrences(
    schedule: Schedule,
    after: Date,
    until: Date,
  ): ScheduleEventOccurrence[] {
    try {
      const rule = RRule.fromString(schedule.rrule);
      const dates = rule.between(after, until, true).slice(
        0,
        ScheduleService.MAX_OCCURRENCES,
      );
      return dates.map((d) => ({
        start: d.toISOString(),
        end: new Date(
          d.getTime() + schedule.durationMin * 60 * 1000,
        ).toISOString(),
      }));
    } catch (error) {
      this.logger.warn(
        `RRULE expansion failed for schedule ${schedule.id} (rrule="${schedule.rrule}"): ${(error as Error).message}`,
      );
      return [];
    }
  }

  // ==================================================================
  // Ownership helpers
  // ==================================================================

  /**
   * Resolve a Group, asserting it exists and is owned by `teacherId`. Used
   * by the create path where we only have a `groupId`. Returns the group
   * row (without the joined `course` field — the parent course is checked
   * here and not needed downstream).
   */
  private async assertGroupOwnership(
    teacherId: string,
    groupId: string,
  ): Promise<Group> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }
    if (group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only manage schedules for your own groups',
      });
    }
    const { course: _course, ...plain } = group;
    return plain as Group;
  }

  /**
   * Resolve a schedule, asserting it exists and that `teacherId` owns the
   * parent course. Used by PATCH and DELETE.
   */
  private async assertScheduleOwnership(
    teacherId: string,
    id: string,
  ): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findByIdWithOwnership(id);
    if (!schedule) {
      throw new NotFoundException({
        code: 'SCHEDULE_NOT_FOUND',
        message: `Schedule ${id} not found`,
      });
    }
    if (schedule.group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only manage schedules for your own groups',
      });
    }
    const { group: _group, ...plain } = schedule;
    return plain as Schedule;
  }

  /**
   * Verify a student has an APPROVED enrollment in `groupId`. Mirrors the
   * predicate used by `LessonAccessGuard` for individual lesson reads
   * (Req 6.1 / 6.2 / 6.6). Used by the controller for GET access on
   * `STUDENT` callers.
   */
  async assertStudentEnrolledInGroup(
    studentId: string,
    groupId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
    });
    if (!enrollment || enrollment.status !== 'APPROVED') {
      throw new ForbiddenException({
        code: 'GROUP_ACCESS_DENIED',
        message:
          'You do not have approved access to this group. Pay and wait for teacher approval to enroll.',
      });
    }
  }

  /**
   * Verify a teacher owns the parent course of `groupId`. Used by the
   * controller for GET access on `TEACHER` callers.
   */
  async assertTeacherOwnsGroup(
    teacherId: string,
    groupId: string,
  ): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }
    if (group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only access schedules for your own groups',
      });
    }
  }
}
