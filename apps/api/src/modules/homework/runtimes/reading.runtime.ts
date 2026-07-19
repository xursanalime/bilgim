import { HomeworkModuleType } from '@prisma/client';
import { z } from 'zod';

import {
  AiPromptInputs,
  HomeworkModuleRuntime,
  HomeworkRuntimeError,
} from './types';

/**
 * Reading module runtime (Task 18.4, Req 11 — Reading module UX).
 *
 * The teacher's `AssignmentModule.configJson` shape (Zod-validated):
 *
 *   {
 *     passage: string,
 *     questions: Array<{
 *       id: string,
 *       prompt: string,
 *       kind: 'mcq' | 'short' | 'true_false',
 *       choices?: string[],          // mcq only, >= 2 entries
 *       answer?: string | string[]   // mcq: choice or list of choices
 *                                    // short: model answer (used by AI grader)
 *                                    // true_false: 'true' | 'false'
 *     }>
 *   }
 *
 * The student's `Submission.answersJson[<moduleId>]` shape:
 *
 *   {
 *     responses: Record<questionId, { value: string | string[] }>
 *   }
 *
 * Validation rules baked into `validateAnswer`:
 *   - Every `responses` key MUST reference a question id that exists in
 *     the config (orphan keys raise `INVALID_MODULE_ANSWER` via Zod).
 *   - For `mcq`: `value` is a single choice when the config's `answer`
 *     is a string, or an array of choices when the config's `answer` is
 *     an array. The value(s) must be a subset of `config.choices`.
 *   - For `true_false`: `value` is `'true'` or `'false'`.
 *   - For `short`: any string is accepted; the AI grader compares it
 *     against the model `answer` from the config.
 *
 * Missing responses (questions without an entry in `responses`) are
 * allowed by design — the AI / teacher grading pipeline scores them as
 * 0. This matches the autosave UX where a student may submit a partially
 * completed reading task.
 *
 * Per-question scoring (`scoreQuestion`) is deterministic for `mcq` and
 * `true_false` (exact-match); `short` returns `null` so the AI grader
 * can pick it up.
 */

// ----------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------

const QuestionKindSchema = z.enum(['mcq', 'short', 'true_false']);

const QuestionIdSchema = z.string().trim().min(1).max(120);

const McqAnswerSchema = z.union([
  z.string().trim().min(1),
  z
    .array(z.string().trim().min(1))
    .min(1)
    .max(20),
]);

/**
 * Base shape shared across question kinds. The kind-specific refinements
 * (mcq must have choices, true_false answer must be 'true'/'false', etc.)
 * are layered on top via `superRefine`.
 */
const ReadingQuestionSchema = z
  .object({
    id: QuestionIdSchema,
    prompt: z.string().trim().min(1).max(2_000),
    kind: QuestionKindSchema,
    choices: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    answer: McqAnswerSchema.optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    switch (q.kind) {
      case 'mcq': {
        if (!q.choices || q.choices.length < 2) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['choices'],
            message: 'mcq questions must include at least 2 choices',
          });
          return;
        }
        const choiceSet = new Set(q.choices);
        if (q.choices.length !== choiceSet.size) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['choices'],
            message: 'mcq choices must be unique',
          });
        }
        if (q.answer === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['answer'],
            message: 'mcq questions must include an answer',
          });
          return;
        }
        if (typeof q.answer === 'string') {
          if (!choiceSet.has(q.answer)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['answer'],
              message: 'mcq answer must be one of the choices',
            });
          }
        } else {
          // multi-answer
          for (const a of q.answer) {
            if (!choiceSet.has(a)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['answer'],
                message: `mcq multi-answer entry "${a}" must be one of the choices`,
              });
            }
          }
          if (new Set(q.answer).size !== q.answer.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['answer'],
              message: 'mcq multi-answer entries must be unique',
            });
          }
        }
        return;
      }
      case 'true_false': {
        if (q.choices !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['choices'],
            message: 'true_false questions must not include choices',
          });
        }
        if (q.answer === undefined || typeof q.answer !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['answer'],
            message: "true_false answer must be 'true' or 'false'",
          });
          return;
        }
        if (q.answer !== 'true' && q.answer !== 'false') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['answer'],
            message: "true_false answer must be 'true' or 'false'",
          });
        }
        return;
      }
      case 'short': {
        if (q.choices !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['choices'],
            message: 'short questions must not include choices',
          });
        }
        if (q.answer !== undefined && typeof q.answer !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['answer'],
            message:
              'short questions accept a single string model answer, not an array',
          });
        }
        return;
      }
    }
  });

