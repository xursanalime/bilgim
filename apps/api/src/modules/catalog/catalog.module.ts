import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { BillingModule } from '../billing/billing.module';
import { TeacherModule } from '../teacher/teacher.module';
import { CatalogService } from './catalog.service';
import { AttachmentsController } from './attachments.controller';
import { CoursesController } from './courses.controller';
import { GroupsController } from './groups.controller';
import { LessonsController } from './lessons.controller';
import { CourseRepository } from './repositories/course.repository';
import { GroupRepository } from './repositories/group.repository';
import { GroupModuleRepository } from './repositories/group-module.repository';
import { LessonRepository } from './repositories/lesson.repository';

/**
 * CatalogModule — owns Course, Group, Lesson, Attachment, Schedule and
 * GroupModule lifecycles (Req 7.1 – 7.7, 6.1 – 6.6, 11.2).
 *
 * Imports:
 *   - BillingModule for `BillingService.requireActiveSubscription` (Req 3.8).
 *   - TeacherModule for `TeacherProfileRepository` and `SpecialtyService`,
 *     used to seed `GroupModule` rows from the teacher's specialty catalog.
 *
 * Owns its own PrismaClient instance (same pattern as other modules).
 */
@Module({
  imports: [ConfigModule, BillingModule, TeacherModule],
  controllers: [CoursesController, GroupsController, LessonsController, AttachmentsController],
  providers: [
    CatalogService,
    CourseRepository,
    GroupRepository,
    GroupModuleRepository,
    LessonRepository,
    LessonAccessGuard,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    CatalogService,
    CourseRepository,
    GroupRepository,
    GroupModuleRepository,
    LessonRepository,
  ],
})
export class CatalogModule {}
