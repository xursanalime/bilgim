import { z } from 'zod';

/**
 * Query for `GET /admin/payments` (Task 23.1).
 *
 * The endpoint joins `PaymeTransaction` with the related `Invoice`(s) so
 * a single page response is enough for an ops triage UI (status of the
 * Payme tx + the invoice it was meant to settle).
 *
 * Filters:
 *   - `state` — exact match on `PaymeTransaction.state` (uses the
 *     `(state, createdAt)` index).
 *   - `invoiceStatus` — coarse string filter against the joined
 *     `Invoice.status` (PAID, PENDING, CANCELED, …).
 *   - `kind` — coarse filter on `Invoice.kind`
 *     (`STUDENT_COURSE`, `TEACHER_SUBSCRIPTION`).
 *   - `from`/`to` — ISO 8601 date range over `PaymeTransaction.createdAt`.
 *
 * Pagination is page-based; the `(state, createdAt)` index keeps page-N
 * reads cheap.
 */
export const ListPaymentsQuerySchema = z
  .object({
    state: z
      .enum(['PENDING', 'CREATED', 'PAID', 'CANCELED', 'CANCELED_AFTER_PAY'])
      .optional(),
    invoiceStatus: z
      .enum(['PENDING', 'PAID', 'CANCELED', 'REFUNDED'])
      .optional(),
    kind: z.enum(['STUDENT_COURSE', 'TEACHER_SUBSCRIPTION']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type ListPaymentsQueryDto = z.infer<typeof ListPaymentsQuerySchema>;
