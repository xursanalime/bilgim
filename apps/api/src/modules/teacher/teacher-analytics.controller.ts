import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  TeacherAnalyticsHomeworkStatsQueryDto,
  TeacherAnalyticsHomeworkStatsQuerySchema,
  TeacherAnalyticsOverviewQueryDto,
  TeacherAnalyticsOverviewQuerySchema,
  TeacherAnalyticsRevenueQueryDto,
  TeacherAnalyticsRevenueQuerySchema,
  TeacherAnalyticsStudentsQueryDto,
  TeacherAnalyticsStudentsQuerySchema,
  TeacherAnalyticsTopCoursesQueryDto,
  TeacherAnalyticsTopCoursesQuerySchema,
  TeacherAnalyticsTrendQueryDto,
  TeacherAnalyticsTrendQuerySchema,
} from './dto';
import {
  TeacherAnalyticsHomeworkStats,
  TeacherAnalyticsOverview,
  TeacherAnalyticsRevenuePoint,
  TeacherAnalyticsService,
  TeacherAnalyticsStudentRow,
  TeacherAnalyticsTopCourse,
  TeacherAnalyticsTrendPoint,
} from './teacher-analytics.service';

/**
 * TeacherAnalyticsController — analytics dashboard read endpoints (Task 23.2).
 *
 * Routes powering the dashboard widgets:
 *   - `/teacher/analytics/overview`              — KPI cards
 *   - `/teacher/analytics/enrollment-trend`      — daily new enrollments
 *   - `/teacher/analytics/revenue-trend`         — daily revenue
 *   - `/teacher/analytics/top-courses`           — top 5 by enrollments
 *   - `/teacher/analytics/homework-stats`        — counts by submission status
 *
 * Long-form analytics page (kept):
 *   - `/teacher/analytics/revenue?from&to`       — date-range revenue series
 *   - `/teacher/analytics/students?groupId?`     — per-student progress table
 *
 * Auth (Req 17.x):
 *   - All routes require `JwtAuthGuard` (the auth-completeness scanner
 *     requires the guard at the class level).
 *   - `@Roles('TEACHER', 'ADMIN')` allows admins to read any teacher's
 *     analytics for support / triage. Class-level decorator — every
 *     method needs the same role set.
 *
 * Teacher scoping:
 *   - For TEACHER callers the service is invoked with `user.sub`
 *     regardless of any `?teacherId=` query value.
 *   - For ADMIN callers the controller honors `?teacherId=` so support
 *     can read a specific teacher's dashboard.
 */
@Controller('teacher/analytics')
@UseGuards(JwtAuthGuard)
@Roles('TEACHER', 'ADMIN')
export class TeacherAnalyticsController {
  constructor(
    private readonly analyticsService: TeacherAnalyticsService,
  ) {}

  /** GET /teacher/analytics/overview — KPI cards. */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  async getOverview(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsOverviewQuerySchema))
    query: TeacherAnalyticsOverviewQueryDto,
  ): Promise<TeacherAnalyticsOverview> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    return this.analyticsService.getOverview(teacherId);
  }

  /** GET /teacher/analytics/enrollment-trend?days=30 */
  @Get('enrollment-trend')
  @HttpCode(HttpStatus.OK)
  async getEnrollmentTrend(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsTrendQuerySchema))
    query: TeacherAnalyticsTrendQueryDto,
  ): Promise<TeacherAnalyticsTrendPoint[]> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    return this.analyticsService.getEnrollmentTrend(teacherId, query.days);
  }

  /** GET /teacher/analytics/revenue-trend?days=30 */
  @Get('revenue-trend')
  @HttpCode(HttpStatus.OK)
  async getRevenueTrend(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsTrendQuerySchema))
    query: TeacherAnalyticsTrendQueryDto,
  ): Promise<TeacherAnalyticsTrendPoint[]> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    return this.analyticsService.getRevenueTrend(teacherId, query.days);
  }

  /** GET /teacher/analytics/top-courses?limit=5 */
  @Get('top-courses')
  @HttpCode(HttpStatus.OK)
  async getTopCourses(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsTopCoursesQuerySchema))
    query: TeacherAnalyticsTopCoursesQueryDto,
  ): Promise<TeacherAnalyticsTopCourse[]> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    return this.analyticsService.getTopCourses(teacherId, query.limit);
  }

  /** GET /teacher/analytics/homework-stats */
  @Get('homework-stats')
  @HttpCode(HttpStatus.OK)
  async getHomeworkStats(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsHomeworkStatsQuerySchema))
    query: TeacherAnalyticsHomeworkStatsQueryDto,
  ): Promise<TeacherAnalyticsHomeworkStats> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    return this.analyticsService.getHomeworkStats(teacherId);
  }

  /** GET /teacher/analytics/revenue?from&to — long-form daily series. */
  @Get('revenue')
  @HttpCode(HttpStatus.OK)
  async getRevenue(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsRevenueQuerySchema))
    query: TeacherAnalyticsRevenueQueryDto,
  ): Promise<TeacherAnalyticsRevenuePoint[]> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    const range: { from?: Date; to?: Date } = {};
    if (query.from) range.from = query.from;
    if (query.to) range.to = query.to;
    return this.analyticsService.getRevenueSeries(teacherId, range);
  }

  /** GET /teacher/analytics/students — per-student progress table. */
  @Get('students')
  @HttpCode(HttpStatus.OK)
  async getStudents(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherAnalyticsStudentsQuerySchema))
    query: TeacherAnalyticsStudentsQueryDto,
  ): Promise<TeacherAnalyticsStudentRow[]> {
    const teacherId = this.resolveTeacherId(user, query.teacherId);
    const opts: { groupId?: string } = {};
    if (query.groupId) opts.groupId = query.groupId;
    return this.analyticsService.getStudentProgress(teacherId, opts);
  }

  /**
   * TEACHER callers are pinned to their JWT subject; ADMIN callers may
   * pass `?teacherId=` to read another teacher's dashboard.
   */
  private resolveTeacherId(
    user: JwtPayload,
    queryTeacherId: string | undefined,
  ): string {
    if (user.role === 'ADMIN' && queryTeacherId) {
      return queryTeacherId;
    }
    return user.sub;
  }
}
