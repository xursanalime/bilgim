import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from '../admin/admin-audit.service';
import { ReportsService } from './reports.service';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000aa';

function buildPrisma(): any {
  return {
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    paymeTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

function buildAudit(): jest.Mocked<AdminAuditService> {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

describe('ReportsService — financial summary aggregation (Task 23.3, Req 24.5)', () => {
  let prisma: any;
  let audit: jest.Mocked<AdminAuditService>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = buildPrisma();
    audit = buildAudit();
    service = new ReportsService(prisma, audit);
  });

  // ------------------------------------------------------------------
  // Default range
  // ------------------------------------------------------------------

  it('defaults to a 30-day window when from/to are omitted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-06-30T12:00:00Z'));

    await service.financialSummary({ groupBy: 'day' });

    const call = prisma.invoice.findMany.mock.calls[0][0];
    const orFilter = call.where.OR;
    expect(orFilter).toHaveLength(2);
    const paidAtBound = orFilter[0].paidAt;
    expect(paidAtBound.gte).toEqual(new Date('2024-05-31T12:00:00Z'));
    expect(paidAtBound.lte).toEqual(new Date('2024-06-30T12:00:00Z'));

    jest.useRealTimers();
  });

  it('passes explicit from/to through verbatim', async () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date('2024-01-31T23:59:59Z');

    await service.financialSummary({ from, to, groupBy: 'day' });

    const call = prisma.invoice.findMany.mock.calls[0][0];
    expect(call.where.OR[0].paidAt).toEqual({ gte: from, lte: to });
    expect(prisma.paymeTransaction.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: from,
      lte: to,
    });
  });

  // ------------------------------------------------------------------
  // Bucketing
  // ------------------------------------------------------------------

  it('aggregates totals per day with paid/refunded splits', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      // June 1 — one paid, one refunded, one pending
      {
        status: 'PAID',
        amountUzs: 100_000,
        paidAt: new Date('2024-06-01T08:00:00Z'),
        issuedAt: new Date('2024-06-01T07:00:00Z'),
        teacherId: 't1',
      },
      {
        status: 'REFUNDED',
        amountUzs: 50_000,
        paidAt: new Date('2024-06-01T10:00:00Z'),
        issuedAt: new Date('2024-06-01T09:00:00Z'),
        teacherId: 't2',
      },
      {
        status: 'PENDING',
        amountUzs: 25_000,
        paidAt: null,
        issuedAt: new Date('2024-06-01T11:00:00Z'),
        teacherId: 't1',
      },
      // June 2 — single paid invoice, falls into a separate bucket
      {
        status: 'PAID',
        amountUzs: 200_000,
        paidAt: new Date('2024-06-02T15:00:00Z'),
        issuedAt: new Date('2024-06-02T14:00:00Z'),
        teacherId: 't1',
      },
    ]);
    prisma.paymeTransaction.findMany.mockResolvedValue([
      { state: 'PAID', createdAt: new Date('2024-06-01T08:00:00Z') },
      { state: 'PAID', createdAt: new Date('2024-06-01T08:30:00Z') },
      { state: 'CANCELED', createdAt: new Date('2024-06-01T09:00:00Z') },
      { state: 'PAID', createdAt: new Date('2024-06-02T15:00:00Z') },
    ]);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    expect(report.periods).toHaveLength(2);
    const [june1, june2] = report.periods;

    expect(june1!.period).toBe('2024-06-01');
    expect(june1!.totalInvoicesUzs).toBe(175_000); // 100 + 50 + 25
    expect(june1!.paidUzs).toBe(100_000);
    expect(june1!.refundedUzs).toBe(50_000);
    expect(june1!.paymeTransactions).toEqual({ PAID: 2, CANCELED: 1 });

    expect(june2!.period).toBe('2024-06-02');
    expect(june2!.totalInvoicesUzs).toBe(200_000);
    expect(june2!.paidUzs).toBe(200_000);
    expect(june2!.refundedUzs).toBe(0);
    expect(june2!.paymeTransactions).toEqual({ PAID: 1 });
  });

  it('buckets weekly to the Monday-of-week (UTC) when groupBy=week', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      // 2024-06-12 is a Wednesday — bucket = 2024-06-10 (Monday).
      {
        status: 'PAID',
        amountUzs: 50_000,
        paidAt: new Date('2024-06-12T10:00:00Z'),
        issuedAt: new Date('2024-06-12T10:00:00Z'),
        teacherId: 't1',
      },
      // 2024-06-09 is a Sunday — same week bucket = 2024-06-03 (prev Monday).
      {
        status: 'PAID',
        amountUzs: 100_000,
        paidAt: new Date('2024-06-09T22:00:00Z'),
        issuedAt: new Date('2024-06-09T22:00:00Z'),
        teacherId: 't2',
      },
    ]);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'week',
    });

    const periodKeys = report.periods.map((p) => p.period);
    expect(periodKeys).toContain('2024-06-10');
    expect(periodKeys).toContain('2024-06-03');
  });

  it('buckets monthly to the first-of-month when groupBy=month', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        status: 'PAID',
        amountUzs: 100_000,
        paidAt: new Date('2024-06-15T10:00:00Z'),
        issuedAt: new Date('2024-06-15T10:00:00Z'),
        teacherId: 't1',
      },
      {
        status: 'PAID',
        amountUzs: 50_000,
        paidAt: new Date('2024-07-02T10:00:00Z'),
        issuedAt: new Date('2024-07-02T10:00:00Z'),
        teacherId: 't1',
      },
    ]);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-07-31T00:00:00Z'),
      groupBy: 'month',
    });

    const periodKeys = report.periods.map((p) => p.period);
    expect(periodKeys).toEqual(['2024-06-01', '2024-07-01']);
  });

  // ------------------------------------------------------------------
  // Top teachers
  // ------------------------------------------------------------------

  it('computes top teachers by paid revenue (descending) and caps at 10', async () => {
    // 12 teachers, each with a single paid invoice of varying amounts.
    const invoices = Array.from({ length: 12 }, (_, i) => ({
      status: 'PAID',
      amountUzs: (i + 1) * 10_000,
      paidAt: new Date('2024-06-01T08:00:00Z'),
      issuedAt: new Date('2024-06-01T07:00:00Z'),
      teacherId: `teacher-${i}`,
    }));
    // Plus one refunded invoice that should NOT show up in topTeachers.
    invoices.push({
      status: 'REFUNDED',
      amountUzs: 1_000_000,
      paidAt: new Date('2024-06-01T08:00:00Z'),
      issuedAt: new Date('2024-06-01T07:00:00Z'),
      teacherId: 'refund-teacher',
    });
    prisma.invoice.findMany.mockResolvedValue(invoices);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    expect(report.topTeachers).toHaveLength(10);
    expect(report.topTeachers[0]).toEqual({
      teacherId: 'teacher-11',
      paidUzs: 120_000,
      paidCount: 1,
    });
    expect(
      report.topTeachers.some((t) => t.teacherId === 'refund-teacher'),
    ).toBe(false);
  });

  it('sums invoices per teacher across multiple paid invoices', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        status: 'PAID',
        amountUzs: 100_000,
        paidAt: new Date('2024-06-01T08:00:00Z'),
        issuedAt: new Date('2024-06-01T07:00:00Z'),
        teacherId: 't1',
      },
      {
        status: 'PAID',
        amountUzs: 200_000,
        paidAt: new Date('2024-06-02T08:00:00Z'),
        issuedAt: new Date('2024-06-02T07:00:00Z'),
        teacherId: 't1',
      },
      {
        status: 'PAID',
        amountUzs: 50_000,
        paidAt: new Date('2024-06-03T08:00:00Z'),
        issuedAt: new Date('2024-06-03T07:00:00Z'),
        teacherId: 't2',
      },
    ]);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    expect(report.topTeachers[0]).toEqual({
      teacherId: 't1',
      paidUzs: 300_000,
      paidCount: 2,
    });
    expect(report.topTeachers[1]).toEqual({
      teacherId: 't2',
      paidUzs: 50_000,
      paidCount: 1,
    });
  });

  // ------------------------------------------------------------------
  // Empty / audit
  // ------------------------------------------------------------------

  it('returns empty periods + empty topTeachers when no rows exist', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.paymeTransaction.findMany.mockResolvedValue([]);

    const report = await service.financialSummary({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    expect(report.periods).toEqual([]);
    expect(report.topTeachers).toEqual([]);
  });

  it('writes a single report.exported audit row when financialSummaryWithAudit is called', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.paymeTransaction.findMany.mockResolvedValue([]);

    await service.financialSummaryWithAudit(
      ADMIN_ID,
      {
        from: new Date('2024-06-01T00:00:00Z'),
        to: new Date('2024-06-30T00:00:00Z'),
        groupBy: 'day',
      },
      { ip: '10.0.0.1' },
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      ADMIN_ID,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'financial-summary',
      expect.objectContaining({
        from: '2024-06-01T00:00:00.000Z',
        to: '2024-06-30T00:00:00.000Z',
        groupBy: 'day',
      }),
      { ip: '10.0.0.1' },
    );
  });
});

