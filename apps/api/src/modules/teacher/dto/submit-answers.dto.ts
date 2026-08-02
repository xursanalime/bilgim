import { z } from 'zod';

/**
 * SubmitAnswersDto — Zod schema for POST /teacher/onboarding/answers.
 *
 * Validates that the body is `{ answers: Array<{ questionId, selectedOptionId }> }`
 * with at least one answer and uuid-format questionIds.
 */
export const SubmitAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid('questionId must be a UUID'),
        selectedOptionId: z.string().min(1, 'selectedOptionId is required'),
      }),
    )
    .min(1, 'At least one answer is required'),
});

export type SubmitAnswersDto = z.infer<typeof SubmitAnswersSchema>;
