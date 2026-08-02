/**
 * Teacher Analytics API client — wraps the NestJS `/teacher/analytics/*`
 * endpoints used by the teacher dashboard analytics widgets and the
 * standalone Analitika page (Task 23.2).
 */

import { apiClient } from '../api-client';

// ─── Overview ──────────────────────────────────────────────────────────

export interface TeacherAnalyticsOverview {
  totalStudents: number;
  activeStudents30d: number;
  totalCourses: number;
  publishedCourses: number;
  totalGroups: number;
  activeGroups: number;
  paidInvoicesLast30d: number;
  revenueLast30dUzs: number;
}

// ─── Trend points (enrollment + revenue) ───────────────────────────────

export interface TeacherAnalyticsTrendPoint {
  /** ISO date `YYYY-MM-DD` (UTC midnight). */
  date: string;
  /** Series value — count for enrollments, UZS amount for revenue. */
  value: number;
}

// ─── Top courses ───────────────────────────────────────────────────────

export interface TeacherAnalyticsTopCourse {
  courseId: string;
  title: string;
  enrollments: number;
  isPublished: boolean;
}

// ─── Homework status histogram ─────────────────────────────────────────

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

export const TEACHER_HOMEWORK_STATUSES: TeacherHomeworkStatusKey[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'GRADED',
  'RETURNED',
];

// ─── Long-form analytics page (existing) ───────────────────────────────

export interface TeacherAnalyticsRevenuePoint {
  date: string;
  paidInvoices: number;
  totalUzs: number;
}

export interface TeacherAnalyticsStudentRow {
  studentId: string;
  fullName: string | null;
  email: string;
  groupId: string;
  groupName: string;
  enrolledAt: string;
  lessonsAccessed: number;
  submissionsCount: number;
  averageGrade: number | null;
  paymentStatus: 'PAID' | 'PENDING' | 'NONE';
}

export interface RevenueRangeQuery {
  from?: string;
  to?: string;
}

// ─── Client ────────────────────────────────────────────────────────────

export const teacherAnalyticsApi = {
  /** GET /teacher/analytics/overview — dashboard KPI cards. */
  overview() {
    return apiClient.get<TeacherAnalyticsOverview>(
      '/teacher/analytics/overview',
    );
  },

  /** GET /teacher/analytics/enrollment-trend?days=30 */
  enrollmentTrend(days = 30) {
    return apiClient.get<TeacherAnalyticsTrendPoint[]>(
      '/teacher/analytics/enrollment-trend',
      { params: { days } },
    );
  },

  /** GET /teacher/analytics/revenue-trend?days=30 */
  revenueTrend(days = 30) {
    return apiClient.get<TeacherAnalyticsTrendPoint[]>(
      '/teacher/analytics/revenue-trend',
      { params: { days } },
    );
  },

  /** GET /teacher/analytics/top-courses?limit=5 */
  topCourses(limit = 5) {
    return apiClient.get<TeacherAnalyticsTopCourse[]>(
      '/teacher/analytics/top-courses',
      { params: { limit } },
    );
  },

  /** GET /teacher/analytics/homework-stats */
  homeworkStats() {
    return apiClient.get<TeacherAnalyticsHomeworkStats>(
      '/teacher/analytics/homework-stats',
    );
  },

  /** GET /teacher/analytics/revenue?from&to — long-form daily series. */
  revenue(range: RevenueRangeQuery = {}) {
    return apiClient.get<TeacherAnalyticsRevenuePoint[]>(
      '/teacher/analytics/revenue',
      {
        params: {
          from: range.from,
          to: range.to,
        },
      },
    );
  },

  /** GET /teacher/analytics/students?groupId? — per-student progress table. */
  students(groupId?: string) {
    return apiClient.get<TeacherAnalyticsStudentRow[]>(
      '/teacher/analytics/students',
      {
        params: { groupId },
      },
    );
  },
};