// ====================================================================
// Revenue time-series — Task 23.3
// ====================================================================

describe('ReportsService — revenue time-series (Task 23.3)', () => {
  let prisma: any;
  let audit: jest.Mocked<AdminAuditService>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = buildPrisma();
    audit = buildAudit();
    service = new ReportsService(prisma, audit);
  });

  it('only includes PAID invoices and bucketizes by day with totals', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      {
        amountUzs: 100_000,
        paidAt: new Date('2024-06-01T08:00:00Z'),
      },
      {
        amountUzs: 50_000,
        paidAt: new Date('2024-06-01T10:00:00Z'),
      },
      {
        amountUzs: 200_000,
        paidAt: new Date('2024-06-02T15:00:00Z'),
      },
    ]);

    const report = await service.revenueReport({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    // Filter MUST narrow to status=PAID — refunds and pending invoices
    // are out of scope for the revenue chart.
    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PAID');
    expect(report.periods).toHaveLength(2);
    expect(report.periods[0]).toEqual({
      period: '2024-06-01',
      paidUzs: 150_000,
      paidCount: 2,
    });
    expect(report.periods[1]).toEqual({
      period: '2024-06-02',
      paidUzs: 200_000,
      paidCount: 1,
    });
    expect(report.totalPaidUzs).toBe(350_000);
  });

  it('returns empty periods + 0 total when nothing was paid', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    const report = await service.revenueReport({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'day',
    });

    expect(report.periods).toEqual([]);
    expect(report.totalPaidUzs).toBe(0);
  });

  it('buckets weekly to the Monday-of-week (UTC) when groupBy=week', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      // 2024-06-12 Wed → bucket 2024-06-10 (Mon)
      { amountUzs: 50_000, paidAt: new Date('2024-06-12T10:00:00Z') },
      // 2024-06-09 Sun → bucket 2024-06-03 (prev Mon)
      { amountUzs: 100_000, paidAt: new Date('2024-06-09T22:00:00Z') },
    ]);

    const report = await service.revenueReport({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-30T00:00:00Z'),
      groupBy: 'week',
    });

    const periodKeys = report.periods.map((p) => p.period);
    expect(periodKeys).toContain('2024-06-10');
    expect(periodKeys).toContain('2024-06-03');
    expect(report.totalPaidUzs).toBe(150_000);
  });

  it('buckets monthly to the first-of-month when groupBy=month', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { amountUzs: 100_000, paidAt: new Date('2024-06-15T10:00:00Z') },
      { amountUzs: 50_000, paidAt: new Date('2024-07-02T10:00:00Z') },
    ]);

    const report = await service.revenueReport({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-07-31T00:00:00Z'),
      groupBy: 'month',
    });

    expect(report.periods.map((p) => p.period)).toEqual([
      '2024-06-01',
      '2024-07-01',
    ]);
  });

  it('writes a report.exported audit row via revenueReportWithAudit', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.revenueReportWithAudit(
      ADMIN_ID,
      {
        from: new Date('2024-06-01T00:00:00Z'),
        to: new Date('2024-06-30T00:00:00Z'),
        groupBy: 'day',
      },
      { ip: '10.0.0.1' },
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      ADMIN_ID,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'revenue',
      expect.objectContaining({
        groupBy: 'day',
        totalPaidUzs: 0,
      }),
      { ip: '10.0.0.1' },
    );
  });
});

