import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { EnrollmentController } from './enrollment.controller';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentRepository } from './repositories/enrollment.repository';
import { InviteLinkRepository } from './repositories/invite-link.repository';

/**
 * EnrollmentModule — owns InviteLink, EnrollmentRequest, Enrollment.
 *
 * Provides:
 *  - EnrollmentService — invite link, approval, rejection flows.
 *  - LessonAccessGuard — enrollment-gated lesson access (Req 6.1 – 6.6).
 *    Exported so the Catalog module can attach it to lesson routes
 *    in Task 7.
 *
 * Owns its own PrismaClient instance (same pattern as Auth/Billing). The
 * OutboxService comes from the global `OutboxModule`.
 */
@Module({
  imports: [ConfigModule],
  controllers: [EnrollmentController],
  providers: [
    EnrollmentService,
    EnrollmentRepository,
    InviteLinkRepository,
    LessonAccessGuard,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    EnrollmentService,
    EnrollmentRepository,
    InviteLinkRepository,
    LessonAccessGuard,
  ],
})
export class EnrollmentModule {}
