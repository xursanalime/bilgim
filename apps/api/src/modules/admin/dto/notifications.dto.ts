import { z } from 'zod';

/**
 * Query for `GET /admin/notifications/failed` (Task 23.1).
 *
 * Returns the rows that operations triage actually wants — failed or
 * stuck `NotificationDelivery` entries. By default the endpoint surfaces
 * `FAILED` rows; setting `includePendingRetry=true` also includes
 * `PENDING_RETRY` rows so the operator can spot deliveries that are
 * still backing off in BullMQ.
 *
 * Filters mirror the most common triage queries:
 *   - `channel` — narrow to a specific transport (e.g. `EMAIL` after a
 *     provider outage).
 *   - `from`/`to` — ISO 8601 date range over `updatedAt` (most recent
 *     state change), which is what operators care about.
 */
export const ListFailedDeliveriesQuerySchema = z
  .object({
    channel: z.enum(['EMAIL', 'TELEGRAM', 'PUSH', 'IN_APP']).optional(),
    includePendingRetry: z.coerce.boolean().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type ListFailedDeliveriesQueryDto = z.infer<
  typeof ListFailedDeliveriesQuerySchema
>;
