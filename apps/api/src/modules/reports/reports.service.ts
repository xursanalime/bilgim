import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from '../admin/admin-audit.service';
import {
  FinancialReportQueryDto,
  RevenueReportQueryDto,
  defaultReportRange,
} from './dto';

/** Page size used by every CSV exporter. */
export const REPORT_PAGE_SIZE = 500;

/** Public projection of one bucket in the financial summary. */
export interface FinancialPeriodBucket {
  /** ISO 8601 truncated to the start of the period (UTC). */
  period: string;
  /** Sum of `Invoice.amountUzs` across all invoices in the period. */
  totalInvoicesUzs: number;
  /** Sum of `Invoice.amountUzs` for invoices in PAID status. */
  paidUzs: number;
  /** Sum of `Invoice.amountUzs` for invoices in REFUNDED status. */
  refundedUzs: number;
  /** Number of `PaymeTransaction` rows by `state` in the period. */
  paymeTransactions: Record<string, number>;
}

export interface FinancialReportTopTeacher {
  teacherId: string;
  /** Total revenue (sum of paid invoices) attributed to this teacher. */
  paidUzs: number;
  /** Number of paid invoices. */
  paidCount: number;
}

export interface FinancialReport {
  from: Date;
  to: Date;
  groupBy: 'day' | 'week' | 'month';
  periods: FinancialPeriodBucket[];
  topTeachers: FinancialReportTopTeacher[];
}

/** Single bucket in `/admin/reports/revenue`. */
export interface RevenueBucket {
  period: string;
  paidUzs: number;
  paidCount: number;
}

/** Public shape returned by `/admin/reports/revenue`. */
export interface RevenueReport {
  from: Date;
  to: Date;
  groupBy: 'day' | 'week' | 'month';
  periods: RevenueBucket[];
  totalPaidUzs: number;
}

/** Public shape returned by `/admin/reports/subscription-funnel`. */
export interface SubscriptionFunnelReport {
  /** Map of `SubscriptionStatus` → row count. Always includes every status. */
  counts: {
    TRIAL: number;
    ACTIVE: number;
    PAST_DUE: number;
    CANCELED: number;
    EXPIRED: number;
  };
  /** Total subscription rows considered. Equals the sum of `counts`. */
  total: number;
}

interface InvoiceAggRow {
  status: string;
  amountUzs: number | bigint | Prisma.Decimal | null;
  /** Field used to bucket the invoice — paidAt for PAID, else issuedAt. */
  bucketAt: Date;
  teacherId: string | null;
}

interface PaymeAggRow {
  state: string;
  createdAt: Date;
}