// ====================================================================
// Subscription funnel — Task 23.3
// ====================================================================

describe('ReportsService — subscription funnel (Task 23.3)', () => {
  let prisma: any;
  let audit: jest.Mocked<AdminAuditService>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = buildPrisma();
    audit = buildAudit();
    service = new ReportsService(prisma, audit);
  });

  it('returns counts for every status with 0 default and total = sum', async () => {
    prisma.subscription.groupBy.mockResolvedValue([
      { status: 'TRIAL', _count: { _all: 5 } },
      { status: 'ACTIVE', _count: { _all: 12 } },
      { status: 'CANCELED', _count: { _all: 2 } },
    ]);

    const report = await service.subscriptionFunnel();

    expect(prisma.subscription.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: { _all: true },
    });
    expect(report.counts).toEqual({
      TRIAL: 5,
      ACTIVE: 12,
      PAST_DUE: 0,
      CANCELED: 2,
      EXPIRED: 0,
    });
    expect(report.total).toBe(19);
  });

  it('writes a report.exported audit row via subscriptionFunnelWithAudit', async () => {
    prisma.subscription.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 7 } },
    ]);

    const report = await service.subscriptionFunnelWithAudit(ADMIN_ID, {
      ip: '10.0.0.1',
    });

    expect(report.total).toBe(7);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      ADMIN_ID,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'subscription-funnel',
      { total: 7 },
      { ip: '10.0.0.1' },
    );
  });
});
