import { z } from 'zod';

/**
 * Query for `GET /admin/outbox/pending` (Task 23.1).
 *
 * Operations needs a quick view of `OutboxEvent` rows that are still
 * `PENDING` and have been sitting longer than they should — usually a
 * sign that the dispatcher is stuck or a downstream queue is jammed.
 *
 * Filters:
 *   - `olderThanMinutes` — defaults to 5 minutes, matching the
 *     dispatcher's expected end-to-end latency budget.
 *   - `topic`            — optional exact match on event topic.
 */
export const ListPendingOutboxQuerySchema = z.object({
  olderThanMinutes: z.coerce.number().int().min(0).max(60 * 24).optional(),
  topic: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export type ListPendingOutboxQueryDto = z.infer<
  typeof ListPendingOutboxQuerySchema
>;
