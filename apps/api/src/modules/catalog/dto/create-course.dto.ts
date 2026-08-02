import { z } from 'zod';

import { sanitizeHtml } from '../../../common/sanitization';

/**
 * Body for `POST /catalog/courses`.
 *
 * Per Req 7.1, a freshly created course is `isPublished=false` and
 * `isDiscoverable=true` — neither field is accepted on create. The teacher
 * separately publishes the course (`PATCH /catalog/courses/:id/publish`).
 *
 * `description` accepts a small allowlist of HTML (Task 29.4) — it goes
 * through `sanitizeHtml()` so a teacher cannot smuggle `<script>`,
 * `<iframe>`, or `javascript:` URLs into a course description that a
 * student then renders.
 */
export const CreateCourseSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200),
  description: z.string().max(5000).transform(sanitizeHtml).optional(),
  level: z.string().trim().max(50).optional(),
  fromPriceUzs: z.number().int().nonnegative().max(100_000_000).optional(),
});

export type CreateCourseDto = z.infer<typeof CreateCourseSchema>;

/**
 * Body for `PATCH /catalog/courses/:id`. Title cannot be cleared (min 1) but
 * description/level can be reset to empty string. All fields optional.
 */
export const UpdateCourseSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z
      .string()
      .max(5000)
      .transform(sanitizeHtml)
      .nullable()
      .optional(),
    level: z.string().trim().max(50).nullable().optional(),
    fromPriceUzs: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateCourseDto = z.infer<typeof UpdateCourseSchema>;