export const ReadingConfigSchema = z
  .object({
    // Capped at 200k characters — comfortably above any reasonable
    // reading passage and protects the DB Json column.
    passage: z.string().trim().min(1).max(200_000),
    questions: z.array(ReadingQuestionSchema).min(1).max(100),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    cfg.questions.forEach((q, idx) => {
      if (ids.has(q.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', idx, 'id'],
          message: `duplicate question id "${q.id}"`,
        });
      }
      ids.add(q.id);
    });
  });

export type ReadingQuestion = z.infer<typeof ReadingQuestionSchema>;
export type ReadingConfig = z.infer<typeof ReadingConfigSchema>;

const ReadingResponseValueSchema = z.union([
  z.string().max(50_000),
  z.array(z.string().max(2_000)).min(1).max(50),
]);

const ReadingResponseEntrySchema = z
  .object({
    value: ReadingResponseValueSchema,
  })
  .strict();

export const ReadingAnswerSchema = z
  .object({
    responses: z.record(ReadingResponseEntrySchema),
  })
  .strict();

export type ReadingAnswer = z.infer<typeof ReadingAnswerSchema>;

// ----------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------

export type ReadingQuestionScore =
  | { kind: 'deterministic'; correct: boolean }
  | { kind: 'ai'; pending: true };

/**
 * Deterministic scoring for `mcq` and `true_false`. Returns `null` for
 * `short` (the AI grader handles those) and for missing responses.
 *
 * For mcq multi-answer the comparison is set-equality — order does not
 * matter and every choice in the model answer must be selected and
 * vice versa.
 *
 * Exported for use by the AI grading worker (Task 18.2 follow-up) and
 * for unit tests.
 */
export function scoreReadingQuestion(
  question: ReadingQuestion,
  response: { value: string | string[] } | undefined,
): ReadingQuestionScore | null {
  if (response === undefined) return null;

  switch (question.kind) {
    case 'mcq': {
      // Validation guarantees `answer` is set and is a string or string[]
      // matching the response shape; we still defensively check.
      if (question.answer === undefined) return null;
      if (typeof question.answer === 'string') {
        if (typeof response.value !== 'string') {
          return { kind: 'deterministic', correct: false };
        }
        return {
          kind: 'deterministic',
          correct: response.value === question.answer,
        };
      }
      // multi-answer
      if (!Array.isArray(response.value)) {
        return { kind: 'deterministic', correct: false };
      }
      const expected = new Set(question.answer);
      const actual = new Set(response.value);
      if (expected.size !== actual.size) {
        return { kind: 'deterministic', correct: false };
      }
      for (const e of expected) {
        if (!actual.has(e)) return { kind: 'deterministic', correct: false };
      }
      return { kind: 'deterministic', correct: true };
    }
    case 'true_false': {
      if (question.answer === undefined) return null;
      const expected = question.answer as string;
      if (typeof response.value !== 'string') {
        return { kind: 'deterministic', correct: false };
      }
      return {
        kind: 'deterministic',
        correct: response.value === expected,
      };
    }
    case 'short':
      return { kind: 'ai', pending: true };
  }
}

// ----------------------------------------------------------------------
// Runtime
// ----------------------------------------------------------------------

