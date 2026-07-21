import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, SubmissionStatus } from '@prisma/client';

/**
 * Public projections returned by `TeacherAnalyticsService` (Task 23.2).
 *
 * Two generations of widgets live side-by-side:
 *   1. Dashboard cards (`/teacher/analytics/overview`) — flat KPIs the
 *      home dashboard shows in a 2x2 grid.
 *   2. Long-form analytics page (`/teacher/analytics/{revenue,students}`)
 *      — the existing detailed view kept untouched for backwards
 *      compatibility with the Analitika tab.
 *   3. Trend / drill-down endpoints used by the new dashboard widgets:
 *      `/enrollment-trend`, `/revenue-trend`, `/top-courses`,
 *      `/homework-stats`.
 */
export interface TeacherAnalyticsOverview {
  /** Distinct enrolled students across every group the teacher owns
   *  (status APPROVED). */
  totalStudents: number;
  /** Students who submitted at least one Submission in the last 30 days. */
  activeStudents30d: number;
  /** Total Course rows owned by the teacher. */
  totalCourses: number;
  /** Course rows where `isPublished = true`. */
  publishedCourses: number;
  /** Total Group rows the teacher owns (any status). */
  totalGroups: number;
  /** Groups in `OPEN` status. */
  activeGroups: number;
  /** Count of paid invoices in the trailing 30 days. */
  paidInvoicesLast30d: number;
  /** Sum of paid invoice amounts (UZS) over the trailing 30 days. */
  revenueLast30dUzs: number;
}

export interface TeacherAnalyticsTrendPoint {
  /** ISO date (YYYY-MM-DD) at midnight UTC for the bucket. */
  date: string;
  /** Series value for the bucket (count or amount). */
  value: number;
}

export interface TeacherAnalyticsRevenuePoint {
  /** ISO date (YYYY-MM-DD) at midnight UTC for the bucket. */
  date: string;
  /** Number of paid invoices that landed in this day's window. */
  paidInvoices: number;
  /** Sum of paid invoice amounts (UZS) for the bucket. */
  totalUzs: number;
}

export interface TeacherAnalyticsTopCourse {
  courseId: string;
  title: string;
  enrollments: number;
  isPublished: boolean;
}

export type TeacherHomeworkStatusKey =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'GRADED'
  | 'RETURNED';

export type TeacherAnalyticsHomeworkStats = Record<
  TeacherHomeworkStatusKey,
  number
>;

export interface TeacherAnalyticsStudentRow {
  studentId: string;
  fullName: string | null;
  email: string;
  groupId: string;
  groupName: string;
  /** First APPROVED enrollment date for this student in the group. */
  enrolledAt: Date;
  /** READY lessons available to this enrollment (proxy for "lessons
   *  accessed" — there is no per-lesson access log on the student). */
  lessonsAccessed: number;
  /** Total submissions by this student against the teacher's assignments
   *  for the group. */
  submissionsCount: number;
  /** Average score across GRADED submissions. `null` when none. */
  averageGrade: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_REVENUE_WINDOW_DAYS = 30;
const MAX_REVENUE_WINDOW_DAYS = 365;
const DEFAULT_TREND_DAYS = 30;
const MIN_TREND_DAYS = 1;
const MAX_TREND_DAYS = 365;
const TOP_COURSES_LIMIT = 5;

const HOMEWORK_STATUS_KEYS: TeacherHomeworkStatusKey[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'GRADED',
  'RETURNED',
];

/**
 * TeacherAnalyticsService — read-only aggregation of teacher-scoped
 * data for the analytics dashboard (Task 23.2 / Req 24.4).
 *
 * Every method takes `teacherId` (the teacher's `User.id` /
 * `TeacherProfile.userId`) and constrains all reads to that teacher's
 * groups, courses, assignments, and invoices. The controller passes the
 * JWT subject for TEACHER callers and forwards the optional
 * `?teacherId=` query param when an ADMIN is inspecting a peer's
 * dashboard.
 *
 * The class composes a small set of independent Prisma queries with
 * `Promise.all` so each route stays a single round-trip even on
 * populated datasets.
 */
@Injectable()
export class TeacherAnalyticsService {
  private readonly logger = new Logger(TeacherAnalyticsService.name);

  constructor(private readonly prisma: PrismaClient) {}

  // ==================================================================
  // Overview KPIs
  // ==================================================================

