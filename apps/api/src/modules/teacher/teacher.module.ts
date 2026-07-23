import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { AuthModule } from '../auth/auth.module';
import { TeacherController } from './teacher.controller';
import { TeacherAnalyticsController } from './teacher-analytics.controller';
import { TeacherPreviewController } from './public-preview.controller';
import { OnboardingService } from './onboarding.service';
import { SpecialtyService } from './specialty.service';
import { TeacherAnalyticsService } from './teacher-analytics.service';
import { TeacherPublicProfileService } from './public-profile.service';
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
  imports: [
    forwardRef(() => AuthModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        // Task 6 "Ko'rib chiqish" preview tokens — signed with the same
        // secret as auth JWTs but carry a `purpose` claim so they can
        // never be mistaken for an access token (see public-profile.service.ts).
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [TeacherController, TeacherAnalyticsController, TeacherPreviewController],
  providers: [
    OnboardingService,
    SpecialtyService,
    TeacherAnalyticsService,
    TeacherPublicProfileService,
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
    TeacherPublicProfileService,
    TeacherProfileRepository,
  ],
})
export class TeacherModule {}
