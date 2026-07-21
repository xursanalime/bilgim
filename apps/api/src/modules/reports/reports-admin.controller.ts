import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Readable } from 'stream';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from '../admin/admin-audit.service';
import { JwtPayload } from '../auth/tokens.service';
import {
  AUDIT_LOG_CSV_COLUMNS,
  INVOICE_CSV_COLUMNS,
  PAYMENT_CSV_COLUMNS,
  TEACHER_CSV_COLUMNS,
  USER_CSV_COLUMNS,
  type PaymentExportRow,
  type TeacherExportRow,
} from './csv-columns';
import { streamCsv } from './csv-stream';
import {
  AuditLogExportQueryDto,
  AuditLogExportQuerySchema,
  FinancialReportQueryDto,
  FinancialReportQuerySchema,
  InvoiceExportQueryDto,
  InvoiceExportQuerySchema,
  PaymentExportQueryDto,
  PaymentExportQuerySchema,
  RevenueReportQueryDto,
  RevenueReportQuerySchema,
  TeacherExportQueryDto,
  TeacherExportQuerySchema,
  UserExportQueryDto,
  UserExportQuerySchema,
} from './dto';
import { REPORT_PAGE_SIZE, ReportsService } from './reports.service';

/**
 * ReportsAdminController — admin-only financial reports and CSV
 * exports (Task 23.3, Req 24.5).
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by
 * `JwtAuthGuard`. The TEACHER export lives on `ReportsTeacherController`
 * so the role boundary is enforced at the controller level — a TEACHER
 * JWT hitting `/admin/exports/*` is rejected by the global RolesGuard.
 *
 * Audit:
 *   - Every export records an `AdminAuditLog` entry with action
 *     `report.exported` BEFORE the response stream begins. Writing the
 *     audit row first means the log reflects intent even if the client
 *     drops the connection mid-download.
 *
 * Streaming:
 *   - CSV exporters use `streamCsv` with paged Prisma reads
 *     (`REPORT_PAGE_SIZE` rows per page) so the API never holds the
 *     whole table in memory.
 *   - Empty windows still emit the header row (Task 23.3 acceptance:
 *     "empty range returns headers-only CSV").
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class ReportsAdminController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly adminAuditService: AdminAuditService,
    private readonly prisma: PrismaClient,
  ) {}

  // ==================================================================
  // Financial summary
  // ==================================================================

  /**
   * GET /admin/reports/financial — aggregated financial summary
   * (Req 24.5).
   *
   * Returns per-period totalInvoicesUzs / paidUzs / refundedUzs and the
   * Payme transaction counts by state, plus the top-10 teachers by
   * revenue. The audit-log entry is written by
   * `ReportsService.financialSummaryWithAudit` after the read
   * succeeds.
   */
  @Get('reports/financial')
  @HttpCode(HttpStatus.OK)
  async financialSummary(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(FinancialReportQuerySchema))
    query: FinancialReportQueryDto,
    @Ip() ip: string,
  ) {
    return this.reportsService.financialSummaryWithAudit(user.sub, query, {
      ip,
    });
  }

  // ==================================================================
  // CSV exports
  // ==================================================================

  /** GET /admin/exports/invoices.csv — streamed invoices CSV. */
  @Get('exports/invoices.csv')
  async exportInvoicesCsv(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(InvoiceExportQuerySchema))
    query: InvoiceExportQueryDto,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    const { from, to } = this.reportsService.resolveRange(query.from, query.to);

    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'invoices.csv',
      { from: from.toISOString(), to: to.toISOString() },
      { ip },
    );

    const stream = streamCsv(INVOICE_CSV_COLUMNS, async (page) => {
      return this.prisma.invoice.findMany({
        where: { issuedAt: { gte: from, lte: to } },
        orderBy: { issuedAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
        select: {
          id: true,
          teacherId: true,
          studentId: true,
          kind: true,
          amountUzs: true,
          status: true,
          paidAt: true,
          paymeTxId: true,
        },
      });
    });

    pipeCsvResponse(res, stream, 'invoices.csv');
  }

  /** GET /admin/exports/users.csv — streamed users CSV (no secrets). */
  @Get('exports/users.csv')
  async exportUsersCsv(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(UserExportQuerySchema))
    query: UserExportQueryDto,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'users.csv',
      { role: query.role ?? null },
      { ip },
    );

    const stream = streamCsv(USER_CSV_COLUMNS, async (page) => {
      return this.prisma.user.findMany({
        where: {
          ...(query.role && { role: query.role }),
          status: { not: 'DELETED' },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
        // SELECT explicit columns — passwordHash and any other
        // sensitive field stays out of the projection by construction.
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          status: true,
          fullName: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    pipeCsvResponse(res, stream, 'users.csv');
  }

  /** GET /admin/exports/audit-logs.csv — streamed audit log CSV. */
  @Get('exports/audit-logs.csv')
  async exportAuditLogsCsv(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(AuditLogExportQuerySchema))
    query: AuditLogExportQueryDto,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    const { from, to } = this.reportsService.resolveRange(query.from, query.to);

    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'audit-logs.csv',
      { from: from.toISOString(), to: to.toISOString() },
      { ip },
    );

    const stream = streamCsv(AUDIT_LOG_CSV_COLUMNS, async (page) => {
      return this.prisma.adminAuditLog.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
      });
    });

    pipeCsvResponse(res, stream, 'audit-logs.csv');
  }

  /**
   * GET /admin/exports/payments.csv — streamed PaymeTransaction +
   * Invoice CSV (Task 23.3).
   *
   * Each row is one (PaymeTransaction, Invoice) pair so a payment that
   * settled multiple invoices yields multiple CSV rows. Teacher /
   * student emails are joined via the Invoice.teacherId /
   * Invoice.studentId references.
   *
   * Pagination iterates by `PaymeTransaction.id` page; for each page
   * we fan out the joined Invoices into separate rows. The result is
   * still bounded — one Payme tx settles a handful of invoices in the
   * worst case — so we never blow the page-size budget.
   */
  @Get('exports/payments.csv')
  async exportPaymentsCsv(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(PaymentExportQuerySchema))
    query: PaymentExportQueryDto,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    const { from, to } = this.reportsService.resolveRange(query.from, query.to);

    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'payments.csv',
      {
        from: from.toISOString(),
        to: to.toISOString(),
        state: query.state ?? null,
      },
      { ip },
    );

    const where = {
      createdAt: { gte: from, lte: to },
      ...(query.state && { state: query.state }),
    } as const;

    const stream = streamCsv(PAYMENT_CSV_COLUMNS, async (page) => {
      const txs = await this.prisma.paymeTransaction.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
        select: {
          paymeId: true,
          createdAt: true,
          amountUzs: true,
          state: true,
          invoices: {
            select: {
              kind: true,
              paidAt: true,
              teacherId: true,
              studentId: true,
              teacher: {
                select: { user: { select: { email: true } } },
              },
            },
          },
        },
      });

      // Resolve student emails in a single batched query — Invoice has
      // `studentId` but no direct `student` relation, so we look up the
      // User table directly to keep the join cheap.
      const studentIds = new Set<string>();
      for (const tx of txs) {
        for (const inv of tx.invoices) {
          if (inv.studentId) studentIds.add(inv.studentId);
        }
      }
      const studentEmailById = new Map<string, string>();
      if (studentIds.size > 0) {
        const students = await this.prisma.user.findMany({
          where: { id: { in: Array.from(studentIds) } },
          select: { id: true, email: true },
        });
        for (const s of students) studentEmailById.set(s.id, s.email);
      }

      const rows: PaymentExportRow[] = [];
      for (const tx of txs) {
        if (tx.invoices.length === 0) {
          // Standalone payment with no invoice yet (rare, but possible
          // for PENDING transactions). Emit a row anyway so the CSV
          // reflects the underlying tx.
          rows.push({
            paymeId: tx.paymeId,
            createdAt: tx.createdAt,
            amountUzs: tx.amountUzs,
            state: tx.state,
            invoiceKind: null,
            teacherEmail: null,
            studentEmail: null,
            paidAt: null,
          });
          continue;
        }
        for (const inv of tx.invoices) {
          rows.push({
            paymeId: tx.paymeId,
            createdAt: tx.createdAt,
            amountUzs: tx.amountUzs,
            state: tx.state,
            invoiceKind: inv.kind,
            teacherEmail: inv.teacher?.user?.email ?? null,
            studentEmail: inv.studentId
              ? studentEmailById.get(inv.studentId) ?? null
              : null,
            paidAt: inv.paidAt,
          });
        }
      }
      return rows;
    });

    pipeCsvResponse(res, stream, 'payments.csv');
  }

  /**
   * GET /admin/exports/teachers.csv — streamed teacher CSV with
   * subscription / onboarding state and total students (Task 23.3).
   */
  @Get('exports/teachers.csv')
  async exportTeachersCsv(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(TeacherExportQuerySchema))
    query: TeacherExportQueryDto,
    @Res() res: any,
    @Ip() ip: string,
  ): Promise<void> {
    await this.adminAuditService.log(
      user.sub,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'teachers.csv',
      { subscriptionStatus: query.subscriptionStatus ?? null },
      { ip },
    );

    const stream = streamCsv(TEACHER_CSV_COLUMNS, async (page) => {
      const teachers = await this.prisma.user.findMany({
        where: {
          role: 'TEACHER',
          status: { not: 'DELETED' },
          ...(query.subscriptionStatus && {
            teacherProfile: {
              subscriptions: {
                some: { status: query.subscriptionStatus },
              },
            },
          }),
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * REPORT_PAGE_SIZE,
        take: REPORT_PAGE_SIZE,
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          createdAt: true,
          teacherProfile: {
            select: {
              onboardingCompletedAt: true,
              fullName: true,
              studentsCount: true,
              subscriptions: {
                where: {
                  status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      });

      return teachers.map<TeacherExportRow>((t) => ({
        id: t.id,
        email: t.email,
        username: t.username,
        fullName: t.fullName ?? t.teacherProfile?.fullName ?? null,
        subscriptionStatus:
          t.teacherProfile?.subscriptions[0]?.status ?? null,
        onboardingCompletedAt:
          t.teacherProfile?.onboardingCompletedAt ?? null,
        totalStudents: t.teacherProfile?.studentsCount ?? 0,
        createdAt: t.createdAt,
      }));
    });

    pipeCsvResponse(res, stream, 'teachers.csv');
  }

  // ==================================================================
  // JSON reports (Task 23.3)
  // ==================================================================

  /**
   * GET /admin/reports/revenue — paid-revenue time-series bucketed by
   * day / week / month (Task 23.3, Req 24.5).
   */
  @Get('reports/revenue')
  @HttpCode(HttpStatus.OK)
  async revenueReport(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(RevenueReportQuerySchema))
    query: RevenueReportQueryDto,
    @Ip() ip: string,
  ) {
    return this.reportsService.revenueReportWithAudit(user.sub, query, { ip });
  }

  /**
   * GET /admin/reports/subscription-funnel — counts of subscription
   * rows by status (Task 23.3, Req 24.5).
   */
  @Get('reports/subscription-funnel')
  @HttpCode(HttpStatus.OK)
  async subscriptionFunnel(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.reportsService.subscriptionFunnelWithAudit(user.sub, { ip });
  }
}

/**
 * Minimal Express response surface we rely on. Defining this
 * structurally instead of importing `Response` from `express` keeps
 * the API package free of the missing `@types/express` declaration
 * (the platform-express runtime ships the real Response object, but
 * the type package is not in the dependency manifest).
 */
export interface CsvHttpResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): unknown;
  end(): unknown;
  headersSent: boolean;
  pipe?: never;
  // The PassThrough we pipe into is a Writable; `pipe` is invoked on
  // the source stream, not on the response. Express Response is a
  // Writable too, which is what `Readable.pipe` expects.
}

/**
 * Set the standard CSV download headers and pipe the stream into the
 * Express response. Exposed at module scope so both controllers (admin
 * + teacher) share the exact same boilerplate.
 */
export function pipeCsvResponse(
  res: any,
  stream: Readable,
  filename: string,
): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Disable any caching layer between the API and the admin browser —
  // exports are point-in-time snapshots.
  res.setHeader('Cache-Control', 'no-store');
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500);
    }
    res.end();
    // The HTTP layer already wrote partial bytes — log the failure so
    // ops can correlate it against client retries.
    // eslint-disable-next-line no-console
    console.error('CSV export stream error', err);
  });
  stream.pipe(res);
}