/**
 * ReportsService — financial summary aggregator for the admin
 * dashboards (Task 23.3, Req 24.5).
 *
 * The implementation deliberately runs the aggregation in JS rather
 * than in SQL `GROUP BY`. Reasons:
 *   - The dataset is small at the platform's current scale (invoices in
 *     the low thousands per month). The hot endpoints are admin-only
 *     and called rarely enough that fetching the rows once and folding
 *     them in memory is well within latency budget.
 *   - Bucketing by week/month with calendar-correct boundaries (UTC
 *     ISO weeks, month start) is awkward across PostgreSQL versions
 *     and far easier to reason about — and unit-test — in TS.
 *   - The bucket logic is now also unit-testable without a database.
 *
 * If the row count grows past the in-memory comfort zone, the same
 * service surface can be re-implemented with `date_trunc`-driven SQL
 * without changing callers.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  /**
   * Compute and return the financial summary for the requested window.
   *
   * Steps:
   *   1. Resolve `[from, to]` (default: last 30 days).
   *   2. Pull the relevant Invoice + PaymeTransaction rows in
   *      parallel; project only the columns the aggregator needs.
   *   3. Bucket invoices by period using the chosen `groupBy`.
   *   4. Tally PaymeTransaction counts by state per period.
   *   5. Compute top-10 teachers by paid revenue across the window.
   *
   * The audit-log entry is written by the controller (`report.exported`)
   * after this method returns successfully.
   */
  async financialSummary(
    query: FinancialReportQueryDto,
  ): Promise<FinancialReport> {
    const { from, to } = this.resolveRange(query.from, query.to);
    const groupBy = query.groupBy;

    const [invoices, paymeTxs] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          OR: [
            { paidAt: { gte: from, lte: to } },
            // Include not-yet-paid invoices issued in the window so the
            // "totalInvoicesUzs" reflects activity, not just settled
            // money. Filtering by issuedAt here is safe — paid invoices
            // are still counted via paidAt below.
            { paidAt: null, issuedAt: { gte: from, lte: to } },
          ],
        },
        select: {
          status: true,
          amountUzs: true,
          paidAt: true,
          issuedAt: true,
          teacherId: true,
        },
      }),
      this.prisma.paymeTransaction.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { state: true, createdAt: true },
      }),
    ]);

    const invoiceRows: InvoiceAggRow[] = invoices.map((inv) => ({
      status: inv.status,
      amountUzs: inv.amountUzs as number,
      bucketAt: inv.paidAt ?? inv.issuedAt,
      teacherId: inv.teacherId,
    }));
    const paymeRows: PaymeAggRow[] = paymeTxs.map((p) => ({
      state: p.state,
      createdAt: p.createdAt,
    }));

    const periods = this.bucketize(invoiceRows, paymeRows, from, to, groupBy);
    const topTeachers = this.topTeachersByRevenue(invoiceRows, 10);

    return { from, to, groupBy, periods, topTeachers };
  }

  /**
   * Wrapper that writes the `report.exported` audit row after the
   * report is computed. Splitting the read-only `financialSummary`
   * path from the audit-writing path keeps unit-testing easy.
   */
  async financialSummaryWithAudit(
    actorId: string,
    query: FinancialReportQueryDto,
    context: { ip?: string | null } = {},
  ): Promise<FinancialReport> {
    const report = await this.financialSummary(query);
    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'financial-summary',
      {
        from: report.from.toISOString(),
        to: report.to.toISOString(),
        groupBy: report.groupBy,
        periodCount: report.periods.length,
        topTeacherCount: report.topTeachers.length,
      },
      { ip: context.ip ?? null },
    );
    return report;
  }

  /**
   * Resolve the `[from, to]` window, applying the 30-day default for
   * any omitted endpoint. Exposed publicly so controllers can record
   * the resolved window in audit-log payloads.
   */
  resolveRange(from?: Date, to?: Date): { from: Date; to: Date } {
    if (from && to) return { from, to };
    const fallback = defaultReportRange();
    return {
      from: from ?? fallback.from,
      to: to ?? fallback.to,
    };
  }

  // ------------------------------------------------------------------
  // Revenue time-series (Task 23.3)
  // ------------------------------------------------------------------

  /**
   * Compute paid-revenue time-series for `/admin/reports/revenue`.
   *
   * Differs from `financialSummary` in two ways:
   *   - Only PAID invoices are included (Task 23.3: "paid invoices
   *     only"). Refunds and pending invoices stay out of the series.
   *   - The output drops PaymeTransaction state counts and refunds —
   *     dashboards reading this endpoint want the lean revenue chart.
   *
   * Bucket boundaries reuse `periodKey` so day/week/month semantics
   * stay consistent across the two endpoints.
   */
  async revenueReport(query: RevenueReportQueryDto): Promise<RevenueReport> {
    const { from, to } = this.resolveRange(query.from, query.to);
    const groupBy = query.groupBy;

    const invoices = await this.prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: from, lte: to } },
      select: { amountUzs: true, paidAt: true },
    });

    const buckets = new Map<string, RevenueBucket>();
    let totalPaidUzs = 0;
    for (const inv of invoices) {
      // PAID rows always have a paidAt — guard anyway so a malformed
      // row never crashes the aggregator.
      if (!inv.paidAt) continue;
      const key = this.periodKey(inv.paidAt, groupBy);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { period: key, paidUzs: 0, paidCount: 0 };
        buckets.set(key, bucket);
      }
      const amount = toNumber(inv.amountUzs);
      bucket.paidUzs += amount;
      bucket.paidCount += 1;
      totalPaidUzs += amount;
    }

    const periods = Array.from(buckets.values()).sort((a, b) =>
      a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
    );

    return { from, to, groupBy, periods, totalPaidUzs };
  }

  /**
   * Wrapper that writes a `report.exported` audit row after the
   * revenue report is computed.
   */
  async revenueReportWithAudit(
    actorId: string,
    query: RevenueReportQueryDto,
    context: { ip?: string | null } = {},
  ): Promise<RevenueReport> {
    const report = await this.revenueReport(query);
    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'revenue',
      {
        from: report.from.toISOString(),
        to: report.to.toISOString(),
        groupBy: report.groupBy,
        periodCount: report.periods.length,
        totalPaidUzs: report.totalPaidUzs,
      },
      { ip: context.ip ?? null },
    );
    return report;
  }

  // ------------------------------------------------------------------
  // Subscription funnel (Task 23.3)
  // ------------------------------------------------------------------

  /**
   * Compute the per-status subscription funnel.
   *
   * Implemented as a single `groupBy` query so the response is one
   * round-trip regardless of how many subscriptions exist. Statuses
   * with zero rows are still returned with `0` so the dashboard
   * doesn't have to fill gaps client-side.
   */
  async subscriptionFunnel(): Promise<SubscriptionFunnelReport> {
    const grouped = await this.prisma.subscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const counts = {
      TRIAL: 0,
      ACTIVE: 0,
      PAST_DUE: 0,
      CANCELED: 0,
      EXPIRED: 0,
    };
    for (const row of grouped) {
      const status = row.status as keyof typeof counts;
      if (status in counts) {
        counts[status] = row._count._all;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { counts, total };
  }

  /**
   * Wrapper that writes a `report.exported` audit row after the
   * subscription-funnel snapshot is computed.
   */
  async subscriptionFunnelWithAudit(
    actorId: string,
    context: { ip?: string | null } = {},
  ): Promise<SubscriptionFunnelReport> {
    const report = await this.subscriptionFunnel();
    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.REPORT_EXPORTED,
      'subscription-funnel',
      { total: report.total },
      { ip: context.ip ?? null },
    );
    return report;
  }

  // ------------------------------------------------------------------
  // Aggregation helpers
  // ------------------------------------------------------------------

  /** Truncate a date to the start of the period (UTC). */
  private periodKey(date: Date, groupBy: 'day' | 'week' | 'month'): string {
    const d = new Date(date.getTime());
    if (groupBy === 'month') {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
    }
    if (groupBy === 'week') {
      // ISO-week-ish: anchor to the Monday at 00:00 UTC. We don't need
      // ISO 8601 week numbers — only stable, sortable bucket keys.
      const day = d.getUTCDay();
      // Sunday = 0 → 6 days back to Monday; otherwise (day - 1) days.
      const offset = day === 0 ? 6 : day - 1;
      const monday = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset),
      );
      return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(
        monday.getUTCDate(),
      )}`;
    }
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  /** Materialize per-period buckets with stable ordering by `period`. */
  private bucketize(
    invoices: InvoiceAggRow[],
    paymeRows: PaymeAggRow[],
    _from: Date,
    _to: Date,
    groupBy: 'day' | 'week' | 'month',
  ): FinancialPeriodBucket[] {
    const buckets = new Map<string, FinancialPeriodBucket>();

    const ensure = (key: string): FinancialPeriodBucket => {
      let b = buckets.get(key);
      if (!b) {
        b = {
          period: key,
          totalInvoicesUzs: 0,
          paidUzs: 0,
          refundedUzs: 0,
          paymeTransactions: {},
        };
        buckets.set(key, b);
      }
      return b;
    };

    for (const inv of invoices) {
      const key = this.periodKey(inv.bucketAt, groupBy);
      const bucket = ensure(key);
      const amount = toNumber(inv.amountUzs);
      bucket.totalInvoicesUzs += amount;
      if (inv.status === 'PAID') bucket.paidUzs += amount;
      else if (inv.status === 'REFUNDED') bucket.refundedUzs += amount;
    }

    for (const tx of paymeRows) {
      const key = this.periodKey(tx.createdAt, groupBy);
      const bucket = ensure(key);
      bucket.paymeTransactions[tx.state] =
        (bucket.paymeTransactions[tx.state] ?? 0) + 1;
    }

    return Array.from(buckets.values()).sort((a, b) =>
      a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
    );
  }

  /** Top-N teachers by paid revenue across the window. */
  private topTeachersByRevenue(
    invoices: InvoiceAggRow[],
    n: number,
  ): FinancialReportTopTeacher[] {
    const totals = new Map<string, FinancialReportTopTeacher>();
    for (const inv of invoices) {
      if (inv.status !== 'PAID' || !inv.teacherId) continue;
      const existing = totals.get(inv.teacherId) ?? {
        teacherId: inv.teacherId,
        paidUzs: 0,
        paidCount: 0,
      };
      existing.paidUzs += toNumber(inv.amountUzs);
      existing.paidCount += 1;
      totals.set(inv.teacherId, existing);
    }
    return Array.from(totals.values())
      .sort((a, b) => b.paidUzs - a.paidUzs)
      .slice(0, n);
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toNumber(value: number | bigint | Prisma.Decimal | null): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  // Prisma Decimal — `.toNumber()` exists on the runtime class.
  const maybeToNumber = (value as { toNumber?: () => number }).toNumber;
  if (typeof maybeToNumber === 'function') return maybeToNumber.call(value);
  return Number(value);
}
