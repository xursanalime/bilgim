/**
 * AI Gateway public types.
 *
 * These are the shapes exposed by `AiGatewayService` to the rest of
 * the API (homework, reading runtime, onboarding, etc.). Adapter-level
 * types (token usage, raw provider responses) live in
 * `adapters/types.ts` and never leak past `AiGatewayService`.
 */

import type { AiIntent } from '@prisma/client';

import type { AiCallStatus } from './ai.constants';

// ===================================================================
// Tutor mode — English-learning intents (Req 8.1, 8.2, 8.3)
// ===================================================================

/**
 * The English-teaching tutor intent set. After the English-only
 * refocus (Req 8.1) the tutor supports exactly these three intents:
 *   - EXPLAIN   — explain a rule / concept in English-learning terms
 *   - TRANSLATE — translate between the learner's locale and English
 *   - EXAMPLE   — produce an analogous example on a *different* topic
 * No subject-classification intent exists (Req 8.5).
 */
export type TutorIntent = 'EXPLAIN' | 'TRANSLATE' | 'EXAMPLE';
export interface TutorInput {
  /** STUDENT user id — used for rate-limiting and audit. */
  userId: string;
  intent: TutorIntent;
  /** Read-only context (e.g. a slice of the student's submission). */
  contextText?: string;
  /** The student's question / request. Must be non-empty. */
  question: string;
  locale: 'uz' | 'ru' | 'en';
  /**
   * Optional submission id used for audit `refType=submission` rows
   * and for the "compare reply against active submission" similarity
   * check. When omitted the gateway compares against `contextText`.
   */
  submissionId?: string;
}

export interface TutorOutput {
  /**
   * Final reply that is safe to show to the student. If the raw model
   * output failed the policy check, this is the rewritten hint.
   */
  reply: string;
  /**
   * Per-call policy assertions surfaced for the controller / UI.
   * `noFullAnswer` is `true` when similarity was below the threshold
   * AND the rewrite path was not taken; otherwise the controller can
   * surface a "rephrased as hint" badge.
   */
  policyChecks: {
    noFullAnswer: boolean;
    rewroteAsHint: boolean;
    similarity: number;
    reason?: string;
  };
}

// ===================================================================
// Tutor sub-intent inputs (Task 20.2 — dedicated endpoints)
// ===================================================================

/**
 * Inputs accepted by `tutorExplain`. Mirrors the `/ai/tutor/explain`
 * controller body. The `submissionText` field is the server-side text
 * loaded from the active submission — populated by the
 * `AiTutorPolicyGuard` rather than the client — and is used for the
 * cosine-similarity post-filter.
 */
export interface TutorExplainInput {
  userId: string;
  question: string;
  contextText?: string;
  locale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  submissionText?: string;
  /**
   * Optional active assignment id. Forwarded through the gateway so
   * the audit row links the call to the assignment for cost reports.
   */
  assignmentId?: string;
}

export interface TutorTranslateInput {
  userId: string;
  text: string;
  sourceLocale: 'uz' | 'ru' | 'en';
  targetLocale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  submissionText?: string;
  assignmentId?: string;
}

export interface TutorTranslateOutput {
  /** Final translated text. */
  translation: string;
  /** Whether the response was served from the Redis cache. */
  cached: boolean;
}

export interface TutorExampleInput {
  userId: string;
  question: string;
  contextText?: string;
  locale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  submissionText?: string;
  assignmentId?: string;
}

// ===================================================================
// Translate (reading module helpers)
// ===================================================================

export interface TranslateWordInput {
  userId: string;
  word: string;
  /** Surrounding sentence — the translator uses this to disambiguate. */
  contextSentence: string;
  locale: 'uz' | 'ru' | 'en';
}

export interface TranslateWordOutput {
  translation: string;
  partOfSpeech?: string;
  examples: string[];
  note?: string;
}

export interface TranslateSentenceInput {
  userId: string;
  sentence: string;
  locale: 'uz' | 'ru' | 'en';
}

export interface TranslateSentenceOutput {
  translation: string;
  /** Optional per-word lookup the UI can render as tooltips. */
  glossary?: Array<{ source: string; target: string }>;
}

// ===================================================================
// Grading + AI text detection (Req 13.7, 13.8)
// ===================================================================

export interface PrecheckInput {
  userId: string;
  submissionId: string;
  text: string;
  rubric?: string;
  language?: 'uz' | 'ru' | 'en';
}

export interface PrecheckOutput {
  /** 0..1 — adapter's score for the submission. */
  score: number;
  /** Free-form summary the teacher will see. */
  summary: string;
  highlights: Array<{
    from: number;
    to: number;
    severity: 'info' | 'warning' | 'error';
    reason: string;
  }>;
  aiLikelihood: number;
  /** Whether `aiLikelihood >= AI_LIKELIHOOD_FLAG_THRESHOLD`. */
  aiFlagged: boolean;
}

