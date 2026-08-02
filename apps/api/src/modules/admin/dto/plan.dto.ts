import { z } from 'zod';

/**
 * Body for `POST /admin/plans` (Req 24.x — admin manages billing Plans).
 *
 * Mirrors the columns on `Plan`; `features` is an opaque JSON blob
 * consumed by the billing/teacher dashboard, so we accept any object.
 */
export const CreatePlanSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message: 'slug must be kebab-case (lowercase, digits, single hyphens)',
    }),
  nameUz: z.string().trim().min(1).max(120),
  priceUzs: z.number().int().nonnegative().max(1_000_000_000),
  intervalDays: z.number().int().min(1).max(366),
  maxStudents: z.number().int().min(1).max(100_000).optional(),
  features: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type CreatePlanDto = z.infer<typeof CreatePlanSchema>;

/**
 * Body for `PATCH /admin/plans/:id` (Req 24.x).
 *
 * Sparse update — `slug` is immutable so existing subscribers' plan
 * references stay stable across renames.
 */
export const UpdatePlanSchema = z.object({
  nameUz: z.string().trim().min(1).max(120).optional(),
  priceUzs: z.number().int().nonnegative().max(1_000_000_000).optional(),
  intervalDays: z.number().int().min(1).max(366).optional(),
  maxStudents: z.number().int().min(1).max(100_000).nullable().optional(),
  features: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export type UpdatePlanDto = z.infer<typeof UpdatePlanSchema>;
