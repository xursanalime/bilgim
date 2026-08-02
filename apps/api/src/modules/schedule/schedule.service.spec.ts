import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { ScheduleService } from './schedule.service';
import { ScheduleRepository } from './repositories/schedule.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = '00000000-0000-0000-0000-000000000099';
const STUDENT_ID = '00000000-0000-0000-0000-0000000000aa';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const SCHEDULE_ID = '55555555-5555-5555-5555-555555555555';

/**
 * Reasonable RRULE: every Tuesday, Thursday and Saturday at 20:00. Matches
 * the design-doc example so reviewers can spot-check the expansion.
 */
const VALID_RRULE = 'FREQ=WEEKLY;BYDAY=TU,TH,SA;BYHOUR=20;BYMINUTE=0;BYSECOND=0';

/**
 * ScheduleService unit tests — Requirements 10.1, 10.2, 10.3, 10.5.
 *
 * Coverage:
 *   - createScheduleEvent: ownership, version=1, outbox emission.
 *   - updateScheduleEvent: monotonic version bump (atomic INCREMENT),
 *     outbox emission, ownership errors.
 *   - deleteScheduleEvent: version bump before delete, outbox emission,
 *     ownership errors.
 *   - listEventsForGroup: returns null schedule when missing, expands
 *     RRULE within window.
 *   - assertStudentEnrolledInGroup / assertTeacherOwnsGroup helpers used
 *     by the controller for GET access.
 */
