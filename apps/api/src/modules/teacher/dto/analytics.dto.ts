import { z } from 'zod';

/**
 * DTOs for the teacher analytics endpoints (Task 23.2).
 *
 * Eight reads power the analytics surface:
 *   - `GET /teacher/analytics/overview`
 *   - `GET /teacher/analytics/enrollment-trend?days=30`
 *   - `GET /teacher/analytics/revenue-trend?days=30`
 *   - `GET /teacher/analytics/top-courses?limit=5`
 *   - `GET /teacher/analytics/homework-stats`
 *   - `GET /teacher/analytics/revenue?from&to`
 *   - `GET /teacher/analytics/students?groupId?`
 *
 * `teacherId` is OPTIONAL on every query: callers with role TEACHER are
 * scoped to their own JWT subject (the controller ignores any value
 * supplied in the query). ADMIN may pass `teacherId` to inspect a
 * specific teacher's analytics.
 */

export const TeacherAnalyticsOverviewQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
});
export type TeacherAnalyticsOverviewQueryDto = z.infer<
  typeof TeacherAnalyticsOverviewQuerySchema
>;

/**
 * Trend window query — `days` defaults to 30 when missing and is
 * clamped to [1, 365] in the service. Uses `coerce.number` so the value
 * can come in as a query string.
 */
export const TeacherAnalyticsTrendQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});
export type TeacherAnalyticsTrendQueryDto = z.infer<
  typeof TeacherAnalyticsTrendQuerySchema
>;

/** Top courses query — optional `limit` capped at 25 in the service. */
export const TeacherAnalyticsTopCoursesQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});
export type TeacherAnalyticsTopCoursesQueryDto = z.infer<
  typeof TeacherAnalyticsTopCoursesQuerySchema
>;

/** Homework stats has no extra knobs beyond the optional teacherId. */
export const TeacherAnalyticsHomeworkStatsQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
});
export type TeacherAnalyticsHomeworkStatsQueryDto = z.infer<
  typeof TeacherAnalyticsHomeworkStatsQuerySchema
>;

/**
 * Inclusive bounds for the daily revenue series. `from` defaults to 30
 * days before `to` if either side is omitted, computed in the service
 * so the DTO stays validation-only.
 */
export const TeacherAnalyticsRevenueQuerySchema = z
  .object({
    teacherId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from.getTime() <= q.to.getTime(),
    { message: 'from must be on or before to', path: ['from'] },
  );
export type TeacherAnalyticsRevenueQueryDto = z.infer<
  typeof TeacherAnalyticsRevenueQuerySchema
>;

/** Optional groupId narrows the per-student aggregate to a single group. */
export const TeacherAnalyticsStudentsQuerySchema = z.object({
  teacherId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
});
export type TeacherAnalyticsStudentsQueryDto = z.infer<
  typeof TeacherAnalyticsStudentsQuerySchema
>;
