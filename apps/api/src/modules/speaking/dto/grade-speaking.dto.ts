import { z } from 'zod';

/**
 * Body for `POST /submissions/:id/speaking-grade` — the instructor's
 * FINAL grade for a speaking/pronunciation submission (Task 4.3,
 * Req 15.3).
 *
 * Distinct from the pre-GRADED override (`OverrideSpeakingScoreSchema`):
 * this transition moves the submission to GRADED and triggers the
 * homework-graded notification to the learner. `score` is range-checked
 * against the assignment's `totalPoints` in the service; an optional
 * `comment` is stored as the teacher's final feedback.
 */
export const GradeSpeakingSubmissionSchema = z
  .object({
    score: z
      .number()
      .int('score must be an integer')
      .min(0, 'score must be ≥ 0'),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export type GradeSpeakingSubmissionDto = z.infer<
  typeof GradeSpeakingSubmissionSchema
>;