  /**
   * Aggregate the headline KPIs for the teacher analytics dashboard.
   *
   * Eight independent indexed queries run in parallel — the heaviest
   * read (active-students-last-30d) is a `findMany` with `distinct` so
   * it stays bounded regardless of how many submissions the teacher's
   * students produce.
   */
  async getOverview(teacherId: string): Promise<TeacherAnalyticsOverview> {
    const last30d = new Date(Date.now() - 30 * MS_PER_DAY);

    const teacherGroupsFilter: Prisma.GroupWhereInput = {
      course: { teacherId },
    };

    const [
      distinctStudents,
      activeStudents,
      totalCourses,
      publishedCourses,
      totalGroups,
      activeGroups,
      revenueAgg,
    ] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          status: 'APPROVED',
          group: teacherGroupsFilter,
        },
        select: { studentId: true },
        distinct: ['studentId'],
      }),
      this.prisma.submission.findMany({
        where: {
          createdAt: { gte: last30d },
          assignment: {
            lesson: { group: teacherGroupsFilter },
          },
        },
        select: { studentId: true },
        distinct: ['studentId'],
      }),
      this.prisma.course.count({ where: { teacherId } }),
      this.prisma.course.count({ where: { teacherId, isPublished: true } }),
      this.prisma.group.count({ where: teacherGroupsFilter }),
      this.prisma.group.count({
        where: { ...teacherGroupsFilter, status: 'OPEN' },
      }),
      this.prisma.invoice.aggregate({
        where: {
          teacherId,
          status: 'PAID',
          paidAt: { gte: last30d },
        },
        _sum: { amountUzs: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalStudents: distinctStudents.length,
      activeStudents30d: activeStudents.length,
      totalCourses,
      publishedCourses,
      totalGroups,
      activeGroups,
      paidInvoicesLast30d: revenueAgg._count._all,
      revenueLast30dUzs: revenueAgg._sum.amountUzs ?? 0,
    };
  }

  // ==================================================================
  // Trend series — daily new enrollments and daily revenue
  // ==================================================================

  /**
   * Daily count of new APPROVED enrollments over the trailing
   * `days` window (default 30, clamped to [1, 365]).
   *
   * The bucket loop is precomputed so missing days return zero rather
   * than dropping out of the series.
   */
  async getEnrollmentTrend(
    teacherId: string,
    days = DEFAULT_TREND_DAYS,
  ): Promise<TeacherAnalyticsTrendPoint[]> {
    const window = this.clampTrendDays(days);
    const { from, to, buckets } = this.buildBuckets(window);

    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        status: 'APPROVED',
        approvedAt: { gte: from, lte: to },
        group: { course: { teacherId } },
      },
      select: { approvedAt: true },
    });

    for (const e of enrollments) {
      const key = this.toDateKey(e.approvedAt);
      const bucket = buckets.get(key);
      if (bucket) bucket.value += 1;
    }

    return this.serializeBuckets(buckets);
  }

  /**
   * Daily revenue (sum of paid invoice amounts) over the trailing
   * `days` window. Mirrors `getEnrollmentTrend` so the new dashboard
   * widget can share a single chart component.
   */
  async getRevenueTrend(
    teacherId: string,
    days = DEFAULT_TREND_DAYS,
  ): Promise<TeacherAnalyticsTrendPoint[]> {
    const window = this.clampTrendDays(days);
    const { from, to, buckets } = this.buildBuckets(window);

    const invoices = await this.prisma.invoice.findMany({
      where: {
        teacherId,
        status: 'PAID',
        paidAt: { gte: from, lte: to },
      },
      select: { amountUzs: true, paidAt: true },
    });

    for (const inv of invoices) {
      if (!inv.paidAt) continue;
      const key = this.toDateKey(inv.paidAt);
      const bucket = buckets.get(key);
      if (bucket) bucket.value += inv.amountUzs;
    }

    return this.serializeBuckets(buckets);
  }

  // ==================================================================
  // Top courses by enrollment
  // ==================================================================

  /**
   * Top N courses by APPROVED enrollment count. The implementation runs
   * `groupBy` over Enrollment narrowed to the teacher's courses, then
   * one `findMany` to hydrate course titles. N defaults to 5 to match
   * the dashboard widget.
   */
  async getTopCourses(
    teacherId: string,
    limit = TOP_COURSES_LIMIT,
  ): Promise<TeacherAnalyticsTopCourse[]> {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 25));

    // Pull every group with its courseId for the teacher — we need the
    // mapping to roll enrollment counts back up to the parent course.
    const groups = await this.prisma.group.findMany({
      where: { course: { teacherId } },
      select: { id: true, courseId: true },
    });
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);
    const groupToCourse = new Map(groups.map((g) => [g.id, g.courseId]));

    const enrollments = await this.prisma.enrollment.findMany({
      where: { status: 'APPROVED', groupId: { in: groupIds } },
      select: { groupId: true },
    });

    const counts = new Map<string, number>();
    for (const e of enrollments) {
      const courseId = groupToCourse.get(e.groupId);
      if (!courseId) continue;
      counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
    }

    if (counts.size === 0) return [];

    const courseIds = Array.from(counts.keys());
    const courses = await this.prisma.course.findMany({
      where: { id: { in: courseIds }, teacherId },
      select: { id: true, title: true, isPublished: true },
    });
    const courseMap = new Map(courses.map((c) => [c.id, c]));

    return Array.from(counts.entries())
      .map(([courseId, enrollmentsCount]) => {
        const course = courseMap.get(courseId);
        return {
          courseId,
          title: course?.title ?? 'Untitled course',
          enrollments: enrollmentsCount,
          isPublished: course?.isPublished ?? false,
        };
      })
      .sort((a, b) => b.enrollments - a.enrollments || a.title.localeCompare(b.title))
      .slice(0, safeLimit);
  }

  // ==================================================================
  // Homework status histogram
  // ==================================================================

  /**
   * Submission counts broken down by `SubmissionStatus`. The five keys
   * are always present (even when zero) so the dashboard donut renders
   * a stable order.
   */
  async getHomeworkStats(
    teacherId: string,
  ): Promise<TeacherAnalyticsHomeworkStats> {
    const grouped = await this.prisma.submission.groupBy({
      by: ['status'],
      where: {
        assignment: {
          lesson: { group: { course: { teacherId } } },
        },
      },
      _count: { _all: true },
    });

    const stats: TeacherAnalyticsHomeworkStats = {
      DRAFT: 0,
      SUBMITTED: 0,
      IN_REVIEW: 0,
      GRADED: 0,
      RETURNED: 0,
    };
    for (const row of grouped) {
      const key = row.status as TeacherHomeworkStatusKey;
      if (key in stats) {
        stats[key] = row._count._all;
      }
    }
    return stats;
  }

  // ==================================================================
  // Long-form revenue series (existing analytics page)
  // ==================================================================

  /**
   * Daily revenue series for the long-form Analitika page. Defaults to
   * the trailing 30 days when either bound is missing; clamps to a
   * 365-day window so the bucket loop stays bounded.
   *
   * Buckets are computed in UTC. The implementation reads every paid
   * invoice in the window with `findMany` and reduces in memory.
   */
  async getRevenueSeries(
    teacherId: string,
    range: { from?: Date; to?: Date } = {},
  ): Promise<TeacherAnalyticsRevenuePoint[]> {
    const to = range.to ? this.endOfDay(range.to) : this.endOfDay(new Date());
    const requestedFrom = range.from
      ? this.startOfDay(range.from)
      : this.startOfDay(
          new Date(to.getTime() - DEFAULT_REVENUE_WINDOW_DAYS * MS_PER_DAY),
        );
    const earliest = this.startOfDay(
      new Date(to.getTime() - MAX_REVENUE_WINDOW_DAYS * MS_PER_DAY),
    );
    const from =
      requestedFrom.getTime() < earliest.getTime() ? earliest : requestedFrom;

    const invoices = await this.prisma.invoice.findMany({
      where: {
        teacherId,
        status: 'PAID',
        paidAt: { gte: from, lte: to },
      },
      select: { amountUzs: true, paidAt: true },
    });

    const buckets = new Map<string, { paidInvoices: number; totalUzs: number }>();
    for (
      let cursor = from.getTime();
      cursor <= to.getTime();
      cursor += MS_PER_DAY
    ) {
      buckets.set(this.toDateKey(new Date(cursor)), {
        paidInvoices: 0,
        totalUzs: 0,
      });
    }

    for (const inv of invoices) {
      if (!inv.paidAt) continue;
      const key = this.toDateKey(inv.paidAt);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.paidInvoices += 1;
      bucket.totalUzs += inv.amountUzs;
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, agg]) => ({ date, ...agg }));
  }

  // ==================================================================
  // Per-student progress
  // ==================================================================

  /**
   * Per-student aggregates for the analytics table. Either narrows to a
   * specific group (`groupId`) or returns rows across every group the
   * teacher owns. Each row joins:
   *   - the User row for display (fullName, email),
   *   - the Group row (id + name) used as the grouping key,
   *   - lesson + submission aggregates.
   *
   * Aggregates are computed in JS over a constrained set of rows so the
   * service stays portable across SQLite-based unit tests and the prod
   * Postgres database. The (groupId, studentId) tuple is unique in
   * `Enrollment`, so the row count is at most students × groups.
   */
  async getStudentProgress(
    teacherId: string,
    options: { groupId?: string } = {},
  ): Promise<TeacherAnalyticsStudentRow[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        status: 'APPROVED',
        group: {
          course: { teacherId },
          ...(options.groupId && { id: options.groupId }),
        },
      },
      select: {
        id: true,
        studentId: true,
        groupId: true,
        approvedAt: true,
        student: {
          select: {
            user: {
              select: {
                fullName: true,
                email: true,
              },
            },
          },
        },
        group: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (enrollments.length === 0) return [];

    const groupIds = Array.from(new Set(enrollments.map((e) => e.groupId)));
    // N+1 fix (Task 24.2): replace one `count` per group with a single
    // groupBy that returns the READY-lesson count for every group at
    // once. Prevents the loop from issuing `groupIds.length` round-
    // trips at request time.
    const lessonCounts = new Map<string, number>();
    if (groupIds.length > 0) {
      const grouped = await this.prisma.lesson.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds }, status: 'READY' },
        _count: { _all: true },
      });
      for (const row of grouped) {
        lessonCounts.set(row.groupId, row._count._all);
      }
    }

    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId: { in: enrollments.map((e) => e.studentId) },
        assignment: {
          lesson: {
            group: {
              course: { teacherId },
              ...(options.groupId && { id: options.groupId }),
            },
          },
        },
      },
      select: {
        studentId: true,
        status: true,
        score: true,
        assignment: {
          select: {
            lesson: { select: { groupId: true } },
          },
        },
      },
    });

    interface ProgressBucket {
      submissionsCount: number;
      gradedScores: number[];
    }
    const progress = new Map<string, ProgressBucket>();
    for (const sub of submissions) {
      const groupId = sub.assignment.lesson.groupId;
      const key = `${sub.studentId}::${groupId}`;
      const bucket = progress.get(key) ?? {
        submissionsCount: 0,
        gradedScores: [],
      };
      bucket.submissionsCount += 1;
      if (sub.status === SubmissionStatus.GRADED && typeof sub.score === 'number') {
        bucket.gradedScores.push(sub.score);
      }
      progress.set(key, bucket);
    }

    return enrollments
      .map((e): TeacherAnalyticsStudentRow => {
        const key = `${e.studentId}::${e.groupId}`;
        const bucket = progress.get(key);
        const gradedScores = bucket?.gradedScores ?? [];
        const averageGrade =
          gradedScores.length === 0
            ? null
            : gradedScores.reduce((sum, s) => sum + s, 0) / gradedScores.length;
        return {
          studentId: e.studentId,
          fullName: e.student.user.fullName,
          email: e.student.user.email,
          groupId: e.groupId,
          groupName: e.group.name,
          enrolledAt: e.approvedAt,
          lessonsAccessed: lessonCounts.get(e.groupId) ?? 0,
          submissionsCount: bucket?.submissionsCount ?? 0,
          averageGrade,
        };
      })
      .sort((a, b) => {
        const cmpGroup = a.groupName.localeCompare(b.groupName);
        if (cmpGroup !== 0) return cmpGroup;
        const aName = a.fullName ?? a.email;
        const bName = b.fullName ?? b.email;
        return aName.localeCompare(bName);
      });
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private clampTrendDays(days: number): number {
    if (!Number.isFinite(days)) return DEFAULT_TREND_DAYS;
    const floored = Math.floor(days);
    if (floored < MIN_TREND_DAYS) return MIN_TREND_DAYS;
    if (floored > MAX_TREND_DAYS) return MAX_TREND_DAYS;
    return floored;
  }

  /**
   * Build a UTC `[from, to]` range plus an ordered map of empty buckets
   * keyed by `YYYY-MM-DD`. The window is inclusive of both endpoints —
   * `days = 30` produces 30 buckets ending on today.
   */
  private buildBuckets(days: number): {
    from: Date;
    to: Date;
    buckets: Map<string, TeacherAnalyticsTrendPoint>;
  } {
    const today = this.startOfDay(new Date());
    const to = this.endOfDay(today);
    const from = this.startOfDay(
      new Date(today.getTime() - (days - 1) * MS_PER_DAY),
    );
    const buckets = new Map<string, TeacherAnalyticsTrendPoint>();
    for (
      let cursor = from.getTime();
      cursor <= today.getTime();
      cursor += MS_PER_DAY
    ) {
      const key = this.toDateKey(new Date(cursor));
      buckets.set(key, { date: key, value: 0 });
    }
    return { from, to, buckets };
  }

  private serializeBuckets(
    buckets: Map<string, TeacherAnalyticsTrendPoint>,
  ): TeacherAnalyticsTrendPoint[] {
    return Array.from(buckets.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
  }

  private startOfDay(d: Date): Date {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
    );
  }

  private endOfDay(d: Date): Date {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
  }

  private toDateKey(d: Date): string {
    const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

// Re-export the homework key list so consumers (e.g. the dashboard
// donut) can iterate the canonical order without re-declaring it.
export const TEACHER_HOMEWORK_STATUSES = HOMEWORK_STATUS_KEYS;
