import { z } from 'zod';
import { CefrLevel } from '@prisma/client';

/**
 * The six CEFR levels (Req 3.1). Mirrors the Prisma `CefrLevel` enum so a
 * client can only ever submit one of {A1, A2, B1, B2, C1, C2}. Kept as a
 * Zod `nativeEnum` so the literal set stays in lock-step with the schema —
 * adding a level in Prisma surfaces it here automatically.
 */
export const CefrLevelSchema = z.nativeEnum(CefrLevel);
export type CefrLevelLiteral = z.infer<typeof CefrLevelSchema>;

/**
 * Body for `PATCH /catalog/courses/:id/level` (Req 3.1, 3.2).
 *
 * - `cefrLevel` is **required** — assigning a level is the whole point of
 *   this endpoint, and Req 3.1 mandates exactly one CEFR level per course.
 * - `examTrack` is optional. It stores an Exam_Track slug (e.g. `ielts`)
 *   alongside the CEFR level (Req 3.2). Passing `null` clears it. The slug
 *   is stored as a free string here (no FK) to match the schema note on
 *   `Course.examTrack`; admin-managed validation against the `ExamTrack`
 *   catalog is a later task (17.1).
 */
export const SetCourseLevelSchema = z.object({
  cefrLevel: CefrLevelSchema,
  examTrack: z.string().trim().min(1).max(50).nullable().optional(),
});
export type SetCourseLevelDto = z.infer<typeof SetCourseLevelSchema>;

/**
 * Body for `PATCH /catalog/groups/:id/level` (Req 3.3, 3.4).
 *
 * `cefrLevel` is nullable:
 *   - a CEFR value sets a Group-specific override that takes precedence
 *     over the inherited Course level (Req 3.4);
 *   - `null` clears the override so the Group falls back to inheriting the
 *     Course level (Req 3.3).
 */
export const SetGroupLevelSchema = z.object({
  cefrLevel: CefrLevelSchema.nullable(),
});
export type SetGroupLevelDto = z.infer<typeof SetGroupLevelSchema>;
