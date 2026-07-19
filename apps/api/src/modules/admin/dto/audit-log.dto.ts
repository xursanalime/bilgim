import { z } from 'zod';

/**
 * Query for `GET /admin/audit-logs` (Req 24.5, 21.9).
 *
 * Filters:
 *   - `actorId`  — narrow to one admin's activity.
 *   - `action`   — exact match (e.g. `user.status.changed`).
 *   - `from`/`to` — ISO 8601 date range over `createdAt`.
 *
 * Pagination is page-based for parity with the rest of the admin lists;
 * the `(actorId, createdAt)` index keeps page-N reads cheap even when a
 * filter is supplied.
 */
export const ListAuditLogsQuerySchema = z
  .object({
    actorId: z.string().uuid().optional(),
    action: z.string().trim().min(1).max(120).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type ListAuditLogsQueryDto = z.infer<typeof ListAuditLogsQuerySchema>;
