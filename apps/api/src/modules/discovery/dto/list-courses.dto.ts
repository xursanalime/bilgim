import { z } from 'zod';

/**
 * Query for `GET /discovery/courses` (Req 14.1, 14.2).
 *
 * - `q`        — fuzzy text query (matched against title/description via
 *                pg_trgm + ILIKE; min 2 chars to avoid full-table scans).
 * - `specialtyId` — restrict to courses whose teacher has this specialty.
 * - `level`    — exact match against `Course.level` (e.g. "A1", "B2").
 * - `priceMin` / `priceMax` — UZS price band, applied to `fromPriceUzs`.
 * - `cursor`   — opaque cursor (Course.id from previous page); when set,
 *                the result set continues *after* this id under the same
 *                `(createdAt DESC, id DESC)` ordering.
 * - `pageSize` — clamped 1..50 (default 20).
 */
export const ListDiscoveryCoursesSchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    specialtyId: z.string().uuid().optional(),
    level: z.string().trim().max(50).optional(),
    priceMin: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
    priceMax: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine(
    (d) =>
      d.priceMin === undefined ||
      d.priceMax === undefined ||
      d.priceMin <= d.priceMax,
    { message: 'priceMin must be <= priceMax', path: ['priceMin'] },
  );

export type ListDiscoveryCoursesDto = z.infer<
  typeof ListDiscoveryCoursesSchema
>;
