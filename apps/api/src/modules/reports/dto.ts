import { z } from 'zod';

/**
 * Default lookback window applied when `from` / `to` are omitted on the
 * report endpoints (Task 23.3: "Apply date range with sensible defaults
 * (last 30 days when omitted)").
 */
export const DEFAULT_REPORT_WINDOW_DAYS = 30;

/**
 * Compute the default `[from, to]` pair: now − 30d → now.
 *
 * Exposed as a function (not a const) so each call gets a fresh `Date`
 * — important for tests that use `jest.useFakeTimers`.
 */
export function defaultReportRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_REPORT_WINDOW_DAYS * 24 * 60 * 60_000);
  return { from, to };
}

/**
 * Query for `GET /admin/reports/financial` (Task 23.3).
 *
 * Filters:
 *   - `from`/`to` — ISO 8601 date range over Invoice.paidAt / .issuedAt.
 *     Both default to the last 30 days when omitted.
 *   - `groupBy`   — `day | week | month`. Defaults to `day` because
 *     dashboards typically render the most recent month at daily
 *     resolution.
 */
export const FinancialReportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type FinancialReportQueryDto = z.infer<typeof FinancialReportQuerySchema>;

/**
 * Query for `GET /admin/exports/invoices.csv` (Task 23.3).
 *
 * `from` / `to` default to the last 30 days. The CSV is streamed page
 * by page so the response stays bounded regardless of the chosen
 * window.
 */
export const InvoiceExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type InvoiceExportQueryDto = z.infer<typeof InvoiceExportQuerySchema>;

/**
 * Query for `GET /admin/exports/users.csv`.
 *
 * `role` filter is optional — when absent every non-deleted user is
 * exported. The exporter never emits `passwordHash`, refresh-token or
 * any credential field; see `users.csv` columns in the controller.
 */
export const UserExportQuerySchema = z.object({
  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']).optional(),
});

export type UserExportQueryDto = z.infer<typeof UserExportQuerySchema>;

/**
 * Query for `GET /admin/exports/audit-logs.csv` (Task 23.3).
 *
 * Same `from` / `to` semantics as the other admin export endpoints.
 */
export const AuditLogExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type AuditLogExportQueryDto = z.infer<typeof AuditLogExportQuerySchema>;

/**
 * Query for `GET /admin/exports/payments.csv` (Task 23.3).
 *
 * Streamed CSV of `PaymeTransaction` rows joined with their `Invoice`(s).
 * The CSV row shape is one record per (PaymeTransaction, Invoice) pair —
 * a single payment can settle more than one invoice (rare, but the
 * schema allows it), and flattening keeps positional parsing reliable.
 *
 * Filters:
 *   - `from` / `to` — ISO 8601 range over `PaymeTransaction.createdAt`,
 *     defaulting to the last 30 days when omitted.
 *   - `state` — exact match on `PaymeTransaction.state`. Uses the
 *     `(state, createdAt)` index.
 */
export const PaymentExportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    state: z
      .enum(['PENDING', 'CREATED', 'PAID', 'CANCELED', 'CANCELED_AFTER_PAY'])
      .optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type PaymentExportQueryDto = z.infer<typeof PaymentExportQuerySchema>;

/**
 * Query for `GET /admin/exports/teachers.csv` (Task 23.3).
 *
 * Streamed CSV of teacher accounts joined with the latest non-terminal
 * `Subscription` and the cached `studentsCount`. The optional
 * `subscriptionStatus` narrows the result to a single funnel stage —
 * useful for dunning workflows (PAST_DUE) or onboarding triage (TRIAL).
 */
export const TeacherExportQuerySchema = z.object({
  subscriptionStatus: z
    .enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'])
    .optional(),
});

export type TeacherExportQueryDto = z.infer<typeof TeacherExportQuerySchema>;

/**
 * Query for `GET /admin/reports/revenue` (Task 23.3).
 *
 * JSON time-series of paid revenue, bucketed by `day | week | month`.
 * Differs from `/admin/reports/financial` (which surfaces totals,
 * refunds and Payme tx state counts) — `revenue` returns the lean
 * series the dashboard needs for its main chart.
 *
 * Defaults: 30-day window, daily buckets.
 */
export const RevenueReportQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type RevenueReportQueryDto = z.infer<typeof RevenueReportQuerySchema>;
