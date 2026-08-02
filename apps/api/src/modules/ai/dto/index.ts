/**
 * AI Gateway DTO schemas (Zod). The controller uses
 * `ZodValidationPipe` so every body / query parameter is parsed into a
 * typed object before it reaches the service. Keeping the schemas
 * small and explicit keeps the public surface easy to audit.
 */
import { z } from 'zod';

export const TutorIntentSchema = z.enum(['EXPLAIN', 'TRANSLATE', 'EXAMPLE']);

export const LocaleSchema = z.enum(['uz', 'ru', 'en']);

export const TutorRequestSchema = z.object({
  intent: TutorIntentSchema,
  question: z.string().trim().min(1).max(4_000),
  contextText: z.string().max(40_000).optional(),
  locale: LocaleSchema.default('uz'),
  submissionId: z.string().uuid().optional(),
});
export type TutorRequestDto = z.infer<typeof TutorRequestSchema>;

export const TranslateWordRequestSchema = z.object({
  word: z.string().trim().min(1).max(120),
  contextSentence: z.string().max(2_000).default(''),
  locale: LocaleSchema.default('uz'),
});
export type TranslateWordRequestDto = z.infer<typeof TranslateWordRequestSchema>;

export const TranslateSentenceRequestSchema = z.object({
  sentence: z.string().trim().min(1).max(4_000),
  locale: LocaleSchema.default('uz'),
});
export type TranslateSentenceRequestDto = z.infer<
  typeof TranslateSentenceRequestSchema
>;

export const PrecheckRequestSchema = z.object({
  submissionId: z.string().uuid(),
  text: z.string().min(1).max(40_000),
  rubric: z.string().max(8_000).optional(),
  language: LocaleSchema.optional(),
});
export type PrecheckRequestDto = z.infer<typeof PrecheckRequestSchema>;

/**
 * `POST /ai/detect-ai-text` — Task 20.3.
 *
 * Accepts a text body (typically the student's writing answer) and
 * returns `{ likelihood, flagged }`. The endpoint is rate-limited and
 * audited by the AI Gateway pipeline; it is NOT a destructive action,
 * the caller decides what to do with the result.
 */
export const DetectAiTextRequestSchema = z.object({
  text: z.string().min(1).max(40_000),
});
export type DetectAiTextRequestDto = z.infer<typeof DetectAiTextRequestSchema>;

export const AiUsageQuerySchema = z.object({
  /** Optional ISO date — limits the report window. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Optional userId — admin-only filter. */
  userId: z.string().uuid().optional(),
});
export type AiUsageQueryDto = z.infer<typeof AiUsageQuerySchema>;

// Re-export the per-endpoint tutor DTOs (Task 20.2). The original
// `TutorRequestSchema` above remains the public surface for the legacy
// `POST /ai/tutor` route; the new schemas back the dedicated
// /ai/tutor/{explain,translate,example} routes.
export {
  TutorExplainRequestSchema,
  type TutorExplainRequestDto,
  TutorTranslateRequestSchema,
  type TutorTranslateRequestDto,
  TranslateLocaleSchema,
  TutorExampleRequestSchema,
  type TutorExampleRequestDto,
} from './tutor.dto';
