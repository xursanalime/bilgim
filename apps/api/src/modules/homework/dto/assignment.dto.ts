import { z } from 'zod';

import { sanitizeHtml } from '../../../common/sanitization';
import { HomeworkModuleTypeSchema } from './specialty-module.dto';

/**
 * Zod schema for a single AssignmentModule entry inside the assignment
 * builder payload (Task 17.3, Req 11.5, 11.8).
 *
 * `configJson` is a free-form JSON blob whose shape is module-type
 * specific (writing prompt, reading passage, gap-fill questions, ...).
 * We accept any JSON-serialisable value at the schema layer and let the
 * downstream module-runtime validate the actual shape — keeping this
 * schema permissive avoids coupling the assignment builder to every
 * module type's internal contract.
 *
 * `weight` is bounded to [1, 1000] so a malicious or buggy client cannot
 * push pathological values that would break grade aggregation later.
 * `order` is a non-negative integer; the service preserves the caller's
 * order on insert.
 */
export const AssignmentModuleInputSchema = z.object({
  type: HomeworkModuleTypeSchema,
  order: z.number().int().min(0).max(1000),
  configJson: z.unknown(),
  weight: z.number().int().min(1).max(1000).default(100),
});

export type AssignmentModuleInputDto = z.infer<
  typeof AssignmentModuleInputSchema
>;

/**
 * Body schema for `POST /lessons/:lessonId/assignments` — assignment
 * builder create endpoint (Task 17.3, Req 11.5, 11.8).
 *
 * Notes:
 *   - At least one module is required; the assignment builder UI cannot
 *     submit an empty assignment.
 *   - Module `type` values are validated against the `HomeworkModuleType`
 *     enum at schema time. The "must be enabled for the parent group via
 *     GroupModule.isEnabled = true" check is enforced server-side in the
 *     service layer (Req 11.8).
 *   - `dueAt` is an ISO-8601 string at the wire level, parsed to a Date
 *     in the service.
 *   - `isPublished` is intentionally NOT accepted on create — assignments
 *     are always created as drafts. Use `POST /assignments/:id/publish`
 *     to fan out HOMEWORK_ASSIGNED notifications.
 */
export const CreateAssignmentSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10_000).transform(sanitizeHtml).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  totalPoints: z.number().int().min(1).max(10_000).optional(),
  modules: z.array(AssignmentModuleInputSchema).min(1).max(20),
});

export type CreateAssignmentDto = z.infer<typeof CreateAssignmentSchema>;

/**
 * Body schema for `PATCH /assignments/:id` — partial update.
 *
 * Each top-level field is optional. When `modules` is provided the
 * service replaces the entire module set (atomic delete + re-create
 * inside one transaction), and re-validates every entry against the
 * group's currently enabled modules. Omitting `modules` leaves the
 * existing modules untouched.
 *
 * `isPublished` is allowed here for completeness (e.g. an admin
 * override), but the canonical publish path is the dedicated
 * `POST /assignments/:id/publish` endpoint which also fans out the
 * HOMEWORK_ASSIGNED notification — flipping `isPublished=true` through
 * `PATCH` will NOT emit the outbox event, so it is meant only for
 * exceptional cases.
 */
export const UpdateAssignmentSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z
      .string()
      .trim()
      .max(10_000)
      .transform(sanitizeHtml)
      .nullable()
      .optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    totalPoints: z.number().int().min(1).max(10_000).optional(),
    isPublished: z.boolean().optional(),
    modules: z.array(AssignmentModuleInputSchema).min(1).max(20).optional(),
  })
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined),
    { message: 'At least one field must be provided' },
  );

export type UpdateAssignmentDto = z.infer<typeof UpdateAssignmentSchema>;
