import { PassThrough } from 'stream';

import { AdminAuditService, AUDIT_ACTIONS } from '../admin/admin-audit.service';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsService } from './reports.service';

const ADMIN_USER = { sub: '00000000-0000-0000-0000-0000000000aa' } as any;

/**
 * Lightweight fake of the Express response object — we only care about
 * the headers and the chunks the CSV stream pipes into it.
 */
function buildResponse() {
  const headers: Record<string, string> = {};
  // PassThrough doubles as the writable target for `stream.pipe(res)`.
  // We tack on the express-flavoured `setHeader` / `status` methods so
  // the controller call site is happy.
  const passthrough = new PassThrough();
  const chunks: Buffer[] = [];
  passthrough.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

  const res: any = passthrough;
  res.headersSent = false;
  res.setHeader = jest.fn((name: string, value: string) => {
    headers[name] = value;
  });
  res.status = jest.fn(function (this: any) {
    return this;
  });

  return {
    res,
    headers,
    waitForBody: async () => {
      await new Promise<void>((resolve, reject) => {
        passthrough.once('finish', () => resolve());
        passthrough.once('end', () => resolve());
        passthrough.once('error', reject);
      });
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

function buildController() {
  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AdminAuditService>;
  const reportsService = {
    resolveRange: jest.fn().mockImplementation((from?: Date, to?: Date) => ({
      from: from ?? new Date('2024-06-01T00:00:00Z'),
      to: to ?? new Date('2024-06-30T00:00:00Z'),
    })),
    financialSummaryWithAudit: jest.fn().mockResolvedValue({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
      periods: [],
      topTeachers: [],
    }),
    revenueReportWithAudit: jest.fn().mockResolvedValue({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
      periods: [],
      totalPaidUzs: 0,
    }),
    subscriptionFunnelWithAudit: jest.fn().mockResolvedValue({
      counts: {
        TRIAL: 0,
        ACTIVE: 0,
        PAST_DUE: 0,
        CANCELED: 0,
        EXPIRED: 0,
      },
      total: 0,
    }),
  } as unknown as jest.Mocked<ReportsService>;
  const prisma = {
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    adminAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
    paymeTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const controller = new ReportsAdminController(
    reportsService,
    auditService,
    prisma,
  );
  return { controller, auditService, reportsService, prisma };
}

describe('ReportsAdminController — CSV exports (Task 23.3)', () => {
  // ------------------------------------------------------------------
  // /admin/exports/invoices.csv
  // ------------------------------------------------------------------

  describe('GET /admin/exports/invoices.csv', () => {
    it('writes the audit log BEFORE streaming and returns the documented header row', async () => {
      const { controller, auditService, prisma } = buildController();
      // Prisma calls happen lazily inside the page-provider; ensure
      // that the audit log is recorded before the first findMany call.
      const callOrder: string[] = [];
      auditService.log.mockImplementation(async () => {
        callOrder.push('audit');
      });
      prisma.invoice.findMany.mockImplementation(async () => {
        callOrder.push('findMany');
        return [];
      });

      const { res, waitForBody } = buildResponse();
      const from = new Date('2024-06-01T00:00:00Z');
      const to = new Date('2024-06-30T00:00:00Z');
      await controller.exportInvoicesCsv(
        ADMIN_USER,
        { from, to },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'id,teacherId,studentId,kind,amount,status,paidAt,paymeId\r\n',
      );
      // Audit log row is recorded before the first DB read.
      expect(callOrder[0]).toBe('audit');
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        AUDIT_ACTIONS.REPORT_EXPORTED,
        'invoices.csv',
        expect.objectContaining({
          from: '2024-06-01T00:00:00.000Z',
          to: '2024-06-30T00:00:00.000Z',
        }),
        { ip: '127.0.0.1' },
      );
      // Standard CSV download headers are set.
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="invoices.csv"',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('streams data rows after the header when invoices exist', async () => {
      const { controller, prisma } = buildController();
      prisma.invoice.findMany
        .mockResolvedValueOnce([
          {
            id: 'inv-1',
            teacherId: 't-1',
            studentId: 's-1',
            kind: 'STUDENT_COURSE',
            amountUzs: 100_000,
            status: 'PAID',
            paidAt: new Date('2024-06-15T08:00:00Z'),
            paymeTxId: 'pay-1',
          },
        ])
        .mockResolvedValueOnce([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportInvoicesCsv(
        ADMIN_USER,
        {
          from: new Date('2024-06-01T00:00:00Z'),
          to: new Date('2024-06-30T00:00:00Z'),
        },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      const lines = body.split('\r\n');
      expect(lines[0]).toBe(
        'id,teacherId,studentId,kind,amount,status,paidAt,paymeId',
      );
      expect(lines[1]).toBe(
        'inv-1,t-1,s-1,STUDENT_COURSE,100000,PAID,2024-06-15T08:00:00.000Z,pay-1',
      );
    });

    it('emits headers-only CSV when the date range matches no invoices', async () => {
      const { controller, prisma } = buildController();
      prisma.invoice.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportInvoicesCsv(
        ADMIN_USER,
        { from: new Date('2099-01-01T00:00:00Z'), to: new Date('2099-12-31T00:00:00Z') },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'id,teacherId,studentId,kind,amount,status,paidAt,paymeId\r\n',
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/exports/users.csv
  // ------------------------------------------------------------------

  describe('GET /admin/exports/users.csv', () => {
    it('uses an explicit projection that excludes passwordHash and other secrets', async () => {
      const { controller, prisma } = buildController();
      prisma.user.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportUsersCsv(
        ADMIN_USER,
        { role: 'TEACHER' },
        res,
        '127.0.0.1',
      );
      await waitForBody();

      const call = prisma.user.findMany.mock.calls[0][0];
      // role narrowed via Prisma where clause.
      expect(call.where).toEqual({
        role: 'TEACHER',
        status: { not: 'DELETED' },
      });
      // Projection excludes anything credential-related.
      expect(call.select).toBeDefined();
      expect(call.select.passwordHash).toBeUndefined();
      expect(call.select.refreshTokenHash).toBeUndefined();
      expect(Object.keys(call.select).sort()).toEqual(
        [
          'createdAt',
          'email',
          'fullName',
          'id',
          'locale',
          'role',
          'status',
          'updatedAt',
          'username',
        ].sort(),
      );
    });

    it('writes a report.exported audit row with the role filter as payload', async () => {
      const { controller, auditService, prisma } = buildController();
      prisma.user.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportUsersCsv(
        ADMIN_USER,
        { role: 'STUDENT' },
        res,
        '127.0.0.1',
      );
      const body = await waitForBody();

      expect(body).toBe(
        'id,email,username,role,status,fullName,locale,createdAt,updatedAt\r\n',
      );
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        AUDIT_ACTIONS.REPORT_EXPORTED,
        'users.csv',
        { role: 'STUDENT' },
        { ip: '127.0.0.1' },
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/exports/audit-logs.csv
  // ------------------------------------------------------------------

  describe('GET /admin/exports/audit-logs.csv', () => {
    it('returns the documented audit-log header row and records the export', async () => {
      const { controller, auditService, prisma } = buildController();
      prisma.adminAuditLog.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportAuditLogsCsv(
        ADMIN_USER,
        {
          from: new Date('2024-06-01T00:00:00Z'),
          to: new Date('2024-06-30T00:00:00Z'),
        },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'id,createdAt,actorId,action,target,ip,payload\r\n',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        AUDIT_ACTIONS.REPORT_EXPORTED,
        'audit-logs.csv',
        expect.objectContaining({
          from: '2024-06-01T00:00:00.000Z',
          to: '2024-06-30T00:00:00.000Z',
        }),
        { ip: '127.0.0.1' },
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/reports/financial
  // ------------------------------------------------------------------

  describe('GET /admin/reports/financial', () => {
    it('delegates to ReportsService.financialSummaryWithAudit', async () => {
      const { controller, reportsService } = buildController();
      const result = await controller.financialSummary(
        ADMIN_USER,
        { groupBy: 'week' },
        '127.0.0.1',
      );

      expect(reportsService.financialSummaryWithAudit).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        { groupBy: 'week' },
        { ip: '127.0.0.1' },
      );
      expect(result).toEqual(
        expect.objectContaining({
          periods: [],
          topTeachers: [],
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/exports/payments.csv
  // ------------------------------------------------------------------

  describe('GET /admin/exports/payments.csv', () => {
    it('writes the audit log BEFORE streaming and returns the documented header row', async () => {
      const { controller, auditService, prisma } = buildController();
      const callOrder: string[] = [];
      auditService.log.mockImplementation(async () => {
        callOrder.push('audit');
      });
      prisma.paymeTransaction.findMany.mockImplementation(async () => {
        callOrder.push('findMany');
        return [];
      });

      const { res, waitForBody } = buildResponse();
      const from = new Date('2024-06-01T00:00:00Z');
      const to = new Date('2024-06-30T00:00:00Z');
      await controller.exportPaymentsCsv(
        ADMIN_USER,
        { from, to, state: 'PAID' },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'paymeId,createdAt,amountUzs,state,invoiceKind,teacherEmail,studentEmail,paidAt\r\n',
      );
      expect(callOrder[0]).toBe('audit');
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        AUDIT_ACTIONS.REPORT_EXPORTED,
        'payments.csv',
        expect.objectContaining({
          from: '2024-06-01T00:00:00.000Z',
          to: '2024-06-30T00:00:00.000Z',
          state: 'PAID',
        }),
        { ip: '127.0.0.1' },
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="payments.csv"',
      );
    });

    it('flattens (transaction, invoice) pairs, joins teacher and student emails', async () => {
      const { controller, prisma } = buildController();
      prisma.paymeTransaction.findMany
        .mockResolvedValueOnce([
          {
            paymeId: 'pid-1',
            createdAt: new Date('2024-06-15T08:00:00Z'),
            amountUzs: 100_000,
            state: 'PAID',
            invoices: [
              {
                kind: 'STUDENT_COURSE',
                paidAt: new Date('2024-06-15T08:01:00Z'),
                teacherId: 't-1',
                studentId: 's-1',
                teacher: { user: { email: 'teacher@example.com' } },
              },
            ],
          },
        ])
        .mockResolvedValueOnce([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 's-1', email: 'student@example.com' },
      ]);

      const { res, waitForBody } = buildResponse();
      await controller.exportPaymentsCsv(
        ADMIN_USER,
        {
          from: new Date('2024-06-01T00:00:00Z'),
          to: new Date('2024-06-30T00:00:00Z'),
        },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      const lines = body.split('\r\n');
      expect(lines[0]).toBe(
        'paymeId,createdAt,amountUzs,state,invoiceKind,teacherEmail,studentEmail,paidAt',
      );
      expect(lines[1]).toBe(
        'pid-1,2024-06-15T08:00:00.000Z,100000,PAID,STUDENT_COURSE,teacher@example.com,student@example.com,2024-06-15T08:01:00.000Z',
      );
      // Student email lookup batches via the User table.
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['s-1'] } },
        select: { id: true, email: true },
      });
    });

    it('emits a row even when a PaymeTransaction has no invoices yet', async () => {
      const { controller, prisma } = buildController();
      prisma.paymeTransaction.findMany
        .mockResolvedValueOnce([
          {
            paymeId: 'pid-orphan',
            createdAt: new Date('2024-06-15T08:00:00Z'),
            amountUzs: 100_000,
            state: 'PENDING',
            invoices: [],
          },
        ])
        .mockResolvedValueOnce([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportPaymentsCsv(
        ADMIN_USER,
        {
          from: new Date('2024-06-01T00:00:00Z'),
          to: new Date('2024-06-30T00:00:00Z'),
        },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      const lines = body.split('\r\n');
      expect(lines[1]).toBe(
        'pid-orphan,2024-06-15T08:00:00.000Z,100000,PENDING,,,,',
      );
    });

    it('emits headers-only CSV when the date range matches no transactions', async () => {
      const { controller, prisma } = buildController();
      prisma.paymeTransaction.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportPaymentsCsv(
        ADMIN_USER,
        {
          from: new Date('2099-01-01T00:00:00Z'),
          to: new Date('2099-12-31T00:00:00Z'),
        },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'paymeId,createdAt,amountUzs,state,invoiceKind,teacherEmail,studentEmail,paidAt\r\n',
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/exports/teachers.csv
  // ------------------------------------------------------------------

  describe('GET /admin/exports/teachers.csv', () => {
    it('returns the documented header row and records the export', async () => {
      const { controller, auditService, prisma } = buildController();
      prisma.user.findMany.mockResolvedValue([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportTeachersCsv(
        ADMIN_USER,
        { subscriptionStatus: 'ACTIVE' },
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      expect(body).toBe(
        'id,email,username,fullName,subscriptionStatus,onboardingCompletedAt,totalStudents,createdAt\r\n',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        AUDIT_ACTIONS.REPORT_EXPORTED,
        'teachers.csv',
        { subscriptionStatus: 'ACTIVE' },
        { ip: '127.0.0.1' },
      );
      // Filter must narrow on TEACHER role and exclude soft-deleted rows.
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.role).toBe('TEACHER');
      expect(where.status).toEqual({ not: 'DELETED' });
      expect(where.teacherProfile).toEqual({
        subscriptions: { some: { status: 'ACTIVE' } },
      });
    });

    it('flattens TeacherProfile + latest non-terminal subscription into the row', async () => {
      const { controller, prisma } = buildController();
      prisma.user.findMany
        .mockResolvedValueOnce([
          {
            id: 't-1',
            email: 'teacher@example.com',
            username: 'tcr',
            fullName: 'Teacher One',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            teacherProfile: {
              onboardingCompletedAt: new Date('2024-02-01T00:00:00Z'),
              fullName: null,
              studentsCount: 7,
              subscriptions: [{ status: 'PAST_DUE' }],
            },
          },
        ])
        .mockResolvedValueOnce([]);

      const { res, waitForBody } = buildResponse();
      await controller.exportTeachersCsv(
        ADMIN_USER,
        {},
        res,
        '127.0.0.1',
      );

      const body = await waitForBody();
      const lines = body.split('\r\n');
      expect(lines[1]).toBe(
        't-1,teacher@example.com,tcr,Teacher One,PAST_DUE,2024-02-01T00:00:00.000Z,7,2024-01-01T00:00:00.000Z',
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/reports/revenue
  // ------------------------------------------------------------------

  describe('GET /admin/reports/revenue', () => {
    it('delegates to ReportsService.revenueReportWithAudit', async () => {
      const { controller, reportsService } = buildController();
      const result = await controller.revenueReport(
        ADMIN_USER,
        { groupBy: 'month' },
        '127.0.0.1',
      );

      expect(reportsService.revenueReportWithAudit).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        { groupBy: 'month' },
        { ip: '127.0.0.1' },
      );
      expect(result).toEqual(
        expect.objectContaining({
          periods: [],
          totalPaidUzs: 0,
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // /admin/reports/subscription-funnel
  // ------------------------------------------------------------------

  describe('GET /admin/reports/subscription-funnel', () => {
    it('delegates to ReportsService.subscriptionFunnelWithAudit', async () => {
      const { controller, reportsService } = buildController();
      const result = await controller.subscriptionFunnel(
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(reportsService.subscriptionFunnelWithAudit).toHaveBeenCalledWith(
        ADMIN_USER.sub,
        { ip: '127.0.0.1' },
      );
      expect(result).toEqual(
        expect.objectContaining({
          counts: {
            TRIAL: 0,
            ACTIVE: 0,
            PAST_DUE: 0,
            CANCELED: 0,
            EXPIRED: 0,
          },
          total: 0,
        }),
      );
    });
  });
});
