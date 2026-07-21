import { Module, forwardRef } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { AuthModule } from '../auth/auth.module';
import { TeacherController } from './teacher.controller';
import { TeacherAnalyticsController } from './teacher-analytics.controller';
import { OnboardingService } from './onboarding.service';
import { SpecialtyService } from './specialty.service';
import { TeacherAnalyticsService } from './teacher-analytics.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';

/**
 * TeacherModule — handles teacher onboarding, specialty assignment, the
 * TeacherProfile lifecycle (Requirements 2.2, 2.3, 2.4, 2.5) and the
 * teacher analytics dashboard read endpoints (Task 23.2 / Req 24.4).
 *
 * Depends on AuthModule for read-only access to the User table via
 * `UsersRepository` (full name + locale lookup). All write access to User
 * remains inside AuthModule.
 *
 * Uses `forwardRef` because the import graph
 * AuthModule → AdminModule → HomeworkModule → TeacherModule → AuthModule
 * is cyclic. NestJS would otherwise see one of the modules as
 * `undefined` during boot.
 *
 * Exports OnboardingService, SpecialtyService, and the TeacherProfile
 * repository so future modules (e.g. BillingModule for trial creation,
 * CatalogModule for group seeding) can call them without re-implementing
 * the lookup logic.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [TeacherController, TeacherAnalyticsController],
  providers: [
    OnboardingService,
    SpecialtyService,
    TeacherAnalyticsService,
    TeacherProfileRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    OnboardingService,
    SpecialtyService,
    TeacherAnalyticsService,
    TeacherProfileRepository,
  ],
})
export class TeacherModule {}
