import { z } from 'zod';

/**
 * Default page size when the caller omits the `pageSize` query param.
 * Aligns with the rest of the codebase (discovery service, dm
 * service) so a single source of truth is observable from a unified
 * pagination schema.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard ceiling for `pageSize` across the platform (Task 24.2 — design
 * note "Pagination: keyset (cursor) pagination for `lessons`,
 * `notifications`, `submissions` (>10k rows)").
 *
 * Endpoints that require a tighter cap (e.g. AI completions, dense
 * teacher analytics) should keep their bespoke DTO — this helper is
 * for the common case.
 */
export const DEFAULT_MAX_PAGE_SIZE = 100;

/**
 * Build a Zod schema describing the canonical pagination params used
 * across read endpoints:
 *
 *   - `cursor`   — opaque string forwarded back to the next call.
 *                  Validated as a non-empty string only; the per-
 *                  endpoint repository decides whether it is a UUID,
 *                  ISO timestamp, etc.
 *   - `pageSize` — coerced integer in `[1, maxPageSize]`. Defaults to
 *                  {@link DEFAULT_PAGE_SIZE}.
 *
 * Usage:
 *   ```ts
 *   const schema = paginationSchema().extend({
 *     specialtyId: z.string().uuid().optional(),
 *   });
 *   ```
 *
 * The factory returns a fresh schema on each call so callers can
 * `.extend(...)` without mutating a shared instance.
 *
 * Requirements: 20.1, 20.7.
 */
export function paginationSchema(maxPageSize: number = DEFAULT_MAX_PAGE_SIZE) {
  if (!Number.isFinite(maxPageSize) || maxPageSize <= 0) {
    throw new Error(
      `paginationSchema: maxPageSize must be a positive number, got ${maxPageSize}`,
    );
  }
  const cap = Math.floor(maxPageSize);

  return z.object({
    cursor: z.string().trim().min(1).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(cap)
      .optional()
      .default(DEFAULT_PAGE_SIZE),
  });
}

export type PaginationDto = z.infer<ReturnType<typeof paginationSchema>>;