export interface AiTextDetectInput {
  userId?: string;
  text: string;
}

export interface AiTextDetectOutput {
  likelihood: number;
  signals: string[];
}

// ===================================================================
// Rubric suggestion (Task 20.3 — `/ai/grading/suggest-rubric`)
// ===================================================================

/**
 * Per-module slice of a student submission used as input to
 * `suggestRubric`. The gateway forwards this verbatim to the prompt
 * template; the homework controller decides which slices to include
 * (typically the WRITING / READING modules — short-answer modules can
 * be auto-scored by the runtime without AI help).
 */
export interface RubricSubmissionModule {
  moduleId: string;
  /** HomeworkModuleType — passed through as-is to the model. */
  type: string;
  /** Free-form student answer text (or rendered JSON for opaque slices). */
  studentText: string;
}

export interface SuggestRubricInput {
  userId: string;
  /** Submission id used for audit `refType=submission`, `refId`. */
  submissionId: string;
  /** Assignment description shown to the teacher when authoring it. */
  assignmentDescription: string;
  /** Per-module submission slices the teacher cares about. */
  modules: RubricSubmissionModule[];
  language?: 'uz' | 'ru' | 'en';
}

export interface SuggestedRubricEntry {
  moduleId: string;
  type: string;
  /** 0..1 — clamped suggestion. */
  score: number;
  comment: string;
}

export interface SuggestRubricOutput {
  modules: SuggestedRubricEntry[];
  summary: string;
}

// ===================================================================
// (removed) Specialty classification
// -------------------------------------------------------------------
// The generic multi-specialty `SPECIALTY_CLASSIFY` intent was retired
// when the platform refocused on English-only learning (Req 8.5). The
// onboarding flow no longer classifies a teacher into a subject — every
// instructor teaches English — so the gateway intentionally exposes no
// `classifySpecialty` surface. The matching `AiIntent` enum value is
// kept in the database for historical audit rows (non-destructive
// refocus) but is rejected by the gateway and prompt-template loader.
// ===================================================================

// ===================================================================
// Audit (`AiCall` row shape used by the gateway service)
// ===================================================================

/**
 * Subset of `AiCall` columns the gateway writes. Stays in sync with
 * the Prisma model — adding a column here also requires a schema
 * migration.
 */
export interface AiCallAuditRow {
  userId: string | null;
  intent: AiIntent;
  templateKey: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  refType: string | null;
  refId: string | null;
  status: AiCallStatus;
  errorMsg: string | null;
}

// ===================================================================
// AI Chat (general assistant for students and teachers)
// ===================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatInput {
  userId: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  message: string;
  history?: ChatMessage[] | undefined;
  locale: 'uz' | 'ru' | 'en';
  context?: string | undefined;
}

export interface AiChatOutput {
  reply: string;
  intent?: string;
}

// ===================================================================
// Test / Quiz generation from lesson materials
// ===================================================================

export interface GenerateTestQuestion {
  type: 'mcq' | 'true_false' | 'short';
  prompt: string;
  choices?: string[] | undefined;
  answer: string | string[];
  explanation?: string | undefined;
}

export interface GenerateTestInput {
  userId: string;
  content: string;
  questionCount: number;
  types: Array<'mcq' | 'true_false' | 'short'>;
  difficulty: 'easy' | 'medium' | 'hard';
  locale: 'uz' | 'ru' | 'en';
  topic?: string | undefined;
}

export interface GenerateTestOutput {
  questions: GenerateTestQuestion[];
  topic: string;
  difficulty: string;
}

// ===================================================================
// Public gateway port (consumed by other modules — homework etc.)
// ===================================================================

/**
 * `AiGateway` is the SINGLE entry point other modules use for AI
 * calls. Direct adapter access from outside `AiModule` is forbidden
 * (Req 13.x — central enforcement of policy + rate limit + audit).
 */
export interface AiGateway {
  tutor(input: TutorInput): Promise<TutorOutput>;
  tutorExplain(input: TutorExplainInput): Promise<TutorOutput>;
  tutorTranslate(input: TutorTranslateInput): Promise<TutorTranslateOutput>;
  tutorExample(input: TutorExampleInput): Promise<TutorOutput>;
  translateWord(input: TranslateWordInput): Promise<TranslateWordOutput>;
  translateSentence(input: TranslateSentenceInput): Promise<TranslateSentenceOutput>;
  precheckWritingSubmission(input: PrecheckInput): Promise<PrecheckOutput>;
  detectAiText(input: AiTextDetectInput): Promise<AiTextDetectOutput>;
  suggestRubric(input: SuggestRubricInput): Promise<SuggestRubricOutput>;
  chat(input: AiChatInput): Promise<AiChatOutput>;
  generateTest(input: GenerateTestInput): Promise<GenerateTestOutput>;
}

export const AI_GATEWAY = Symbol('AI_GATEWAY');
