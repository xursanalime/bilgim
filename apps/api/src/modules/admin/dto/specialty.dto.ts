import { z } from 'zod';

import { HomeworkModuleTypeSchema } from '../../homework/dto/specialty-module.dto';

/**
 * Body for `POST /admin/specialties` (Req 24.1).
 *
 * `slug` is the human-readable, URL-safe identifier used by the public
 * discovery surface. The schema enforces the same constraints the public
 * UI relies on (lowercase, kebab-case, 2..64 chars).
 */
export const CreateSpecialtySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message: 'slug must be kebab-case (lowercase, digits, single hyphens)',
    }),
  nameUz: z.string().trim().min(1).max(120),
  nameRu: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  dashboardKey: z.string().trim().min(1).max(64),
  isActive: z.boolean().optional(),
});

export type CreateSpecialtyDto = z.infer<typeof CreateSpecialtySchema>;

/**
 * Body for `PATCH /admin/specialties/:id` (Req 24.1).
 *
 * Sparse update — only the fields present in the body are touched. The
 * `slug` cannot be changed once set to keep public URLs stable; admins
 * should retire and recreate specialties instead.
 */
export const UpdateSpecialtySchema = z.object({
  nameUz: z.string().trim().min(1).max(120).optional(),
  nameRu: z.string().trim().min(1).max(120).optional(),
  nameEn: z.string().trim().min(1).max(120).optional(),
  dashboardKey: z.string().trim().min(1).max(64).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateSpecialtyDto = z.infer<typeof UpdateSpecialtySchema>;

/**
 * Body for `PUT /admin/specialties/:id/modules` (Req 24.2, 24.3).
 *
 * Re-exports the contract used by `HomeworkService.bulkUpsertSpecialtyModules`
 * so the admin controller can delegate to it without reaching into the
 * homework module's DTO surface from the consumer side. The cap of 10
 * `isActive=true` rows per specialty is enforced by HomeworkService.
 */
export const BulkUpsertSpecialtyModulesAdminSchema = z.object({
  modules: z
    .array(
      z.object({
        moduleType: HomeworkModuleTypeSchema,
        isActive: z.boolean(),
        defaultEnabled: z.boolean().optional(),
      }),
    )
    .max(22),
});

export type BulkUpsertSpecialtyModulesAdminDto = z.infer<
  typeof BulkUpsertSpecialtyModulesAdminSchema
>;
