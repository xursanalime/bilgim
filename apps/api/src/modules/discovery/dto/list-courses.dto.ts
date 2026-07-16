import { z } from 'zod';

/**
 * CEFR proficiency levels accepted as a discovery facet (Req 14.2).
 * Mirrors the Prisma `CefrLevel` enum.
 */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const CefrLevelSchema = z.enum(CEFR_LEVELS);

/**
 * Accept one or more CEFR levels from the query string. NestJS parses a
 * repeated param (`?cefrLevel=A1&cefrLevel=B2`) into an array and a single
 * value (`?cefrLevel=A1`) into a string — normalise both to a string[].
 */
const CefrLevelFacetSchema = z
  .union([CefrLevelSchema, z.array(CefrLevelSchema).min(1)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

/**
 * Query for `GET /discovery/courses` (Req 14.1 — 14.4).
 *
 * English-only refocus: the generic `specialtyId` facet is retired and
 * replaced by the English level + exam-track facets (Req 14.4). `specialtyId`
 * is still *accepted* for backwards compatibility during the deprecation
 * window but is ignored by the service (Req 2.3).
 *
 * - `q`         — fuzzy text query (matched against title/description via
 *                 pg_trgm + ILIKE; min 2 chars to avoid full-table scans).
 * - `cefrLevel` — one or more CEFR levels (A1..C2); matches `Course.cefrLevel`.
 * - `examTrack` — exam-track slug (e.g. "ielts"); matches `Course.examTrack`.
 * - `level`     — legacy free-text level string (retained, optional).
 * - `priceMin` / `priceMax` — UZS price band, applied to `fromPriceUzs`.
 * - `cursor`    — opaque cursor (Course.id from previous page); when set,
 *                 the result set continues *after* this id under the same
 *                 `(createdAt DESC, id DESC)` ordering.
 * - `pageSize`  — clamped 1..50 (default 20).
 * - `specialtyId` — DEPRECATED: accepted but ignored (Req 2.3).
 */
export const ListDiscoveryCoursesSchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    cefrLevel: CefrLevelFacetSchema.optional(),
    examTrack: z.string().trim().min(1).max(50).optional(),
    level: z.string().trim().max(50).optional(),
    priceMin: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
    priceMax: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
    /** DEPRECATED (english-only refocus): accepted but ignored — Req 2.3. */
    specialtyId: z.string().uuid().optional(),
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
