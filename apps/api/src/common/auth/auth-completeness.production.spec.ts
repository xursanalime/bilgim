import { Type } from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LessonAccessGuard } from '../guards/lesson-access.guard';
import { HealthController } from '../../health/health.controller';
import { AdminController } from '../../modules/admin/admin.controller';
import { AdminOpsController } from '../../modules/admin/admin-ops.controller';
import { AiController } from '../../modules/ai/ai.controller';
import { AiTextDetectController } from '../../modules/ai/ai-text-detect.controller';
import { TutorController } from '../../modules/ai/tutor.controller';
import { AuthController } from '../../modules/auth/auth.controller';
import { BillingController } from '../../modules/billing/billing.controller';
import { PaymeController } from '../../modules/billing/payme/payme.controller';
import { CoursesController } from '../../modules/catalog/courses.controller';
import { GroupsController } from '../../modules/catalog/groups.controller';
import { LessonsController } from '../../modules/catalog/lessons.controller';
import { DiscoveryController } from '../../modules/discovery/discovery.controller';
import { DmController } from '../../modules/dm/dm.controller';
import { EnrollmentController } from '../../modules/enrollment/enrollment.controller';
import { HomeworkController } from '../../modules/homework/homework.controller';
import { AssignmentsController } from '../../modules/homework/assignments.controller';
import { SubmissionsController } from '../../modules/homework/submissions.controller';
import { LiveController } from '../../modules/live/live.controller';
import { MediaController } from '../../modules/media/media.controller';
import { MediaAssetsController } from '../../modules/media/media-assets.controller';
import { MfaController } from '../../modules/mfa/mfa.controller';
import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { ReportsAdminController } from '../../modules/reports/reports-admin.controller';
import { ReportsTeacherController } from '../../modules/reports/reports-teacher.controller';
import { ScheduleController } from '../../modules/schedule/schedule.controller';
import { TeacherController } from '../../modules/teacher/teacher.controller';
import { TeacherAnalyticsController } from '../../modules/teacher/teacher-analytics.controller';
import { ThreatProtectionController } from '../../modules/threat-protection/threat-protection.controller';
import { inspectControllerClasses } from './auth-completeness';

/**
 * The full list of HTTP controllers wired into AppModule. New controllers
 * MUST be added here so they are exercised by the production-side
 * authorization-completeness check.
 */
const PRODUCTION_CONTROLLERS: Type<unknown>[] = [
  HealthController,
  AuthController,
  AdminController,
  AdminOpsController,
  AiController,
  TutorController,
  AiTextDetectController,
  BillingController,
  PaymeController,
  CoursesController,
  GroupsController,
  LessonsController,
  DiscoveryController,
  DmController,
  EnrollmentController,
  HomeworkController,
  AssignmentsController,
  SubmissionsController,
  LiveController,
  MediaController,
  MediaAssetsController,
  MfaController,
  NotificationsController,
  ReportsAdminController,
  ReportsTeacherController,
  ScheduleController,
  TeacherController,
  TeacherAnalyticsController,
  ThreatProtectionController,
];

describe('auth-completeness — production controllers (Req 17.1, 17.4, 17.5, 17.6)', () => {
  it('every production controller route is either @Public() or has JWT auth + @Roles', () => {
    const report = inspectControllerClasses(
      PRODUCTION_CONTROLLERS,
      [JwtAuthGuard],
      {
        authGuardNames: [LessonAccessGuard.name],
        requireRoles: true,
      },
    );

    // If this fails, the assertion below will print the offending routes
    // so the developer knows exactly which controller to fix.
    expect(report.missing).toEqual([]);
    expect(report.scanned).toBeGreaterThan(0);
  });
});
