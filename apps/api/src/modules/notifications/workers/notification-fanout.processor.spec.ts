import { NotificationFanoutProcessor } from './notification-fanout.processor';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const LESSON_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_A = '33333333-3333-3333-3333-333333333333';
const STUDENT_B = '44444444-4444-4444-4444-444444444444';
const STUDENT_C = '55555555-5555-5555-5555-555555555555';

/**
 * NotificationFanoutProcessor unit tests — Requirements 16.1, 16.2, 16.4.
 *
 * Coverage:
 *   - lesson.published expands to all APPROVED students of the group.
 *   - Replay (same job processed twice) creates exactly |students|
 *     Notification rows in total → notification idempotency invariant.
 *   - Per-(kind, channel) preferences are honoured: disabled channels do
 *     not enqueue a delivery job.
 */
describe('NotificationFanoutProcessor', () => {
  let processor: NotificationFanoutProcessor;
  let prisma: any;
  let notificationsService: jest.Mocked<NotificationsService>;
  let notificationRepository: jest.Mocked<NotificationRepository>;
  let emailQueue: { add: jest.Mock };
  let telegramQueue: { add: jest.Mock };
  let pushQueue: { add: jest.Mock };
  let smsQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      lesson: { findUnique: jest.fn() },
      enrollment: { findMany: jest.fn() },
      group: { findUnique: jest.fn() },
    };
    notificationsService = {
      createNotification: jest.fn(),
      resolveChannelsForUser: jest.fn(),
    } as any;
    notificationRepository = {
      upsertDelivery: jest.fn().mockResolvedValue({}),
    } as any;
    emailQueue = { add: jest.fn().mockResolvedValue({ id: 'e1' }) };
    telegramQueue = { add: jest.fn().mockResolvedValue({ id: 't1' }) };
    pushQueue = { add: jest.fn().mockResolvedValue({ id: 'p1' }) };
    smsQueue = { add: jest.fn().mockResolvedValue({ id: 's1' }) };

    processor = new NotificationFanoutProcessor(
      prisma,
      notificationsService,
      notificationRepository,
      emailQueue as any,
      telegramQueue as any,
      pushQueue as any,
      smsQueue as any,
    );
  });

  // ------------------------------------------------------------------
  // lesson.published → fans out to all APPROVED students
  // ------------------------------------------------------------------

  describe('lesson.published', () => {
    function setupGroupWithThreeStudents(): void {
      prisma.lesson.findUnique.mockResolvedValue({
        id: LESSON_ID,
        title: 'Lesson 1',
        groupId: GROUP_ID,
      });
      prisma.enrollment.findMany.mockResolvedValue([
        { studentId: STUDENT_A },
        { studentId: STUDENT_B },
        { studentId: STUDENT_C },
      ]);
    }

    it('creates one notification per APPROVED student with deterministic idempotencyKey', async () => {
      setupGroupWithThreeStudents();

      // Each createNotification returns created=true with a distinct id.
      let counter = 0;
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: {
            id: `notif-${++counter}`,
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
          } as any,
          created: true,
        }),
      );
      // Default channel matrix: IN_APP only — no delivery jobs.
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-1',
        data: {
          topic: 'lesson.published',
          payload: {
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
          },
        },
      } as any);

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(3);

      // Verify idempotency key shape "lesson.published:{lessonId}:{studentId}"
      const calls = notificationsService.createNotification.mock.calls.map(
        (c) => c[0],
      );
      expect(calls.map((c) => c.idempotencyKey).sort()).toEqual(
        [STUDENT_A, STUDENT_B, STUDENT_C]
          .map((s) => `lesson.published:${LESSON_ID}:${s}`)
          .sort(),
      );
      expect(result.notificationsCreated).toBe(3);
      expect(result.deliveriesEnqueued).toBe(0);
    });

    it('replay (second run with same payload) creates 0 new notifications', async () => {
      setupGroupWithThreeStudents();
      // Simulate the second run: createIdempotent returns created=false.
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: {
            id: 'existing-id',
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
          } as any,
          created: false,
        }),
      );
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-replay',
        data: {
          topic: 'lesson.published',
          payload: {
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
          },
        },
      } as any);

      expect(result.notificationsCreated).toBe(0);
      // Service was still called for each student — the dedup happens at
      // the repository / DB layer, but the worker visits every recipient.
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(3);
    });

    it('only enqueues delivery jobs for channels enabled in user preferences', async () => {
      setupGroupWithThreeStudents();

      let counter = 0;
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: {
            id: `notif-${++counter}`,
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
          } as any,
          created: true,
        }),
      );
      // Student A: full matrix on. Student B: only EMAIL. Student C: nothing.
      notificationsService.resolveChannelsForUser.mockImplementation(
        async (userId, _kind) => {
          if (userId === STUDENT_A)
            return {
              IN_APP: true,
              EMAIL: true,
              TELEGRAM: true,
              PUSH: true,
            } as any;
          if (userId === STUDENT_B)
            return {
              IN_APP: true,
              EMAIL: true,
              TELEGRAM: false,
              PUSH: false,
            } as any;
          return {
            IN_APP: false,
            EMAIL: false,
            TELEGRAM: false,
            PUSH: false,
          } as any;
        },
      );

      const result = await processor.process({
        id: 'job-prefs',
        data: {
          topic: 'lesson.published',
          payload: {
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
          },
        },
      } as any);

      // Student A: 3 deliveries (EMAIL + TELEGRAM + PUSH)
      // Student B: 1 delivery (EMAIL)
      // Student C: 0 deliveries
      expect(result.deliveriesEnqueued).toBe(4);
      expect(emailQueue.add).toHaveBeenCalledTimes(2); // A + B
      expect(telegramQueue.add).toHaveBeenCalledTimes(1); // A only
      expect(pushQueue.add).toHaveBeenCalledTimes(1); // A only
    });

    it('sets a per-(notificationId, channel) BullMQ jobId for delivery dedup', async () => {
      setupGroupWithThreeStudents();
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: {
            id: `notif-${input.userId.slice(0, 4)}`,
            userId: input.userId,
            kind: input.kind,
            idempotencyKey: input.idempotencyKey,
          } as any,
          created: true,
        }),
      );
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: true,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      await processor.process({
        id: 'job-jobid',
        data: {
          topic: 'lesson.published',
          payload: { lessonId: LESSON_ID, groupId: GROUP_ID },
        },
      } as any);

      const emailCalls = emailQueue.add.mock.calls;
      expect(emailCalls).toHaveLength(3);
      for (const [, , opts] of emailCalls) {
        expect(opts.jobId).toMatch(/^notif-[a-z0-9]+:EMAIL$/);
      }
    });

    it('skips when lesson is missing (returns 0 recipients)', async () => {
      prisma.lesson.findUnique.mockResolvedValue(null);

      const result = await processor.process({
        id: 'job-missing',
        data: {
          topic: 'lesson.published',
          payload: { lessonId: LESSON_ID, groupId: GROUP_ID },
        },
      } as any);

      expect(result.notificationsCreated).toBe(0);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // enrollment.approved → 1 notification to the student
  // ------------------------------------------------------------------

  describe('enrollment.approved', () => {
    it('creates a single notification for the studentId with the right idempotency key', async () => {
      prisma.group.findUnique.mockResolvedValue({ name: 'IELTS guruhi' });
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-1', userId: STUDENT_A } as any,
        created: true,
      });
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-enr',
        data: {
          topic: 'enrollment.approved',
          payload: {
            enrollmentRequestId: 'req-1',
            enrollmentId: 'enr-1',
            studentId: STUDENT_A,
            groupId: GROUP_ID,
          },
        },
      } as any);

      expect(result.notificationsCreated).toBe(1);
      const arg = notificationsService.createNotification.mock.calls[0]?.[0];
      expect(arg).toBeDefined();
      expect(arg!.userId).toBe(STUDENT_A);
      expect(arg!.kind).toBe('ENROLLMENT_APPROVED');
      expect(arg!.idempotencyKey).toBe(
        `enrollment.approved:req-1:${STUDENT_A}`,
      );
    });
  });

  // ------------------------------------------------------------------
  // payment.succeeded → 1 notification to the payer
  // ------------------------------------------------------------------

  describe('payment.succeeded', () => {
    it('uses studentId when present, else teacherId, with paymeId in the key', async () => {
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-pay' } as any,
        created: true,
      });
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: true,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      await processor.process({
        id: 'job-pay-1',
        data: {
          topic: 'payment.succeeded',
          payload: {
            paymeId: 'pay-abc',
            studentId: STUDENT_A,
            teacherId: TEACHER_ID,
            amountUzs: 200_000,
          },
        },
      } as any);

      const argA = notificationsService.createNotification.mock.calls[0]?.[0];
      expect(argA).toBeDefined();
      expect(argA!.userId).toBe(STUDENT_A);
      expect(argA!.idempotencyKey).toBe(`payment.succeeded:pay-abc:${STUDENT_A}`);

      // Reset and try teacher-only path.
      notificationsService.createNotification.mockClear();
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-pay-2' } as any,
        created: true,
      });

      await processor.process({
        id: 'job-pay-2',
        data: {
          topic: 'payment.succeeded',
          payload: {
            paymeId: 'pay-def',
            studentId: null,
            teacherId: TEACHER_ID,
            amountUzs: 150_000,
          },
        },
      } as any);

      const argB = notificationsService.createNotification.mock.calls[0]?.[0];
      expect(argB).toBeDefined();
      expect(argB!.userId).toBe(TEACHER_ID);
      expect(argB!.idempotencyKey).toBe(
        `payment.succeeded:pay-def:${TEACHER_ID}`,
      );
    });
  });

  // ------------------------------------------------------------------
  // schedule.changed → all APPROVED students with version-tagged key
  // ------------------------------------------------------------------

  describe('schedule.changed', () => {
    it('fans out to APPROVED students with version-tagged idempotency key', async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        { studentId: STUDENT_A },
        { studentId: STUDENT_B },
      ]);
      prisma.group.findUnique.mockResolvedValue({ name: 'g' });
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: { id: `n-${input.userId}` } as any,
          created: true,
        }),
      );
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      await processor.process({
        id: 'job-sc',
        data: {
          topic: 'schedule.changed',
          payload: { groupId: GROUP_ID, version: 4 },
        },
      } as any);

      const keys = notificationsService.createNotification.mock.calls.map(
        (c) => c[0].idempotencyKey,
      );
      expect(keys.sort()).toEqual([
        `schedule.changed:${GROUP_ID}:v4:${STUDENT_A}`,
        `schedule.changed:${GROUP_ID}:v4:${STUDENT_B}`,
      ]);
    });
  });

  // ------------------------------------------------------------------
  // homework.assigned → all APPROVED students
  // ------------------------------------------------------------------

  describe('homework.assigned', () => {
    it('fans out to APPROVED students with assignmentId-tagged idempotency key', async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        { studentId: STUDENT_A },
        { studentId: STUDENT_B },
      ]);
      notificationsService.createNotification.mockImplementation(
        async (input) => ({
          notification: { id: `n-${input.userId}` } as any,
          created: true,
        }),
      );
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-hw',
        data: {
          topic: 'homework.assigned',
          payload: {
            assignmentId: 'asg-1',
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
            title: 'Week 1 HW',
          },
        },
      } as any);

      expect(result.notificationsCreated).toBe(2);
      const calls = notificationsService.createNotification.mock.calls.map(
        (c) => c[0],
      );
      expect(calls.every((c) => c.kind === 'HOMEWORK_ASSIGNED')).toBe(true);
      expect(calls.map((c) => c.idempotencyKey).sort()).toEqual([
        `homework.assigned:asg-1:${STUDENT_A}`,
        `homework.assigned:asg-1:${STUDENT_B}`,
      ]);
    });

    it('skips when the payload is missing assignmentId or groupId', async () => {
      const result = await processor.process({
        id: 'job-hw-missing',
        data: {
          topic: 'homework.assigned',
          payload: { lessonId: LESSON_ID },
        },
      } as any);
      expect(result.notificationsCreated).toBe(0);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // homework.graded → only the submission's owning student
  // ------------------------------------------------------------------

  describe('homework.graded', () => {
    const SUBMISSION_ID = '99999999-9999-9999-9999-999999999999';

    it('creates a single HOMEWORK_GRADED notification for the student with the right key', async () => {
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-grade' } as any,
        created: true,
      });
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-grade',
        data: {
          topic: 'homework.graded',
          payload: {
            submissionId: SUBMISSION_ID,
            assignmentId: 'asg-99',
            studentId: STUDENT_A,
            teacherId: TEACHER_ID,
            score: 85,
            totalPoints: 100,
          },
        },
      } as any);

      expect(result.notificationsCreated).toBe(1);
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);

      const arg = notificationsService.createNotification.mock.calls[0]?.[0];
      expect(arg).toBeDefined();
      expect(arg!.userId).toBe(STUDENT_A);
      expect(arg!.kind).toBe('HOMEWORK_GRADED');
      expect(arg!.idempotencyKey).toBe(
        `homework.graded:${SUBMISSION_ID}:${STUDENT_A}`,
      );
      // The score-bearing body is rendered when score + totalPoints are present.
      expect(arg!.body).toContain('85');
      expect(arg!.body).toContain('100');
      expect((arg!.data as any).submissionId).toBe(SUBMISSION_ID);
      expect((arg!.data as any).score).toBe(85);
    });

    it('replay (second run with same payload) creates 0 new notifications', async () => {
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-grade' } as any,
        created: false,
      });
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      const result = await processor.process({
        id: 'job-grade-replay',
        data: {
          topic: 'homework.graded',
          payload: {
            submissionId: SUBMISSION_ID,
            studentId: STUDENT_A,
            score: 70,
            totalPoints: 100,
          },
        },
      } as any);

      expect(result.notificationsCreated).toBe(0);
    });

    it('falls back to a generic body when score/totalPoints are missing', async () => {
      notificationsService.createNotification.mockResolvedValue({
        notification: { id: 'n-grade-noscore' } as any,
        created: true,
      });
      notificationsService.resolveChannelsForUser.mockResolvedValue({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
      } as any);

      await processor.process({
        id: 'job-grade-bare',
        data: {
          topic: 'homework.graded',
          payload: {
            submissionId: SUBMISSION_ID,
            studentId: STUDENT_A,
          },
        },
      } as any);

      const arg = notificationsService.createNotification.mock.calls[0]?.[0];
      expect(arg!.body).not.toMatch(/\d+\/\d+/);
    });

    it('skips when the payload is missing submissionId or studentId', async () => {
      const result = await processor.process({
        id: 'job-grade-missing',
        data: {
          topic: 'homework.graded',
          payload: { score: 80 },
        },
      } as any);
      expect(result.notificationsCreated).toBe(0);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Unknown topics — log + skip
  // ------------------------------------------------------------------

  describe('unknown topics', () => {
    it('returns 0 recipients for an unsupported topic', async () => {
      const result = await processor.process({
        id: 'job-x',
        data: {
          topic: 'something.weird',
          payload: { foo: 'bar' },
        },
      } as any);
      expect(result.notificationsCreated).toBe(0);
      expect(result.deliveriesEnqueued).toBe(0);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });
});
