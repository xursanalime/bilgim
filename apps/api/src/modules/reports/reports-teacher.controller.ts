import {
  Controller,
  Get,
  Ip,
  Res,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from '../admin/admin-audit.service';
import { JwtPayload } from '../auth/tokens.service';
import {
  TEACHER_STUDENT_CSV_COLUMNS,
  TeacherStudentExportRow,
} from './csv-columns';
import { streamCsv } from './csv-stream';
import { pipeCsvResponse } from './reports-admin.controller';
import { REPORT_PAGE_SIZE } from './reports.service';

/**
 * ReportsTeacherController — teacher-only CSV export of own students
 * (Task 23.3).
 *
 * Auth: every route is `@Roles('TEACHER')` and protected by
 * `JwtAuthGuard`. The teacher-id used to scope the query is taken from
 * the JWT, never from a query param, so a teacher cannot enumerate
 * other teachers' students.
 *
 * The audit-log entry uses the same `report.exported` action as the
 * admin exports — the actor is the teacher, target is the
 * report-type identifier, and the payload records the resolved
 * teacher/group context for forensic review.
 */
@Controller('teacher')
@UseGuards(JwtAuthGuard)
@Roles('TEACHER')
export class ReportsTeacherController {
  constructor(
    private readonly adminAuditService: AdminAuditService,
    private readonly prisma: PrismaClient,
  ) {}

  /**
   * GET /teacher/exports/students.csv — streamed CSV of every student
   * enrolled in any of the calling teacher's groups. Joins
   * Enrollment → Group → Course (filtered by teacherId) and pulls the
   * StudentProfile + User for the contact columns.
   */
  @Get('exports/students.csv')
  async exportOwnStudentsCsv(
    @CurrentUser() user: JwtPayload,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'teacher.students.csv',
      { teacherId: user.sub },
      { ip },
    );

    const stream = streamCsv(TEACHER_STUDENT_CSV_COLUMNS, async (page) => {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          group: { course: { teacherId: user.sub } },
        },
        orderBy: { approvedAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
        select: {
          studentId: true,
          status: true,
          approvedAt: true,
          group: {
            select: {
              id: true,
              name: true,
              courseId: true,
            },
          },
          student: {
            select: {
              user: {
                select: {
                  email: true,
                  fullName: true,
                  username: true,
                },
              },
            },
          },
        },
      });

      return enrollments.map<TeacherStudentExportRow>((e) => ({
        studentId: e.studentId,
        email: e.student?.user?.email ?? '',
        fullName: e.student?.user?.fullName ?? '',
        username: e.student?.user?.username ?? null,
        enrolledAt: e.approvedAt,
        groupId: e.group.id,
        groupName: e.group.name,
        courseId: e.group.courseId,
        status: e.status,
      }));
    });

    pipeCsvResponse(res, stream, 'students.csv');
  }
}
