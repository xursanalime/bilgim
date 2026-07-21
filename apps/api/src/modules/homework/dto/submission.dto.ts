import { z } from 'zod';

import { sanitizeHtml } from '../../../common/sanitization';

/**
 * DTO schemas for the Submission lifecycle endpoints (Task 18.1,
 * Req 12.1, 12.2, 12.5, 12.7).
 *
 * The shape of `answersJson` is module-type specific — the assignment
 * builder writes one entry per module id in the assignment. We accept
 * the JSON body as a free-form record at the wire layer (Prisma stores
 * it as `Json`), and let the per-module runtime validate the actual
 * shape of each entry. Capping the payload defensively at 64 KB happens
 * at the transport layer (Nest body parser) — the schema here only
 * ensures the top-level shape.
 */

const AnswersJsonSchema = z
  .record(z.unknown())
  .refine((v) => v !== null, { message: 'answersJson must be a JSON object' });

/** Empty body for `POST /assignments/:assignmentId/submissions` — student
 * creates / re-creates the DRAFT row. We still validate that no extra
 * fields slip through so the contract stays explicit. */
export const CreateSubmissionSchema = z
  .object({
    answersJson: AnswersJsonSchema.optional(),
  })
  .strict();

export type CreateSubmissionDto = z.infer<typeof CreateSubmissionSchema>;

/**
 * Body schema for `PATCH /submissions/:id` — partial answers save.
 *
 * Server-side merge semantics: the supplied `answersJson` is shallow-merged
 * with the existing row (top-level keys are replaced; nested values are
 * NOT deep-merged). This matches the autosave contract — the writing
 * module emits the entire `{ moduleId: { ... } }` block on each save, so
 * the student never partially overwrites a single module's body.
 */
export const UpdateSubmissionAnswersSchema = z
  .object({
    answersJson: AnswersJsonSchema,
  })
  .strict();

export type UpdateSubmissionAnswersDto = z.infer<
  typeof UpdateSubmissionAnswersSchema
>;

/**
 * Body schema for `POST /submissions/:id/submit` — DRAFT→SUBMITTED.
 *
 * Optionally accepts a final `answersJson` so the client can land a
 * last-write-wins save together with the submit transition (mirrors the
 * web autosave UX).
 */
export const SubmitSubmissionSchema = z
  .object({
    answersJson: AnswersJsonSchema.optional(),
  })
  .strict();

export type SubmitSubmissionDto = z.infer<typeof SubmitSubmissionSchema>;

/**
 * Per-module feedback entry attached to a teacher grade. `payload` is a
 * free-form JSON blob whose shape depends on the module type
 * (highlights, comments, scoring rubric, …).
 */
export const FeedbackEntrySchema = z.object({
  moduleId: z.string().uuid().optional(),
  comment: z.string().trim().max(10_000).transform(sanitizeHtml).optional(),
  payload: z.unknown().optional(),
});

export type FeedbackEntryDto = z.infer<typeof FeedbackEntrySchema>;

/**
 * Body schema for `POST /submissions/:id/grade` — teacher grades a
 * SUBMITTED or IN_REVIEW submission.
 *
 * `score` is bounded at the schema level ([0, 10_000]); the service
 * additionally validates it against `assignment.totalPoints` so a
 * teacher cannot give 200/100. Optional `feedback` entries are written
 * as `Feedback(authorType=TEACHER, isFinal=true)` rows.
 */
export const GradeSubmissionSchema = z
  .object({
    score: z.number().int().min(0).max(10_000),
    feedback: z.array(FeedbackEntrySchema).max(50).optional(),
  })
  .strict();

export type GradeSubmissionDto = z.infer<typeof GradeSubmissionSchema>;

/**
 * Body schema for `POST /submissions/:id/return` — teacher kicks the
 * submission back to RETURNED so the student can revise and re-submit.
 *
 * Optional `comment` is recorded as a `Feedback(authorType=TEACHER)`
 * row pinned to the submission.
 */
export const ReturnSubmissionSchema = z
  .object({
    comment: z.string().trim().max(10_000).transform(sanitizeHtml).optional(),
  })
  .strict();

export type ReturnSubmissionDto = z.infer<typeof ReturnSubmissionSchema>;

/** Query schema for `GET /submissions/me?assignmentId=...`. */
export const GetMySubmissionQuerySchema = z.object({
  assignmentId: z.string().uuid(),
});

export type GetMySubmissionQueryDto = z.infer<
  typeof GetMySubmissionQuerySchema
>;