export class ReadingRuntime
  implements HomeworkModuleRuntime<ReadingConfig, ReadingAnswer>
{
  readonly type: HomeworkModuleType = 'READING';

  /**
   * Parse `configJson` strictly. Throws `ZodError` on shape problems —
   * the AssignmentService layer converts that into a 400
   * INVALID_MODULE_CONFIG with the offending field path intact.
   */
  validateConfig(configJson: unknown): ReadingConfig {
    return ReadingConfigSchema.parse(configJson);
  }

  /**
   * Parse the per-student answer slice and verify every answered
   * questionId references a question in the config. Missing answers are
   * allowed by design (the AI / teacher grader scores them as 0).
   *
   * Mismatched answer shapes (e.g. an array value for a single-answer
   * mcq) raise `INVALID_MODULE_ANSWER` via `HomeworkRuntimeError` so the
   * UI can render the violation against the offending question.
   */
  validateAnswer(config: ReadingConfig, answer: unknown): ReadingAnswer {
    const parsed = ReadingAnswerSchema.parse(answer);

    const byId = new Map(config.questions.map((q) => [q.id, q] as const));

    for (const [qid, response] of Object.entries(parsed.responses)) {
      const question = byId.get(qid);
      if (!question) {
        throw new HomeworkRuntimeError(
          'INVALID_MODULE_ANSWER',
          `Response references unknown question id "${qid}"`,
          { questionId: qid },
        );
      }

      switch (question.kind) {
        case 'mcq': {
          const expectsArray = Array.isArray(question.answer);
          if (expectsArray && !Array.isArray(response.value)) {
            throw new HomeworkRuntimeError(
              'INVALID_MODULE_ANSWER',
              `Question "${qid}" is multi-answer; value must be an array`,
              { questionId: qid, kind: 'mcq', expected: 'array' },
            );
          }
          if (!expectsArray && typeof response.value !== 'string') {
            throw new HomeworkRuntimeError(
              'INVALID_MODULE_ANSWER',
              `Question "${qid}" is single-answer; value must be a string`,
              { questionId: qid, kind: 'mcq', expected: 'string' },
            );
          }
          // Choices subset check.
          const choiceSet = new Set(question.choices ?? []);
          const values = Array.isArray(response.value)
            ? response.value
            : [response.value];
          for (const v of values) {
            if (!choiceSet.has(v)) {
              throw new HomeworkRuntimeError(
                'INVALID_MODULE_ANSWER',
                `Question "${qid}" value "${v}" is not one of the choices`,
                { questionId: qid, kind: 'mcq', value: v },
              );
            }
          }
          break;
        }
        case 'true_false': {
          if (typeof response.value !== 'string') {
            throw new HomeworkRuntimeError(
              'INVALID_MODULE_ANSWER',
              `Question "${qid}" value must be 'true' or 'false'`,
              { questionId: qid, kind: 'true_false' },
            );
          }
          if (response.value !== 'true' && response.value !== 'false') {
            throw new HomeworkRuntimeError(
              'INVALID_MODULE_ANSWER',
              `Question "${qid}" value must be 'true' or 'false' (got "${response.value}")`,
              { questionId: qid, kind: 'true_false', value: response.value },
            );
          }
          break;
        }
        case 'short': {
          if (typeof response.value !== 'string') {
            throw new HomeworkRuntimeError(
              'INVALID_MODULE_ANSWER',
              `Question "${qid}" short answer must be a string`,
              { questionId: qid, kind: 'short' },
            );
          }
          break;
        }
      }
    }

    return parsed;
  }

  /**
   * Build the AI grading prompt skeleton (Task 18.2 follow-up). The
   * Reading prompt template needs:
   *   - the passage,
   *   - every question + the student's response,
   *   - the model answers for `short` questions only (mcq / true_false
   *     are scored deterministically and do not need the AI).
   *
   * Mcq / true_false are still listed so the prompt can include the
   * full reading context, but their `modelAnswer` is omitted —
   * the AI grader does not need to second-guess them.
   */
  aiPromptInputs(
    config: ReadingConfig,
    answer: ReadingAnswer,
  ): AiPromptInputs {
    const items = config.questions.map((q) => {
      const response = answer.responses[q.id];
      const base: Record<string, unknown> = {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        studentValue: response?.value ?? null,
      };
      if (q.kind === 'short' && q.answer !== undefined) {
        base.modelAnswer = q.answer;
      }
      if (q.kind === 'mcq' && q.choices) {
        base.choices = q.choices;
      }
      return base;
    });

    // The student-text bag — short-answer free text concatenated so the
    // AI-text detector / similarity check has something to work with.
    const shortAnswers = config.questions
      .filter((q) => q.kind === 'short')
      .map((q) => {
        const r = answer.responses[q.id]?.value;
        return typeof r === 'string' ? r : '';
      })
      .filter((s) => s.length > 0);

    return {
      moduleType: this.type,
      studentText: shortAnswers.join('\n\n'),
      rubric: [],
      metadata: {
        passage: config.passage,
        items,
      },
    };
  }
}

/** Single shared instance — runtimes are stateless. */
export const readingRuntime = new ReadingRuntime();
