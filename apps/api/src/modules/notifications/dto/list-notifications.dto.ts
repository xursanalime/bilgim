import { z } from 'zod';

/**
 * Query schema for `GET /notifications`.
 *
 * - `cursor`: opaque ISO timestamp from a previous page's last item
 *   (`createdAt`). When omitted the latest page is returned.
 * - `limit`: 1..50 inclusive; default 20.
 * - `unreadOnly`: when `true` filters to `readAt IS NULL`.
 */
export const ListNotificationsQuerySchema = z.object({
  cursor: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().datetime().optional()),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .default(false),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
