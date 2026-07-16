import { z } from 'zod';

import { LANGUAGE_MODULE_TYPES } from '../../homework/language-module-types';

/**
 * Body for `POST /admin/english/exam-tracks` (English-Only Platform
 * Refocus, Req 17.1).
 *
 * `slug` is the stable identifier `Course.examTrack` references as a
 * string (no FK — see the schema note on `ExamTrack`). It uses the same
 * kebab-case contract as the other admin catalog slugs so public URLs /
 * filters stay predictable.
 */
export const CreateExamTrackSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message: 'slug must be kebab-case (lowercase, digits, single hyphens)',
    }),
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean().optional(),
});

export type CreateExamTrackDto = z.infer<typeof CreateExamTrackSchema>;

/**
 * Body for `PATCH /admin/english/exam-tracks/:id` (Req 17.1).
 *
 * Activation / deactivation of an Exam_Track option. `slug` is immutable
 * once set (Course rows reference it by value) — admins retire a track
 * by deactivating it, which hides it from new course creation while
 * leaving existing courses untouched.
 */
export const UpdateExamTrackSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: 'At least one of name or isActive must be provided',
  });

export type UpdateExamTrackDto = z.infer<typeof UpdateExamTrackSchema>;

/**
 * Zod enum of the eight Language_Module_Type values, derived from the
 * single source of truth so the catalog can never accept a
 * Legacy_Module_Type.
 */
export const LanguageModuleTypeSchema = z.enum(LANGUAGE_MODULE_TYPES);

/**
 * Body for `PATCH /admin/english/module-catalog/:moduleType` (Req 17.2,
 * 17.3).
 *
 * Enables or disables one of the eight global English skills
 * platform-wide. Disabling is non-destructive: it only removes the skill
 * from *new* assignment availability — existing Submissions and
 * Assignments are never modified (Req 17.3).
 */
export const SetModuleCatalogEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type SetModuleCatalogEnabledDto = z.infer<
  typeof SetModuleCatalogEnabledSchema
>;
