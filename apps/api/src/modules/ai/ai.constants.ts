/**
 * AI Gateway constants — DI tokens, prompt-template keys, model
 * defaults, and policy thresholds.
 *
 * Why these live in a dedicated file:
 *   - Avoids `provide: Symbol(...)` literal duplication between the
 *     module wiring and consumer services.
 *   - Surfaces every magic threshold (similarity, AI-text flag, cost
 *     ratios) so they are auditable from one location.
 */

/**
 * Dependency-injection token for the primary AI provider adapter.
 * `AiModule` binds this to `AnthropicAdapter` in production and to
 * `FakeAdapter` in tests / when `AI_PROVIDER=mock`.
 */
export const AI_PRIMARY_PROVIDER = Symbol('AI_PRIMARY_PROVIDER');

/**
 * DI token for the optional fallback provider. When the primary
 * provider raises an `AiUpstreamError` (5xx / network) the gateway
 * retries the call against this adapter exactly once. Bound to
 * `OpenAiAdapter` by default; in test / mock mode the same adapter is
 * reused so retries are observable.
 */
export const AI_FALLBACK_PROVIDER = Symbol('AI_FALLBACK_PROVIDER');

/**
 * DI token for the prompt-template repository. The repository reads
 * `AiPromptTemplate` rows and falls back to a built-in default set
 * when the DB is empty (e.g. fresh dev environment, unit tests).
 */
export const AI_PROMPT_REPOSITORY = Symbol('AI_PROMPT_REPOSITORY');

/**
 * Built-in prompt template keys. Every key MUST also exist in the
 * defaults list (see `prompt-template.loader.ts`) so the gateway works
 * before the operator seeds `AiPromptTemplate` rows. The version
 * suffix lets ops roll templates forward without dropping audit
 * referential integrity (`AiCall.templateKey`).
 */
export const PROMPT_TEMPLATE_KEYS = {
  TUTOR_EXPLAIN: 'tutor.explain.v1',
  TUTOR_TRANSLATE: 'tutor.translate.v1',
  TUTOR_EXAMPLE: 'tutor.example.v1',
  TRANSLATE_WORD: 'reading.translate_word.v1',
  TRANSLATE_SENTENCE: 'reading.translate_sentence.v1',
  GRADE_PRECHECK: 'grade-precheck.v1',
  GRADE_RUBRIC_SUGGEST: 'grade-rubric-suggest.v1',
  AI_TEXT_DETECT: 'ai_text_detect.v1',
  SPECIALTY_CLASSIFY: 'specialty.classify.v1',
  AI_CHAT: 'ai.chat.v1',
  GENERATE_TEST: 'ai.generate_test.v1',
} as const;

/**
 * Legacy alias for the writing precheck template — the key was renamed
 * from `writing.precheck.v1` to `grade-precheck.v1` in Task 20.3 so it
 * matches the spec's prompt-template names. Kept exported for
 * backwards-compatibility with existing audit rows; new code should
 * use `PROMPT_TEMPLATE_KEYS.GRADE_PRECHECK`.
 */
export const LEGACY_WRITING_PRECHECK_KEY = 'writing.precheck.v1';

export type PromptTemplateKey =
  (typeof PROMPT_TEMPLATE_KEYS)[keyof typeof PROMPT_TEMPLATE_KEYS];

/**
 * Model-name → per-1k-token cost in USD. Numbers are pulled from
 * Anthropic / OpenAI public pricing as of the spec freeze and are
 * intentionally pessimistic (rounded up) so the operator never
 * under-counts spend. Keep this list narrow — adding a model here is a
 * deliberate ops decision.
 *
 * The map is exhaustive on the model names the adapters emit; the
 * cost calculator falls back to a conservative default when an unknown
 * name shows up (so an upstream version bump never crashes the
 * audit write).
 */
export const MODEL_PRICING_USD_PER_1K: Record<
  string,
  { input: number; output: number }
> = {
  'claude-3-5-sonnet-latest': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015 },
  'claude-3-5-haiku-latest': { input: 0.0008, output: 0.004 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  // Fake / test models — zero cost so unit tests never flake on rounding.
  'fake-primary': { input: 0, output: 0 },
  'fake-fallback': { input: 0, output: 0 },
};

/** Conservative default used when an unknown model name shows up. */
export const DEFAULT_PRICING = { input: 0.005, output: 0.02 };

/**
 * Cosine-similarity threshold above which a tutor reply is rewritten
 * as a hint instead of returned verbatim (Req 13.3, 13.6).
 */
export const TUTOR_SIMILARITY_THRESHOLD = 0.7;

/**
 * AI-text-detection threshold above which `Submission.aiFlagged`
 * flips to true. Req 13.8 and Task 20.3 both specify
 * `aiLikelihood >= 0.75`, so the platform-wide flag default is
 * `0.75`. The legacy alias `AI_LIKELIHOOD_REQ_138_THRESHOLD` is kept
 * exported so call sites that referenced the old "Req 13.8" name
 * continue to compile, but new code should use
 * `AI_LIKELIHOOD_FLAG_THRESHOLD`.
 */
export const AI_LIKELIHOOD_FLAG_THRESHOLD = 0.75;
export const AI_LIKELIHOOD_REQ_138_THRESHOLD = AI_LIKELIHOOD_FLAG_THRESHOLD;

/**
 * Default per-user rate-limit window — Req 13.5 ("60 calls / 10 min").
 * The actual values come from the env (`AI_RATE_LIMIT_*`); these are
 * the safety-net constants used when the env is missing.
 */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_RATE_LIMIT_MAX_CALLS = 60;

/**
 * Status values written to `AiCall.status`. Strings are kept short so
 * the operator can read them in psql without a join.
 */
export const AI_CALL_STATUS = {
  OK: 'OK',
  ERROR: 'ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
} as const;

export type AiCallStatus =
  (typeof AI_CALL_STATUS)[keyof typeof AI_CALL_STATUS];
