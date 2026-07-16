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
  /**
   * @deprecated Req 2.3 — the generic Specialty abstraction is being retired.
   * Bilgim is English-only, so onboarding no longer asks the instructor to
   * pick a specialty; the specialty is resolved server-side. This field is
   * still accepted (validated leniently as any string, no UUID/existence
   * check) for backward compatibility with legacy clients that may still
   * post a `specialtyId`, but it is IGNORED: the value is never read or used
   * to write/require a Specialty. Omitting it is fully supported. Remove once
   * the Specialty decommission completes (see packages/db/DECOMMISSION.md).
   */
  specialtyId: z.string().optional().nullable(),
});

export type SubmitAnswersDto = z.infer<typeof SubmitAnswersSchema>;