describe('ScheduleService', () => {
  let service: ScheduleService;
  let scheduleRepository: jest.Mocked<ScheduleRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let prisma: any;

  beforeEach(() => {
    scheduleRepository = {
      findById: jest.fn(),
      findByIdWithOwnership: jest.fn(),
      findByGroupId: jest.fn(),
      create: jest.fn(),
      incrementAndUpdate: jest.fn(),
      incrementVersionForDelete: jest.fn(),
      delete: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;

    prisma = {
      group: { findUnique: jest.fn() },
      enrollment: { findUnique: jest.fn() },
      // `$transaction(fn)` runs the callback with prisma itself as tx,
      // matching the helper used in the other module specs.
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) =>
        fn(prisma),
      ),
    };

    service = new ScheduleService(prisma, scheduleRepository, outboxService);
  });

  // ==================================================================
  // createScheduleEvent (Req 10.1)
  // ==================================================================

  describe('createScheduleEvent', () => {
    function setupOwnedGroup() {
      prisma.group.findUnique.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: TEACHER_ID },
      });
    }

    it('creates with version=1 and emits schedule.changed v1 atomically', async () => {
      setupOwnedGroup();
      scheduleRepository.findByGroupId.mockResolvedValue(null);
      const created = {
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule: VALID_RRULE,
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      scheduleRepository.create.mockResolvedValue(created as any);

      const result = await service.createScheduleEvent(TEACHER_ID, {
        groupId: GROUP_ID,
        rrule: VALID_RRULE,
        timezone: 'Asia/Tashkent',
        durationMin: 90,
      });

      expect(result.version).toBe(1);
      expect(result.id).toBe(SCHEDULE_ID);
      // Outbox event includes the post-bump version and the documented
      // idempotency key shape (`schedule.changed:{groupId}:v{version}`).
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'schedule.changed',
          idempotencyKey: `schedule.changed:${SCHEDULE_ID}:v1`,
          payload: expect.objectContaining({
            groupId: GROUP_ID,
            version: 1,
            scheduleId: SCHEDULE_ID,
            changeType: 'CREATED',
          }),
        }),
      );
      // Atomicity: schedule write and outbox INSERT happen in the same
      // transaction (we run both on the same `tx` argument).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws 409 SCHEDULE_ALREADY_EXISTS when the group already has a schedule', async () => {
      setupOwnedGroup();
      scheduleRepository.findByGroupId.mockResolvedValue({
        id: SCHEDULE_ID,
      } as any);

      await expect(
        service.createScheduleEvent(TEACHER_ID, {
          groupId: GROUP_ID,
          rrule: VALID_RRULE,
          timezone: 'Asia/Tashkent',
          durationMin: 90,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(scheduleRepository.create).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      });

      await expect(
        service.createScheduleEvent(TEACHER_ID, {
          groupId: GROUP_ID,
          rrule: VALID_RRULE,
          timezone: 'Asia/Tashkent',
          durationMin: 90,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(scheduleRepository.create).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws 404 GROUP_NOT_FOUND when the group is missing', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.createScheduleEvent(TEACHER_ID, {
          groupId: GROUP_ID,
          rrule: VALID_RRULE,
          timezone: 'Asia/Tashkent',
          durationMin: 90,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // updateScheduleEvent (Req 10.1) — Property-8 anchor
  // ==================================================================

  describe('updateScheduleEvent', () => {
    function setupOwnedSchedule(version: number) {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule: VALID_RRULE,
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version,
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        group: {
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        },
      } as any);
    }

    it('bumps version by exactly 1 and emits schedule.changed with the new version', async () => {
      setupOwnedSchedule(3);
      scheduleRepository.incrementAndUpdate.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule: VALID_RRULE,
        timezone: 'Asia/Tashkent',
        durationMin: 60,
        version: 4,
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      } as any);

      const result = await service.updateScheduleEvent(
        TEACHER_ID,
        SCHEDULE_ID,
        { durationMin: 60 },
      );

      expect(result.version).toBe(4);
      // The repository receives ONLY `durationMin`; undefined fields must
      // not clobber existing values. The atomic `version: { increment: 1 }`
      // happens inside the repo, not here.
      expect(scheduleRepository.incrementAndUpdate).toHaveBeenCalledWith(
        SCHEDULE_ID,
        { durationMin: 60 },
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'schedule.changed',
          idempotencyKey: `schedule.changed:${SCHEDULE_ID}:v4`,
          payload: expect.objectContaining({
            groupId: GROUP_ID,
            version: 4,
            changeType: 'UPDATED',
            durationMin: 60,
          }),
        }),
      );
    });

    it('passes ONLY provided fields to the repository (no clobbering)', async () => {
      setupOwnedSchedule(1);
      scheduleRepository.incrementAndUpdate.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule: 'FREQ=DAILY',
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version: 2,
        updatedAt: new Date(),
      } as any);

      await service.updateScheduleEvent(TEACHER_ID, SCHEDULE_ID, {
        rrule: 'FREQ=DAILY',
      });

      expect(scheduleRepository.incrementAndUpdate).toHaveBeenCalledWith(
        SCHEDULE_ID,
        { rrule: 'FREQ=DAILY' },
        expect.anything(),
      );
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher schedule', async () => {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        version: 1,
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.updateScheduleEvent(TEACHER_ID, SCHEDULE_ID, {
          rrule: 'FREQ=DAILY',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(scheduleRepository.incrementAndUpdate).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws 404 SCHEDULE_NOT_FOUND when missing', async () => {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue(null);

      await expect(
        service.updateScheduleEvent(TEACHER_ID, SCHEDULE_ID, {
          rrule: 'FREQ=DAILY',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // deleteScheduleEvent (Req 10.1)
  // ==================================================================

  describe('deleteScheduleEvent', () => {
    function setupOwnedSchedule(version: number) {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule: VALID_RRULE,
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version,
        updatedAt: new Date(),
        group: {
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        },
      } as any);
    }

    it('bumps version, emits schedule.changed{DELETED}, then removes the row — all in one tx', async () => {
      setupOwnedSchedule(7);
      scheduleRepository.incrementVersionForDelete.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        version: 8,
      } as any);
      scheduleRepository.delete.mockResolvedValue({ count: 1 });

      await service.deleteScheduleEvent(TEACHER_ID, SCHEDULE_ID);

      // Order matters: bump → outbox → delete. Verify call sequence by
      // inspecting Jest's mock invocation order.
      const bumpOrder =
        scheduleRepository.incrementVersionForDelete.mock.invocationCallOrder[0]!;
      const outboxOrder = outboxService.create.mock.invocationCallOrder[0]!;
      const deleteOrder = scheduleRepository.delete.mock.invocationCallOrder[0]!;
      expect(bumpOrder).toBeDefined();
      expect(outboxOrder).toBeDefined();
      expect(deleteOrder).toBeDefined();
      expect(bumpOrder).toBeLessThan(outboxOrder);
      expect(outboxOrder).toBeLessThan(deleteOrder);

      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'schedule.changed',
          // Keyed by scheduleId, not groupId: a group can own several
          // schedule events, and keying on the group would collapse two
          // different events that happen to share a version number.
          idempotencyKey: `schedule.changed:${SCHEDULE_ID}:v8`,
          payload: expect.objectContaining({
            groupId: GROUP_ID,
            version: 8,
            changeType: 'DELETED',
          }),
        }),
      );
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher schedule', async () => {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        version: 1,
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.deleteScheduleEvent(TEACHER_ID, SCHEDULE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(scheduleRepository.incrementVersionForDelete).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws 404 SCHEDULE_NOT_FOUND when missing', async () => {
      scheduleRepository.findByIdWithOwnership.mockResolvedValue(null);

      await expect(
        service.deleteScheduleEvent(TEACHER_ID, SCHEDULE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // listEventsForGroup
  // ==================================================================

  describe('listEventsForGroup', () => {
    it('returns null schedule + empty occurrences when the group has no schedule yet', async () => {
      scheduleRepository.findByGroupId.mockResolvedValue(null);

      const result = await service.listEventsForGroup(GROUP_ID);

      expect(result).toEqual({
        groupId: GROUP_ID,
        version: 0,
        schedule: null,
        occurrences: [],
      });
    });

    it('expands RRULE occurrences within the window', async () => {
      // Fixed start point so the test is deterministic.
      const after = new Date('2026-01-05T00:00:00.000Z'); // a Monday
      const until = new Date('2026-01-19T00:00:00.000Z');

      scheduleRepository.findByGroupId.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule:
          'FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=20;BYMINUTE=0;BYSECOND=0;DTSTART=20260105T000000Z',
        timezone: 'Asia/Tashkent',
        durationMin: 90,
        version: 2,
        updatedAt: new Date('2026-01-04T00:00:00Z'),
      } as any);

      const result = await service.listEventsForGroup(GROUP_ID, {
        after,
        until,
      });

      expect(result.schedule?.id).toBe(SCHEDULE_ID);
      expect(result.version).toBe(2);
      // Expecting 2 weeks * 2 days = 4 occurrences (Tue, Thu, Tue, Thu).
      expect(result.occurrences).toHaveLength(4);
      // Each occurrence has start + end with end = start + 90min.
      for (const occ of result.occurrences) {
        const start = new Date(occ.start).getTime();
        const end = new Date(occ.end).getTime();
        expect(end - start).toBe(90 * 60 * 1000);
      }
    });

    it('falls back to empty occurrences and does not throw when RRULE expansion fails', async () => {
      // A syntactically valid but semantically degenerate RRULE — UNTIL
      // before DTSTART will yield 0 results, but more importantly any
      // error raised inside expand should be swallowed.
      scheduleRepository.findByGroupId.mockResolvedValue({
        id: SCHEDULE_ID,
        groupId: GROUP_ID,
        rrule:
          'FREQ=WEEKLY;DTSTART=20260101T000000Z;UNTIL=20251231T000000Z',
        timezone: 'Asia/Tashkent',
        durationMin: 60,
        version: 1,
        updatedAt: new Date(),
      } as any);

      const result = await service.listEventsForGroup(GROUP_ID, {
        after: new Date('2026-01-01T00:00:00Z'),
        until: new Date('2026-02-01T00:00:00Z'),
      });

      expect(result.occurrences).toEqual([]);
    });
  });

  // ==================================================================
  // GET access helpers used by the controller
  // ==================================================================

  describe('assertTeacherOwnsGroup', () => {
    it('passes for an owned group', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: TEACHER_ID },
      });

      await expect(
        service.assertTeacherOwnsGroup(TEACHER_ID, GROUP_ID),
      ).resolves.toBeUndefined();
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      });

      await expect(
        service.assertTeacherOwnsGroup(TEACHER_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'NOT_OWNING_TEACHER' },
      });
    });

    it('throws 404 GROUP_NOT_FOUND when the group is missing', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.assertTeacherOwnsGroup(TEACHER_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_NOT_FOUND' },
      });
    });
  });

  describe('assertStudentEnrolledInGroup', () => {
    it('passes for an APPROVED enrollment', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'APPROVED',
      });

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).resolves.toBeUndefined();
    });

    it('throws 403 GROUP_ACCESS_DENIED with no enrollment', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_ACCESS_DENIED' },
      });
    });

    it('throws 403 GROUP_ACCESS_DENIED with PENDING enrollment (Req 6.6 generalized)', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'PENDING_APPROVAL',
      });

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_ACCESS_DENIED' },
      });
    });
  });
});
