import { z } from 'zod';

import { sanitizeHtml } from '../../../common/sanitization';

/**
 * Allowed lesson types — mirrors the Prisma `LessonType` enum so we can keep
 * Zod validation in sync without importing the runtime enum.
 */
export const LessonTypeSchema = z.enum(['RECORDED', 'LIVE', 'HYBRID', 'TEXT_ONLY']);

/**
 * Body for `POST /catalog/groups/:groupId/lessons` (Req 7.4).
 *
 * Status is always DRAFT on create — controllers do NOT accept a status
 * field. Use `PATCH /lessons/:id/publish` to transition DRAFT → READY.
 *
 * `description` is sanitized HTML (Task 29.4) — `<script>`, `<iframe>`,
 * `javascript:`, and `on*=` handlers are stripped before persistence.
 */
export const CreateLessonSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200),
  description: z.string().max(5000).transform(sanitizeHtml).optional(),
  type: LessonTypeSchema,
  position: z.number().int().nonnegative().max(10_000).optional(),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be an ISO 8601 datetime' })
    .optional(),
});

export type CreateLessonDto = z.infer<typeof CreateLessonSchema>;

export const UpdateLessonSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z
      .string()
      .max(5000)
      .transform(sanitizeHtml)
      .nullable()
      .optional(),
    type: LessonTypeSchema.optional(),
    position: z.number().int().nonnegative().max(10_000).optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateLessonDto = z.infer<typeof UpdateLessonSchema>;
