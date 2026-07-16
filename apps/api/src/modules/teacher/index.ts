export { TeacherModule } from './teacher.module';
export { OnboardingService } from './onboarding.service';
export type {
  OnboardingLocale,
  OnboardingQuestionDto,
  SubmitAnswersResult,
  CompleteOnboardingResult,
} from './onboarding.service';
export { ENGLISH_DASHBOARD_URL } from './onboarding.service';
export { SpecialtyService } from './specialty.service';
export {
  TeacherAnalyticsService,
  TEACHER_HOMEWORK_STATUSES,
  type TeacherAnalyticsOverview,
  type TeacherAnalyticsTrendPoint,
  type TeacherAnalyticsRevenuePoint,
  type TeacherAnalyticsTopCourse,
  type TeacherAnalyticsHomeworkStats,
  type TeacherHomeworkStatusKey,
  type TeacherAnalyticsStudentRow,
} from './teacher-analytics.service';
export { TeacherAnalyticsController } from './teacher-analytics.controller';
export { TeacherProfileRepository } from './repositories/teacher-profile.repository';
export { SubmitAnswersSchema, type SubmitAnswersDto } from './dto';
export {
  CompleteOnboardingSchema,
  type CompleteOnboardingDto,
} from './dto';
