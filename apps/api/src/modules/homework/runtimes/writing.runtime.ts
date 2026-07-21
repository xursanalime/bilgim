import { HomeworkModuleType } from '@prisma/client';
import { z } from 'zod';

import {
  AiPromptInputs,
  HomeworkModuleRuntime,
  HomeworkRuntimeError,
} from './types';

/**
 * Writing module runtime (Task 18.3, Req 11.5, 11.8, 23.1, 23.2, 23.4).
 *
 * The teacher's `AssignmentModule.configJson` shape (Zod-validated):
 *
 *   {
 *     prompt: string,
 *     minWords?: number,        // 0..50_000
 *     maxWords?: number,        // 0..50_000
 *     rubric?: {
 *       criteria: { name: string, weight: number }[]   // weight 1..1000
 *     }
 *   }
 *
 * The student's `Submission.answersJson[<moduleId>]` shape:
 *
 *   {
 *     text: string,                                    // 0..200_000 chars
 *     attachments?: { mediaId: string }[]              // <= 10 entries
 *   }
 *
 * Word-count enforcement happens here on `validateAnswer` so a malicious
 * client cannot push a 0-word draft into SUBMITTED — the controller
 * surfaces `ANSWER_TOO_SHORT` / `ANSWER_TOO_LONG` as HTTP 400 with the
 * stable error code preserved. Min/max are optional — when absent we
 * skip the count check entirely.
 */

// ----------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------

const WordCountSchema = z
  .number()
  .int()
  .min(0)
  .max(50_000);

const RubricCriterionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Bounded weight — same range we use for AssignmentModule.weight so
  // the two stay consistent if a future rubric ever wants to share
  // numbers with the module weight column.
  weight: z.number().int().min(1).max(1000),
});

const WritingRubricSchema = z.object({
  criteria: z.array(RubricCriterionSchema).min(1).max(20),
});

export const WritingConfigSchema = z
  .object({
    prompt: z.string().trim().min(1).max(10_000),
    minWords: WordCountSchema.optional(),
    maxWords: WordCountSchema.optional(),
    rubric: WritingRubricSchema.optional(),
  })
  .strict()
  .refine(
    (cfg) =>
      cfg.minWords === undefined ||
      cfg.maxWords === undefined ||
      cfg.minWords <= cfg.maxWords,
    {
      message: 'minWords must be <= maxWords when both are provided',
      path: ['minWords'],
    },
  );

export type WritingConfig = z.infer<typeof WritingConfigSchema>;

const WritingAttachmentSchema = z.object({
  mediaId: z.string().uuid(),
});

export const WritingAnswerSchema = z
  .object({
    // 200k characters is comfortably above any reasonable essay; it
    // protects the DB Json column from pathological payloads while
    // still allowing long-form responses.
    text: z.string().max(200_000),
    attachments: z.array(WritingAttachmentSchema).max(10).optional(),
  })
  .strict();

export type WritingAnswer = z.infer<typeof WritingAnswerSchema>;

// ----------------------------------------------------------------------
// Word count helper
// ----------------------------------------------------------------------

/**
 * Conservative word counter — splits on Unicode whitespace and counts
 * non-empty tokens. We deliberately do NOT try to be locale-aware
 * (Chinese / Japanese have no spaces, etc.) because the writing module
 * is initially scoped to language-learning specialties (English, Russian,
 * Uzbek) where whitespace tokenisation is correct.
 *
 * Exported for testing.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  // `\p{Zs}` matches Unicode space separators; `\s` covers tabs/newlines.
  // Strip leading/trailing whitespace then split on runs of whitespace.
  const trimmed = text.replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

// ----------------------------------------------------------------------
// Runtime
// ----------------------------------------------------------------------

export class WritingRuntime
  implements HomeworkModuleRuntime<WritingConfig, WritingAnswer>
{
  readonly type: HomeworkModuleType = 'WRITING';

  /**
   * Parse `configJson` strictly. Throws `ZodError` on shape problems —
   * the controller layer turns that into a 400 with field-level detail.
   */
  validateConfig(configJson: unknown): WritingConfig {
    return WritingConfigSchema.parse(configJson);
  }

  /**
   * Parse the student answer slice and enforce word-count bounds when
   * the teacher set them on the config. Word-count violations surface
   * as `HomeworkRuntimeError` with code `ANSWER_TOO_SHORT` /
   * `ANSWER_TOO_LONG` so the controller layer can map them to an HTTP
   * 400 with a stable code.
   */
  validateAnswer(config: WritingConfig, answer: unknown): WritingAnswer {
    const parsed = WritingAnswerSchema.parse(answer);

    const wordCount = countWords(parsed.text);

    if (config.minWords !== undefined && wordCount < config.minWords) {
      throw new HomeworkRuntimeError(
        'ANSWER_TOO_SHORT',
        `Writing answer has ${wordCount} word(s); minimum is ${config.minWords}`,
        { wordCount, minWords: config.minWords },
      );
    }
    if (config.maxWords !== undefined && wordCount > config.maxWords) {
      throw new HomeworkRuntimeError(
        'ANSWER_TOO_LONG',
        `Writing answer has ${wordCount} word(s); maximum is ${config.maxWords}`,
        { wordCount, maxWords: config.maxWords },
      );
    }

    return parsed;
  }

  /**
   * Build the AI grading prompt skeleton. The shape mirrors
   * design.md `precheckWritingSubmission` — the AI gateway takes
   * `{ text, rubric, language }` and renders the
   * `writing.precheck.v1` template.
   */
  aiPromptInputs(
    config: WritingConfig,
    answer: WritingAnswer,
  ): AiPromptInputs {
    return {
      moduleType: this.type,
      studentText: answer.text,
      rubric: config.rubric?.criteria ?? [],
      metadata: {
        prompt: config.prompt,
        ...(config.minWords !== undefined && { minWords: config.minWords }),
        ...(config.maxWords !== undefined && { maxWords: config.maxWords }),
        wordCount: countWords(answer.text),
      },
    };
  }
}

/** Single shared instance — runtimes are stateless. */
export const writingRuntime = new WritingRuntime();
