import { TeacherAnalyticsService } from './teacher-analytics.service';

const TEACHER_ID = '00000000-0000-0000-0000-0000000000aa';
const STUDENT_A = '11111111-1111-1111-1111-1111111111aa';
const STUDENT_B = '22222222-2222-2222-2222-2222222222bb';
const GROUP_A = '33333333-3333-3333-3333-3333333333cc';
const GROUP_B = '44444444-4444-4444-4444-4444444444dd';
const COURSE_A = '55555555-5555-5555-5555-555555555511';
const COURSE_B = '66666666-6666-6666-6666-666666666622';

/**
 * TeacherAnalyticsService unit tests — Task 23.2.
 *
 * Each method is verified against:
 *   - the empty dataset (zeroed counts, empty arrays)
 *   - a populated dataset that exercises every aggregation branch
 *   - the scope filters constructed for the underlying Prisma read
 */
describe('TeacherAnalyticsService', () => {
  let service: TeacherAnalyticsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      enrollment: {
        findMany: jest.fn(),
      },
      group: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      course: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      invoice: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      submission: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      lesson: {
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    service = new TeacherAnalyticsService(prisma);
  });

  // ==================================================================
  // getOverview
  // ==================================================================

  describe('getOverview', () => {
    it('returns zeros when the teacher has no data', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);
      prisma.submission.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.group.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.invoice.aggregate.mockResolvedValue({
        _sum: { amountUzs: null },
        _count: { _all: 0 },
      });

      const result = await service.getOverview(TEACHER_ID);

      expect(result).toEqual({
        totalStudents: 0,
        activeStudents30d: 0,
        totalCourses: 0,
        publishedCourses: 0,
        totalGroups: 0,
        activeGroups: 0,
        paidInvoicesLast30d: 0,
        revenueLast30dUzs: 0,
      });
    });

    it('aggregates populated data and constrains every read to the teacher', async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        { studentId: STUDENT_A },
        { studentId: STUDENT_B },
      ]);
      prisma.submission.findMany.mockResolvedValue([
        { studentId: STUDENT_A },
      ]);
      prisma.course.count
        .mockResolvedValueOnce(4) // totalCourses
        .mockResolvedValueOnce(2); // publishedCourses
      prisma.group.count
        .mockResolvedValueOnce(5) // totalGroups
        .mockResolvedValueOnce(3); // activeGroups
      prisma.invoice.aggregate.mockResolvedValue({
        _sum: { amountUzs: 750_000 },
        _count: { _all: 12 },
      });

      const result = await service.getOverview(TEACHER_ID);

      expect(result).toEqual({
        totalStudents: 2,
        activeStudents30d: 1,
        totalCourses: 4,
        publishedCourses: 2,
        totalGroups: 5,
        activeGroups: 3,
        paidInvoicesLast30d: 12,
        revenueLast30dUzs: 750_000,
      });

      // Every read scopes by the teacher's groups via course.teacherId.
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
            group: { course: { teacherId: TEACHER_ID } },
          }),
          distinct: ['studentId'],
        }),
      );
      expect(prisma.course.count).toHaveBeenNthCalledWith(1, {
        where: { teacherId: TEACHER_ID },
      });
      expect(prisma.course.count).toHaveBeenNthCalledWith(2, {
        where: { teacherId: TEACHER_ID, isPublished: true },
      });
      expect(prisma.group.count).toHaveBeenNthCalledWith(1, {
        where: { course: { teacherId: TEACHER_ID } },
      });
      expect(prisma.group.count).toHaveBeenNthCalledWith(2, {
        where: { course: { teacherId: TEACHER_ID }, status: 'OPEN' },
      });
      const aggregateCall = prisma.invoice.aggregate.mock.calls[0]![0];
      expect(aggregateCall.where.teacherId).toBe(TEACHER_ID);
      expect(aggregateCall.where.status).toBe('PAID');
      expect(aggregateCall.where.paidAt.gte).toBeInstanceOf(Date);
      const expected30dAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const drift = Math.abs(
        aggregateCall.where.paidAt.gte.getTime() - expected30dAgoMs,
      );
      expect(drift).toBeLessThan(5_000);
    });

    it('treats null aggregate sum as zero (no paid invoices)', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);
      prisma.submission.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);
      prisma.group.count.mockResolvedValue(1);
      prisma.invoice.aggregate.mockResolvedValue({
        _sum: { amountUzs: null },
        _count: { _all: 0 },
      });

      const result = await service.getOverview(TEACHER_ID);
      expect(result.revenueLast30dUzs).toBe(0);
      expect(result.paidInvoicesLast30d).toBe(0);
    });
  });

  // ==================================================================
  // getEnrollmentTrend
  // ==================================================================

  describe('getEnrollmentTrend', () => {
    it('returns one bucket per day with zero defaults', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);

      const series = await service.getEnrollmentTrend(TEACHER_ID, 5);

      expect(series).toHaveLength(5);
      expect(series.every((p) => p.value === 0)).toBe(true);
      // Sorted ascending by date.
      const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
      expect(series).toEqual(sorted);
    });

    it('counts new enrollments into the correct bucket', async () => {
      const now = new Date();
      const today = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          12,
          0,
          0,
        ),
      );
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      prisma.enrollment.findMany.mockResolvedValue([
        { approvedAt: today },
        { approvedAt: today },
        { approvedAt: yesterday },
      ]);

      const series = await service.getEnrollmentTrend(TEACHER_ID, 7);

      const last = series[series.length - 1]!;
      const prev = series[series.length - 2]!;
      expect(last.value).toBe(2);
      expect(prev.value).toBe(1);
    });

    it('clamps days to a valid window', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);

      const tooSmall = await service.getEnrollmentTrend(TEACHER_ID, 0);
      expect(tooSmall.length).toBeGreaterThanOrEqual(1);

      const tooLarge = await service.getEnrollmentTrend(TEACHER_ID, 9999);
      expect(tooLarge.length).toBeLessThanOrEqual(365);
    });

    it('defaults to 30 days when no `days` argument is provided', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);

      const series = await service.getEnrollmentTrend(TEACHER_ID);
      expect(series).toHaveLength(30);
    });
  });

  // ==================================================================
  // getRevenueTrend
  // ==================================================================

  describe('getRevenueTrend', () => {
    it('sums paid invoice amounts into the bucket on `paidAt`', async () => {
      const now = new Date();
      const today = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          10,
          0,
          0,
        ),
      );

      prisma.invoice.findMany.mockResolvedValue([
        { amountUzs: 100_000, paidAt: today },
        { amountUzs: 50_000, paidAt: today },
      ]);

      const series = await service.getRevenueTrend(TEACHER_ID, 3);
      const last = series[series.length - 1]!;
      expect(last.value).toBe(150_000);
    });

    it('scopes to the teacher and PAID invoices', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);

      await service.getRevenueTrend(TEACHER_ID, 7);

      const call = prisma.invoice.findMany.mock.calls[0]![0];
      expect(call.where.teacherId).toBe(TEACHER_ID);
      expect(call.where.status).toBe('PAID');
      expect(call.where.paidAt.gte).toBeInstanceOf(Date);
      expect(call.where.paidAt.lte).toBeInstanceOf(Date);
    });
  });

  // ==================================================================
  // getTopCourses
  // ==================================================================

  describe('getTopCourses', () => {
    it('returns an empty list when the teacher has no groups', async () => {
      prisma.group.findMany.mockResolvedValue([]);

      const result = await service.getTopCourses(TEACHER_ID);
      expect(result).toEqual([]);
      expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
      expect(prisma.course.findMany).not.toHaveBeenCalled();
    });

    it('aggregates enrollments by course and sorts desc, capping at limit', async () => {
      prisma.group.findMany.mockResolvedValue([
        { id: GROUP_A, courseId: COURSE_A },
        { id: GROUP_B, courseId: COURSE_B },
      ]);
      prisma.enrollment.findMany.mockResolvedValue([
        { groupId: GROUP_A },
        { groupId: GROUP_A },
        { groupId: GROUP_A },
        { groupId: GROUP_B },
      ]);
      prisma.course.findMany.mockResolvedValue([
        { id: COURSE_A, title: 'Algebra', isPublished: true },
        { id: COURSE_B, title: 'Botany', isPublished: false },
      ]);

      const result = await service.getTopCourses(TEACHER_ID, 5);

      expect(result).toEqual([
        {
          courseId: COURSE_A,
          title: 'Algebra',
          enrollments: 3,
          isPublished: true,
        },
        {
          courseId: COURSE_B,
          title: 'Botany',
          enrollments: 1,
          isPublished: false,
        },
      ]);

      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: { course: { teacherId: TEACHER_ID } },
        select: { id: true, courseId: true },
      });
      // Course read scopes by teacher to prevent leaking across tenants.
      const courseCall = prisma.course.findMany.mock.calls[0]![0];
      expect(courseCall.where.teacherId).toBe(TEACHER_ID);
    });
  });

  // ==================================================================
  // getHomeworkStats
  // ==================================================================

  describe('getHomeworkStats', () => {
    it('returns zero counts for every status when there are no submissions', async () => {
      prisma.submission.groupBy.mockResolvedValue([]);

      const result = await service.getHomeworkStats(TEACHER_ID);
      expect(result).toEqual({
        DRAFT: 0,
        SUBMITTED: 0,
        IN_REVIEW: 0,
        GRADED: 0,
        RETURNED: 0,
      });
    });

    it('hydrates the histogram from groupBy results', async () => {
      prisma.submission.groupBy.mockResolvedValue([
        { status: 'DRAFT', _count: { _all: 1 } },
        { status: 'SUBMITTED', _count: { _all: 4 } },
        { status: 'GRADED', _count: { _all: 7 } },
      ]);

      const result = await service.getHomeworkStats(TEACHER_ID);
      expect(result).toEqual({
        DRAFT: 1,
        SUBMITTED: 4,
        IN_REVIEW: 0,
        GRADED: 7,
        RETURNED: 0,
      });

      const groupByCall = prisma.submission.groupBy.mock.calls[0]![0];
      expect(groupByCall.where.assignment.lesson.group.course.teacherId).toBe(
        TEACHER_ID,
      );
      expect(groupByCall.by).toEqual(['status']);
    });
  });

  // ==================================================================
  // getRevenueSeries (long-form analytics page)
  // ==================================================================

  describe('getRevenueSeries', () => {
    it('returns one bucket per day across the requested range, including empty days', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);

      const from = new Date('2024-06-10T00:00:00Z');
      const to = new Date('2024-06-12T23:59:59Z');
      const series = await service.getRevenueSeries(TEACHER_ID, { from, to });

      expect(series.map((p) => p.date)).toEqual([
        '2024-06-10',
        '2024-06-11',
        '2024-06-12',
      ]);
      expect(series.every((p) => p.paidInvoices === 0 && p.totalUzs === 0)).toBe(
        true,
      );
    });

    it('sums invoices into the correct daily bucket', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        { amountUzs: 100_000, paidAt: new Date('2024-06-10T08:00:00Z') },
        { amountUzs: 50_000, paidAt: new Date('2024-06-10T20:00:00Z') },
        { amountUzs: 250_000, paidAt: new Date('2024-06-12T15:00:00Z') },
      ]);

      const series = await service.getRevenueSeries(TEACHER_ID, {
        from: new Date('2024-06-10T00:00:00Z'),
        to: new Date('2024-06-12T23:59:59Z'),
      });

      const byDate = Object.fromEntries(series.map((p) => [p.date, p]));
      expect(byDate['2024-06-10']).toEqual({
        date: '2024-06-10',
        paidInvoices: 2,
        totalUzs: 150_000,
      });
      expect(byDate['2024-06-12']).toEqual({
        date: '2024-06-12',
        paidInvoices: 1,
        totalUzs: 250_000,
      });
    });
  });

  // ==================================================================
  // getStudentProgress
  // ==================================================================

  describe('getStudentProgress', () => {
    it('returns an empty list when the teacher has no enrollments', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);

      const rows = await service.getStudentProgress(TEACHER_ID);
      expect(rows).toEqual([]);
      expect(prisma.lesson.groupBy).not.toHaveBeenCalled();
      expect(prisma.submission.findMany).not.toHaveBeenCalled();
    });

    it('joins lesson + submission aggregates per (student, group) pair', async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        {
          id: 'e1',
          studentId: STUDENT_A,
          groupId: GROUP_A,
          approvedAt: new Date('2024-05-01T12:00:00Z'),
          student: { user: { fullName: 'Alice', email: 'alice@example.com' } },
          group: { id: GROUP_A, name: 'Group Alpha' },
        },
        {
          id: 'e2',
          studentId: STUDENT_B,
          groupId: GROUP_A,
          approvedAt: new Date('2024-05-02T12:00:00Z'),
          student: { user: { fullName: 'Bob', email: 'bob@example.com' } },
          group: { id: GROUP_A, name: 'Group Alpha' },
        },
        {
          id: 'e3',
          studentId: STUDENT_A,
          groupId: GROUP_B,
          approvedAt: new Date('2024-05-03T12:00:00Z'),
          student: { user: { fullName: 'Alice', email: 'alice@example.com' } },
          group: { id: GROUP_B, name: 'Group Beta' },
        },
      ]);

      prisma.lesson.groupBy.mockResolvedValue([
        { groupId: GROUP_A, _count: { _all: 8 } },
        { groupId: GROUP_B, _count: { _all: 3 } },
      ]);

      prisma.submission.findMany.mockResolvedValue([
        {
          studentId: STUDENT_A,
          status: 'GRADED',
          score: 80,
          assignment: { lesson: { groupId: GROUP_A } },
        },
        {
          studentId: STUDENT_A,
          status: 'GRADED',
          score: 100,
          assignment: { lesson: { groupId: GROUP_A } },
        },
        {
          studentId: STUDENT_B,
          status: 'IN_REVIEW',
          score: null,
          assignment: { lesson: { groupId: GROUP_A } },
        },
      ]);

      const rows = await service.getStudentProgress(TEACHER_ID);

      expect(rows.map((r) => `${r.groupName}/${r.fullName}`)).toEqual([
        'Group Alpha/Alice',
        'Group Alpha/Bob',
        'Group Beta/Alice',
      ]);

      const alphaAlice = rows[0]!;
      expect(alphaAlice.studentId).toBe(STUDENT_A);
      expect(alphaAlice.lessonsAccessed).toBe(8);
      expect(alphaAlice.submissionsCount).toBe(2);
      expect(alphaAlice.averageGrade).toBe(90);
    });
  });
});
