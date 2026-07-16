import { z } from 'zod';

/**
 * Body for `POST /placement/:id/answer`.
 *
 * - `questionRef` must reference a question in the static bank
 *   (`question-bank.ts`). The service rejects unknown refs.
 * - `answer` is the learner's response. It is stored verbatim as JSON
 *   (`PlacementAnswer.answer`) so the format can evolve with the question
 *   source (Open Question 5) without a schema change. For the current
 *   multiple-choice bank it is the selected option index, but we accept any
 *   JSON-serialisable scalar/array to stay forward-compatible.
 *
 * `skill` is intentionally NOT accepted from the client: it is derived from
 * the question bank server-side so it always matches the question.
 */
export const SubmitAnswerSchema = z.object({
  questionRef: z.string().min(1).max(128),
  answer: z.union([
    z.string().max(2000),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string().max(2000), z.number()])).max(50),
  ]),
});

export type SubmitAnswerDto = z.infer<typeof SubmitAnswerSchema>;
