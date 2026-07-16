/**
 * AI Tutor mode DTOs (Task 20.2).
 *
 * Three endpoints — `explain`, `translate`, `example` — share the same
 * envelope (locale + optional submissionId for similarity grounding)
 * but each carries its own intent-specific fields. Keeping them
 * separate makes the controller surface self-documenting and lets the
 * Zod schema validate the right field bag per endpoint.
 */
import { z } from 'zod';

import { LocaleSchema } from './index';

/** Common fields every tutor request shares. */
const TutorBaseSchema = z.object({
  /** Optional ID of the student's active submission. The `AiTutorPolicy`
   *  guard uses it to strip submission text from the prompt and the
   *  gateway uses it as the similarity-comparison source. */
  submissionId: z.string().uuid().optional(),
  /**
   * Optional ID of the active assignment. When present, `TutorService`
   * loads the assignment + lesson context and refuses requests that ask
   * for a verbatim answer (Req 13.6). The field is independent from
   * `submissionId` because the student may ask for help BEFORE creating
   * a draft submission.
   */
  assignmentId: z.string().uuid().optional(),
  /**
   * Optional opaque id chosen by the client to thread multi-turn
   * "chat-style" tutor sessions. When present, `TutorService` loads up
   * to 10 previous turns from Redis (1h TTL, FIFO eviction) and folds
   * them into the prompt so the model sees the on-going conversation.
   * UUIDs / nanoids are accepted; we cap at 64 chars to bound the
   * cache-key length.
   */
  conversationId: z.string().min(1).max(64).optional(),
  locale: LocaleSchema.default('uz'),
});

// ===================================================================
// /ai/tutor/explain
// ===================================================================

export const TutorExplainRequestSchema = TutorBaseSchema.extend({
  /** The student's "explain me X" question. */
  question: z.string().trim().min(1).max(4_000),
  /**
   * Optional read-only context the student wants explained — e.g. a
   * passage from the lesson. NEVER use this to embed an answer; the
   * `AiTutorPolicy` guard will strip submission text before the LLM
   * call, but callers should treat this field as paraphrased
   * supplementary context only.
   */
  contextText: z.string().max(40_000).optional(),
});
export type TutorExplainRequestDto = z.infer<typeof TutorExplainRequestSchema>;

// ===================================================================
// /ai/tutor/translate
// ===================================================================

/**
 * Translation directions allowed across uz / ru / en. The gateway uses
 * the pair to render the right system prompt — the LLM is told what to
 * translate FROM and TO so it can preserve idiom and tone.
 */
export const TranslateLocaleSchema = z.enum(['uz', 'ru', 'en']);

export const TutorTranslateRequestSchema = TutorBaseSchema.extend({
  /** Text to translate. Up to 4 000 chars to cover a paragraph. */
  text: z.string().trim().min(1).max(4_000),
  /** Source locale — the language of `text`. */
  sourceLocale: TranslateLocaleSchema,
  /** Target locale — the language we translate INTO. Must differ from source. */
  targetLocale: TranslateLocaleSchema,
}).refine((value) => value.sourceLocale !== value.targetLocale, {
  message: 'sourceLocale and targetLocale must differ',
  path: ['targetLocale'],
});
export type TutorTranslateRequestDto = z.infer<
  typeof TutorTranslateRequestSchema
>;

// ===================================================================
// /ai/tutor/example
// ===================================================================

export const TutorExampleRequestSchema = TutorBaseSchema.extend({
  /** What the student wants an analogous example of. */
  question: z.string().trim().min(1).max(4_000),
  /**
   * Optional read-only context — e.g. the rule the student is
   * studying. The example MUST use different numbers/wording than
   * anything in this context.
   */
  contextText: z.string().max(40_000).optional(),
});
export type TutorExampleRequestDto = z.infer<typeof TutorExampleRequestSchema>;
