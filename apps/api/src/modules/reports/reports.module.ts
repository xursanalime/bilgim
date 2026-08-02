import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { AdminModule } from '../admin/admin.module';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsTeacherController } from './reports-teacher.controller';
import { ReportsService } from './reports.service';

/**
 * ReportsModule — admin / teacher data export and financial report
 * surface (Task 23.3, Req 24.5).
 *
 * Owns:
 *   - `ReportsAdminController` for admin-only endpoints
 *     (`GET /admin/reports/financial`,
 *      `GET /admin/exports/{invoices,users,audit-logs}.csv`).
 *   - `ReportsTeacherController` for the teacher-only
 *     `GET /teacher/exports/students.csv`.
 *   - `ReportsService` — financial-summary aggregation.
 *
 * Imports `AdminModule` to reuse `AdminAuditService` for the
 * `report.exported` audit-log entries written before each export
 * stream begins.
 *
 * Owns its own `PrismaClient` instance, matching the bounded-context
 * pattern used by every other module.
 */
@Module({
  imports: [AdminModule],
  controllers: [ReportsAdminController, ReportsTeacherController],
  providers: [
    ReportsService,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
