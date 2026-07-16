import { z } from 'zod';

/**
 * Body for `PATCH /submissions/:id/speaking-score` — the instructor
 * override of an AI_DRAFT speaking score (Req 7.6).
 *
 * `score` is the overridden numeric grade (range-checked against the
 * assignment's `totalPoints` in the service). The optional
 * pronunciation / fluency comments and overall `comment` let the
 * instructor correct the AI draft's structured feedback. At least the
 * numeric `score` is always required so an override always yields a
 * concrete grade.
 */
const DimensionOverrideSchema = z
  .object({
    score: z.number().min(0).max(1).optional(),
    comment: z.string().max(2000).optional(),
  })
  .strict();

export const OverrideSpeakingScoreSchema = z
  .object({
    score: z
      .number()
      .int('score must be an integer')
      .min(0, 'score must be ≥ 0'),
    pronunciation: DimensionOverrideSchema.optional(),
    fluency: DimensionOverrideSchema.optional(),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export type OverrideSpeakingScoreDto = z.infer<
  typeof OverrideSpeakingScoreSchema
>;
