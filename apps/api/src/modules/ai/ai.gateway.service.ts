/**
 * AiGatewayService — single source of truth for outbound AI traffic.
 *
 * Pipeline for every call:
 *   1. Resolve the prompt template (`PromptTemplateLoader`).
 *   2. Render `system` + `user` prompts from the variable bag.
 *   3. Enforce per-user rate limit (`AiRateLimiterService`,
 *      Req 13.5 — 60 calls / 10 min).
 *   4. Invoke the primary adapter; on `AiUpstreamError` retry once
 *      against the fallback adapter (Anthropic → OpenAI). 429 is
 *      surfaced verbatim — falling back on rate limit would just
 *      shuffle the bill onto the wrong provider.
 *   5. For tutor intents: post-filter the reply against the student's
 *      active context (cosine similarity threshold 0.7, Req 13.3) and
 *      rewrite as a hint when the threshold is breached
 *      (Req 13.6 — never produce a complete answer).
 *   6. Compute USD cost (`computeCostUsd`) and write one `AiCall` row
 *      via `AiAuditService` (Req 13.4).
 *   7. Return the typed output to the caller.
 *
 * Intent dispatcher:
 *   The public API exposes a method per business intent (`tutor`,
 *   `translateWord`, …). Internally `dispatchIntent` centralises
 *   step 1–4 + 6, and per-intent helpers handle the parsing /
 *   policy work specific to that surface.
 *
 * Why one giant service instead of per-intent services:
 *   The platform-level invariants (rate limit, audit, fallback) MUST
 *   apply to every intent — splitting this into multiple services
 *   would force duplication of the audit + rate-limit code or a
 *   fragile inheritance hierarchy. Keeping a single dispatcher makes
 *   the rules auditable from one file.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiIntent } from '@prisma/client';
import { createHash } from 'crypto';

import {
  AI_CALL_STATUS,
  AI_FALLBACK_PROVIDER,
  AI_LIKELIHOOD_FLAG_THRESHOLD,
  AI_PRIMARY_PROVIDER,
  PROMPT_TEMPLATE_KEYS,
  PromptTemplateKey,
  REMOVED_AI_INTENTS,
  TUTOR_SIMILARITY_THRESHOLD,
  type AiCallStatus,
} from './ai.constants';
import { AiAuditService } from './ai-audit.service';
import {
  AiRateLimitedError,
  AiTemplateNotFoundError,
  AiUpstreamError,
} from './ai.errors';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import {
  PromptTemplateLoader,
  ResolvedPromptTemplate,
} from './prompt-template.loader';
import { computeCostUsd } from './cost-calculator';
import {
  cosineSimilarity,
  longestCommonSubstringRatio,
} from './policy/similarity';
import { RedisService } from '../../infra/redis/redis.service';
import { AI_TUTOR_SYSTEM_SUFFIX } from './policy/ai-tutor.policy.guard';
import type { AiAdapter, AiAdapterResponse } from './adapters/types';
import type {
  AiCallAuditRow,
  AiGateway,
  AiTextDetectInput,
  AiTextDetectOutput,
  PrecheckInput,
  PrecheckOutput,
  SuggestRubricInput,
  SuggestRubricOutput,
  SuggestedRubricEntry,
  TranslateSentenceInput,
  TranslateSentenceOutput,
  TranslateWordInput,
  TranslateWordOutput,
  TutorExampleInput,
  TutorExplainInput,
  TutorInput,
  TutorOutput,
  TutorTranslateInput,
  TutorTranslateOutput,
  AiChatInput,
  AiChatOutput,
  GenerateTestInput,
  GenerateTestOutput,
  GenerateTestQuestion,
} from './ai.types';

interface DispatchOptions {
  userId: string | null;
  /** Bucket key for the rate limiter — typically `user:<id>`. */
  rateLimitSubject: string | null;
  intent: AiIntent;
  templateKey: PromptTemplateKey;
  vars: Record<string, unknown>;
  /** Audit ref columns. */
  refType?: string;
  refId?: string;
  /** Override max tokens (otherwise template's value is used). */
  maxTokens?: number;
  /** Force JSON mode on the adapter request. */
  jsonMode?: boolean;
  /**
   * Extra system-prompt text appended after the template's
   * `systemText`. Used by the tutor pipeline to inject the no-completion
   * hard rules without mutating the stored template.
   */
  systemSuffix?: string;
}

interface DispatchResult {
  template: ResolvedPromptTemplate;
  response: AiAdapterResponse;
  /** Provider that actually served the request. */
  providerName: string;
  /** Number of attempts made (1 = primary only, 2 = primary failed, fallback won). */
  attempts: number;
}

@Injectable()
export class AiGatewayService implements AiGateway {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly templateLoader: PromptTemplateLoader,
    private readonly rateLimiter: AiRateLimiterService,
    private readonly audit: AiAuditService,
    @Inject(AI_PRIMARY_PROVIDER) private readonly primary: AiAdapter,
    @Inject(AI_FALLBACK_PROVIDER) private readonly fallback: AiAdapter,
    @Optional() private readonly redis?: RedisService,
  ) {}

  // ===================================================================
  // Public AiGateway surface
  // ===================================================================

  async tutor(input: TutorInput): Promise<TutorOutput> {
    if (!input.question || input.question.trim().length === 0) {
      throw new Error('TutorInput.question must be non-empty');
    }
    const templateKey = TUTOR_TEMPLATE_BY_INTENT[input.intent];
    const intent = TUTOR_PRISMA_INTENT[input.intent];

    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent,
      templateKey,
      vars: {
        question: input.question,
        contextText: input.contextText ?? '',
        locale: input.locale,
      },
      ...(input.submissionId !== undefined
        ? { refType: 'submission', refId: input.submissionId }
        : {}),
      systemSuffix: TUTOR_HARD_RULES,
    });

    // Policy enforcement (Req 13.3, 13.6).
    const compareAgainst = input.contextText ?? '';
    const similarity = cosineSimilarity(dispatch.response.text, compareAgainst);
    const lcsRatio = longestCommonSubstringRatio(
      dispatch.response.text,
      compareAgainst,
    );
    const tooSimilar =
      similarity >= TUTOR_SIMILARITY_THRESHOLD || lcsRatio >= 0.5;

    let reply = dispatch.response.text;
    let rewroteAsHint = false;
    if (tooSimilar) {
      reply = rephraseAsHint(reply);
      rewroteAsHint = true;
      this.logger.warn(
        `AiGatewayService.tutor: reply too similar (cos=${similarity.toFixed(3)}, lcs=${lcsRatio.toFixed(3)}); rewriting as hint`,
      );
    }

    const policyOk = !tooSimilar;
    const status: AiCallStatus = policyOk
      ? AI_CALL_STATUS.OK
      : AI_CALL_STATUS.POLICY_BLOCKED;

    await this.recordAudit({
      userId: input.userId,
      intent,
      template: dispatch.template,
      response: dispatch.response,
      status,
      errorMsg: rewroteAsHint
        ? 'similarity threshold breached; reply rewritten as hint'
        : null,
      ...(input.submissionId !== undefined
        ? { refType: 'submission', refId: input.submissionId }
        : {}),
    });

    return {
      reply,
      policyChecks: {
        noFullAnswer: policyOk,
        rewroteAsHint,
        similarity,
        ...(rewroteAsHint
          ? { reason: 'reply too similar to active submission' }
          : {}),
      },
    };
  }

  // -----------------------------------------------------------------
  // Tutor sub-intent helpers (Task 20.2)
  // -----------------------------------------------------------------

  /**
   * `POST /ai/tutor/explain` — Socratic tutor that explains concepts.
   * Delegates to the shared tutor pipeline so the no-completion policy
   * (Req 13.6, Property 4) and audit trail (Req 13.4) stay centralised.
   * The `submissionText` field, when present, is the server-side text
   * loaded by the `AiTutorPolicyGuard`; we use it as the
   * similarity-comparison source so the post-filter sees the real
   * student answer rather than a client-supplied preview.
   */
  async tutorExplain(input: TutorExplainInput): Promise<TutorOutput> {
    return this.tutor({
      userId: input.userId,
      intent: 'EXPLAIN',
      question: input.question,
      ...(input.contextText !== undefined
        ? { contextText: input.contextText }
        : {}),
      // Fold the verified submission text into contextText so the
      // similarity post-filter compares against it.
      ...(input.submissionText
        ? { contextText: this.mergeContext(input.contextText, input.submissionText) }
        : {}),
      locale: input.locale,
      ...(input.submissionId !== undefined
        ? { submissionId: input.submissionId }
        : {}),
    });
  }

  /**
   * `POST /ai/tutor/translate` — translation helper with Redis cache.
   *
   * Cache key: `ai:tutor:translate:{sha256(source|target|text)}` TTL 7d.
   * The cache is content-addressable so two identical translation
   * requests (same source/target/text) reuse the same row regardless
   * of which student or session asked for it. We never cache
   * empty or whitespace-only outputs to avoid poisoning the cache when
   * the upstream model returns nothing.
   */
  async tutorTranslate(
    input: TutorTranslateInput,
  ): Promise<TutorTranslateOutput> {
    if (!input.text || input.text.trim().length === 0) {
      throw new Error('TutorTranslateInput.text must be non-empty');
    }
    if (input.sourceLocale === input.targetLocale) {
      throw new Error(
        'TutorTranslateInput.sourceLocale and targetLocale must differ',
      );
    }

    const cacheKey = buildTranslateCacheKey(
      input.sourceLocale,
      input.targetLocale,
      input.text,
    );

    // Cache hit — return immediately, skipping rate limiter, audit and
    // adapter. The translate intent is read-only by design (no
    // submission impact) so reusing a hot value is safe.
    const cached = await this.tryReadTranslateCache(cacheKey);
    if (cached !== null) {
      return { translation: cached, cached: true };
    }

    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: 'TUTOR_TRANSLATE',
      templateKey: PROMPT_TEMPLATE_KEYS.TUTOR_TRANSLATE,
      vars: {
        question: input.text,
        // The default tutor.translate template renders `{{locale}}` —
        // we pass the target so the LLM knows what to translate into.
        locale: input.targetLocale,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
      },
      systemSuffix: AI_TUTOR_SYSTEM_SUFFIX,
      ...(input.submissionId !== undefined
        ? { refType: 'submission', refId: input.submissionId }
        : {}),
    });

    const translation = dispatch.response.text.trim();

    await this.recordAudit({
      userId: input.userId,
      intent: 'TUTOR_TRANSLATE',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      ...(input.submissionId !== undefined
        ? { refType: 'submission', refId: input.submissionId }
        : { refType: 'translate', refId: cacheKey.replace(/^ai:tutor:translate:/, '') }),
    });

    if (translation.length > 0) {
      await this.tryWriteTranslateCache(cacheKey, translation);
    }

    return { translation, cached: false };
  }

  /**
   * `POST /ai/tutor/example` — generates an analogous practice example.
   * Reuses the shared tutor pipeline (intent=EXAMPLE) so the
   * no-completion policy still applies — the example MUST use different
   * numbers/wording than the student's active task.
   */
  async tutorExample(input: TutorExampleInput): Promise<TutorOutput> {
    return this.tutor({
      userId: input.userId,
      intent: 'EXAMPLE',
      question: input.question,
      ...(input.contextText !== undefined
        ? { contextText: input.contextText }
        : {}),
      ...(input.submissionText
        ? { contextText: this.mergeContext(input.contextText, input.submissionText) }
        : {}),
      locale: input.locale,
      ...(input.submissionId !== undefined
        ? { submissionId: input.submissionId }
        : {}),
    });
  }

  // -----------------------------------------------------------------
  // Translate cache helpers
  // -----------------------------------------------------------------

  private async tryReadTranslateCache(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      return raw ?? null;
    } catch (error) {
      this.logger.warn(
        `tutorTranslate: cache read failed for ${key}: ${(error as Error).message}; treating as miss`,
      );
      return null;
    }
  }

  private async tryWriteTranslateCache(
    key: string,
    value: string,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, value, TRANSLATE_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `tutorTranslate: cache write failed for ${key}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Merge an optional caller-supplied `contextText` with the verified
   * submission text. We keep the submission text on a separate line so
   * the similarity calculation sees both signals — caller paraphrase
   * AND server-loaded submission — without conflating them in the
   * model prompt.
   */
  private mergeContext(
    contextText: string | undefined,
    submissionText: string,
  ): string {
    if (!contextText) return submissionText;
    if (contextText.includes(submissionText)) return contextText;
    return `${contextText}\n\n${submissionText}`;
  }

  async translateWord(input: TranslateWordInput): Promise<TranslateWordOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: 'TUTOR_TRANSLATE',
      templateKey: PROMPT_TEMPLATE_KEYS.TRANSLATE_WORD,
      vars: {
        word: input.word,
        contextSentence: input.contextSentence,
        locale: input.locale,
      },
      jsonMode: true,
    });

    const parsed = parseJsonStrict<TranslateWordOutput>(
      dispatch.response.text,
      {
        translation: '',
        examples: [],
      },
    );
    await this.recordAudit({
      userId: input.userId,
      intent: 'TUTOR_TRANSLATE',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      refType: 'word',
      refId: hashRefKey(`${input.locale}:${input.word}`),
    });
    return {
      translation: parsed.translation ?? '',
      ...(parsed.partOfSpeech ? { partOfSpeech: parsed.partOfSpeech } : {}),
      examples: parsed.examples ?? [],
      ...(parsed.note ? { note: parsed.note } : {}),
    };
  }

  async translateSentence(
    input: TranslateSentenceInput,
  ): Promise<TranslateSentenceOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: 'TUTOR_TRANSLATE',
      templateKey: PROMPT_TEMPLATE_KEYS.TRANSLATE_SENTENCE,
      vars: {
        sentence: input.sentence,
        locale: input.locale,
      },
      jsonMode: true,
    });

    const parsed = parseJsonStrict<TranslateSentenceOutput>(
      dispatch.response.text,
      {
        translation: '',
      },
    );
    await this.recordAudit({
      userId: input.userId,
      intent: 'TUTOR_TRANSLATE',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      refType: 'sentence',
      refId: hashRefKey(`${input.locale}:${input.sentence}`),
    });
    return {
      translation: parsed.translation ?? '',
      ...(parsed.glossary && parsed.glossary.length > 0
        ? { glossary: parsed.glossary }
        : {}),
    };
  }

  async precheckWritingSubmission(
    input: PrecheckInput,
  ): Promise<PrecheckOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: 'GRADE_PRECHECK',
      templateKey: PROMPT_TEMPLATE_KEYS.GRADE_PRECHECK,
      vars: {
        text: input.text,
        rubric: input.rubric ?? '',
        language: input.language ?? 'en',
      },
      jsonMode: true,
      refType: 'submission',
      refId: input.submissionId,
    });

    const parsed = parseJsonStrict<{
      score?: number;
      summary?: string;
      highlights?: PrecheckOutput['highlights'];
    }>(dispatch.response.text, {
      score: 0,
      summary: '',
      highlights: [],
    });

    // We don't run AI-text detection inline — the caller (homework
    // module) drives that on its own slice of the submission text via
    // `detectAiText`. Returning 0 keeps the response shape stable.
    await this.recordAudit({
      userId: input.userId,
      intent: 'GRADE_PRECHECK',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      refType: 'submission',
      refId: input.submissionId,
    });

    const aiLikelihood = 0;
    return {
      score: clamp01(parsed.score ?? 0),
      summary: parsed.summary ?? '',
      highlights: parsed.highlights ?? [],
      aiLikelihood,
      aiFlagged: aiLikelihood >= AI_LIKELIHOOD_FLAG_THRESHOLD,
    };
  }

  async detectAiText(input: AiTextDetectInput): Promise<AiTextDetectOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId ?? null,
      rateLimitSubject: input.userId ? `user:${input.userId}` : null,
      intent: 'AI_TEXT_DETECT',
      templateKey: PROMPT_TEMPLATE_KEYS.AI_TEXT_DETECT,
      vars: { text: input.text },
      jsonMode: true,
      refType: 'text',
      refId: hashRefKey(input.text),
    });
    const parsed = parseJsonStrict<AiTextDetectOutput>(dispatch.response.text, {
      likelihood: 0,
      signals: [],
    });
    await this.recordAudit({
      userId: input.userId ?? null,
      intent: 'AI_TEXT_DETECT',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      refType: 'text',
      refId: hashRefKey(input.text),
    });
    return {
      likelihood: clamp01(parsed.likelihood ?? 0),
      signals: parsed.signals ?? [],
    };
  }

  /**
   * `suggestRubric` — backs `POST /ai/grading/suggest-rubric`
   * (Task 20.3). Accepts the assignment description plus a per-module
   * snapshot of the student submission and asks the model for a
   * scoring suggestion the teacher can accept or override.
   *
   * The output is intentionally limited to numeric scores + short
   * comments — the gateway never produces a corrected version of the
   * student's text (Req 13.6). Each module's `score` is clamped into
   * `[0, 1]` before being returned to the caller.
   */
  async suggestRubric(
    input: SuggestRubricInput,
  ): Promise<SuggestRubricOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: 'GRADE_PRECHECK',
      templateKey: PROMPT_TEMPLATE_KEYS.GRADE_RUBRIC_SUGGEST,
      vars: {
        assignmentDescription: input.assignmentDescription,
        submissionJson: JSON.stringify(input.modules ?? []),
        language: input.language ?? 'en',
      },
      jsonMode: true,
      refType: 'submission',
      refId: input.submissionId,
    });

    const parsed = parseJsonStrict<{
      modules?: SuggestedRubricEntry[];
      summary?: string;
    }>(dispatch.response.text, {
      modules: [],
      summary: '',
    });

    await this.recordAudit({
      userId: input.userId,
      intent: 'GRADE_PRECHECK',
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
      refType: 'submission',
      refId: input.submissionId,
    });

    const modules: SuggestedRubricEntry[] = (parsed.modules ?? []).map((m) => ({
      moduleId: String(m.moduleId ?? ''),
      type: String(m.type ?? ''),
      score: clamp01(Number(m.score ?? 0)),
      comment: String(m.comment ?? ''),
    }));

    return {
      modules,
      summary: parsed.summary ?? '',
    };
  }

  // ===================================================================
  // AI Chat — general assistant for students and teachers
  // ===================================================================

  async chat(input: AiChatInput): Promise<AiChatOutput> {
    const historyText = (input.history ?? [])
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: AiIntent.AI_CHAT,
      templateKey: PROMPT_TEMPLATE_KEYS.AI_CHAT,
      vars: {
        role: input.role,
        locale: input.locale,
        message: input.message,
        context: input.context ?? '',
        history: historyText,
      },
    });

    await this.recordAudit({
      userId: input.userId,
      intent: AiIntent.AI_CHAT,
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
    });

    return { reply: dispatch.response.text };
  }

  // ===================================================================
  // Generate Test — create quiz questions from lesson materials
  // ===================================================================

  async generateTest(input: GenerateTestInput): Promise<GenerateTestOutput> {
    const dispatch = await this.dispatchIntent({
      userId: input.userId,
      rateLimitSubject: `user:${input.userId}`,
      intent: AiIntent.GENERATE_TEST,
      templateKey: PROMPT_TEMPLATE_KEYS.GENERATE_TEST,
      vars: {
        content: input.content.slice(0, 8000),
        questionCount: input.questionCount,
        types: input.types.join(', '),
        difficulty: input.difficulty,
        locale: input.locale,
        topic: input.topic ?? '',
      },
      jsonMode: true,
      maxTokens: 3000,
    });

    await this.recordAudit({
      userId: input.userId,
      intent: AiIntent.GENERATE_TEST,
      template: dispatch.template,
      response: dispatch.response,
      status: AI_CALL_STATUS.OK,
    });

    const parsed = parseJsonStrict<{
      questions?: GenerateTestQuestion[];
      topic?: string;
      difficulty?: string;
    }>(dispatch.response.text, { questions: [], topic: '', difficulty: '' });

    const VALID_TYPES = ['mcq', 'true_false', 'short'] as const;
    const questions: GenerateTestQuestion[] = (parsed.questions ?? []).map((q) => {
      const rawType = q.type as string;
      const type = (VALID_TYPES as readonly string[]).includes(rawType)
        ? (rawType as (typeof VALID_TYPES)[number])
        : 'mcq';
      return {
        type,
        prompt: String(q.prompt ?? ''),
        choices: Array.isArray(q.choices) ? q.choices.map(String) : undefined,
        answer: q.answer ?? '',
        explanation: q.explanation ? String(q.explanation) : undefined,
      };
    });

    return {
      questions,
      topic: String(parsed.topic ?? input.topic ?? ''),
      difficulty: input.difficulty,
    };
  }

  // ===================================================================
  // Internal — intent dispatcher with primary→fallback retry.
  // ===================================================================

  private async dispatchIntent(options: DispatchOptions): Promise<DispatchResult> {
    // Req 8.5: retired intents (e.g. SPECIALTY_CLASSIFY) must never be
    // dispatched. The enum value still exists in the DB for historical
    // audit rows, so we reject defensively here even though no public
    // method routes to it anymore.
    if ((REMOVED_AI_INTENTS as readonly string[]).includes(options.intent)) {
      throw new AiTemplateNotFoundError(options.templateKey);
    }

    // Step 1+2: resolve and render the prompt template.
    const { template, userPrompt, systemPrompt } =
      await this.templateLoader.resolveAndRender(options.templateKey, options.vars);

    const finalSystem = options.systemSuffix
      ? `${systemPrompt}\n\n${options.systemSuffix}`
      : systemPrompt;

    // Step 3: rate limit.
    try {
      await this.rateLimiter.assertWithinLimit(options.rateLimitSubject);
    } catch (error) {
      // Rate limit breached — record an audit row before re-throwing so
      // ops can see the spike in `AiCall.status='RATE_LIMITED'`.
      await this.recordAudit({
        userId: options.userId,
        intent: options.intent,
        template,
        response: emptyResponse(template.modelName),
        status: AI_CALL_STATUS.RATE_LIMITED,
        errorMsg:
          error instanceof AiRateLimitedError
            ? `local rate limit exceeded (retryAfterMs=${error.retryAfterMs})`
            : (error as Error).message,
        ...(options.refType !== undefined ? { refType: options.refType } : {}),
        ...(options.refId !== undefined ? { refId: options.refId } : {}),
      });
      throw error;
    }

    // Step 4: primary → fallback dispatcher.
    const request = {
      modelName: template.modelName,
      system: finalSystem,
      user: userPrompt,
      maxTokens: options.maxTokens ?? template.maxTokens,
      ...(options.jsonMode ? { jsonMode: true } : {}),
    };

    const providers = this.orderedProviders();
    let lastError: unknown;
    for (let i = 0; i < providers.length; i += 1) {
      const provider = providers[i];
      if (!provider) continue;
      try {
        const response = await provider.complete(request);
        return {
          template,
          response,
          providerName: provider.providerName,
          attempts: i + 1,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof AiRateLimitedError) {
          // Upstream rate limit — never fall back, surface to caller.
          await this.recordAudit({
            userId: options.userId,
            intent: options.intent,
            template,
            response: emptyResponse(template.modelName),
            status: AI_CALL_STATUS.RATE_LIMITED,
            errorMsg: `upstream 429 from ${provider.providerName}`,
            ...(options.refType !== undefined ? { refType: options.refType } : {}),
            ...(options.refId !== undefined ? { refId: options.refId } : {}),
          });
          throw error;
        }
        if (!(error instanceof AiUpstreamError)) {
          throw error; // unexpected error — bubble up unchanged
        }
        this.logger.warn(
          `AiGatewayService: ${provider.providerName} failed (${error.message}); attempting fallback`,
        );
      }
    }

    // Both providers failed — record one ERROR audit row and rethrow
    // the last upstream error.
    await this.recordAudit({
      userId: options.userId,
      intent: options.intent,
      template,
      response: emptyResponse(template.modelName),
      status: AI_CALL_STATUS.ERROR,
      errorMsg: (lastError as Error)?.message ?? 'unknown adapter failure',
      ...(options.refType !== undefined ? { refType: options.refType } : {}),
      ...(options.refId !== undefined ? { refId: options.refId } : {}),
    });
    throw lastError instanceof Error
      ? lastError
      : new AiUpstreamError(null, 'all AI providers failed');
  }

  /**
   * Build the ordered list of providers. The primary always runs
   * first; the fallback is appended only when it is healthy AND
   * distinct from the primary. This protects the test setup where the
   * same `FakeAdapter` is wired to both tokens.
   */
  private orderedProviders(): AiAdapter[] {
    const list: AiAdapter[] = [];
    if (this.primary?.isHealthy()) list.push(this.primary);
    if (
      this.fallback?.isHealthy() &&
      this.fallback !== this.primary &&
      this.fallback.providerName !== this.primary?.providerName
    ) {
      list.push(this.fallback);
    }
    if (list.length === 0) {
      // No healthy provider — append the primary anyway so its
      // `complete()` method throws a clear configuration error.
      if (this.primary) list.push(this.primary);
    }
    return list;
  }

  private async recordAudit(input: {
    userId: string | null;
    intent: AiIntent;
    template: ResolvedPromptTemplate;
    response: AiAdapterResponse;
    status: AiCallStatus;
    errorMsg?: string | null;
    refType?: string;
    refId?: string;
  }): Promise<void> {
    const cost = computeCostUsd({
      modelName: input.response.modelName,
      inputTokens: input.response.inputTokens,
      outputTokens: input.response.outputTokens,
    });
    const row: AiCallAuditRow = {
      userId: input.userId,
      intent: input.intent,
      templateKey: input.template.key,
      modelName: input.response.modelName,
      inputTokens: input.response.inputTokens,
      outputTokens: input.response.outputTokens,
      costUsd: cost,
      latencyMs: input.response.latencyMs,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      status: input.status,
      errorMsg: input.errorMsg ?? null,
    };
    await this.audit.record(row);
  }
}

// ===================================================================
// Helpers
// ===================================================================

const TUTOR_TEMPLATE_BY_INTENT: Record<TutorInput['intent'], PromptTemplateKey> = {
  EXPLAIN: PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
  TRANSLATE: PROMPT_TEMPLATE_KEYS.TUTOR_TRANSLATE,
  EXAMPLE: PROMPT_TEMPLATE_KEYS.TUTOR_EXAMPLE,
};

const TUTOR_PRISMA_INTENT: Record<TutorInput['intent'], AiIntent> = {
  EXPLAIN: 'TUTOR_EXPLAIN',
  TRANSLATE: 'TUTOR_TRANSLATE',
  EXAMPLE: 'TUTOR_EXAMPLE',
};

/**
 * Hard rules appended to every tutor system prompt. Spec text from
 * design.md → "AI Gateway — Tutor mode policy enforcement".
 */
const TUTOR_HARD_RULES = [
  'HARD RULES:',
  '- NEVER write a complete sentence/paragraph that the student could submit verbatim.',
  '- NEVER produce final answers to fill-in tasks.',
  '- You may give: rules, examples about a different topic, partial hints.',
  "- If asked to 'do' the task, refuse politely and offer to explain instead.",
].join('\n');

function emptyResponse(modelName: string): AiAdapterResponse {
  return {
    text: '',
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    modelName,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseJsonStrict<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  // Strip Markdown code fences the provider sometimes wraps around.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    return fallback;
  }
}

/**
 * Build a stable short reference key for audit rows. We avoid pulling
 * in `crypto` at the top level so test runs that don't exercise the
 * audit path remain fast; falling back to a content-aware string when
 * Node's crypto isn't available keeps the contract observable.
 */
function hashRefKey(text: string): string {
  if (!text) return 'empty';
  // Cheap deterministic hash — collision probability is irrelevant
  // here because the value is purely an audit index, not a key.
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `h:${(hash >>> 0).toString(36)}:${Math.min(text.length, 9999)}`;
}

/**
 * Convert a verbatim AI reply into a hint-style paraphrase that
 * preserves structure but explicitly avoids reproducing the answer.
 * Algorithm: prefix with a hint banner and truncate to keep the reply
 * unambiguously partial. Production may swap this for a Claude-side
 * rewrite pass; this is a deterministic safe default.
 */
function rephraseAsHint(reply: string): string {
  const trimmed = reply.trim();
  const head = trimmed.slice(0, Math.min(160, Math.floor(trimmed.length / 2)));
  return [
    'Hint: I can\'t share the full answer because it overlaps your active submission.',
    head ? `Direction to consider: ${head}…` : '',
    'Try restating the question in your own words and walk through the rule first.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ===================================================================
// Translate cache helpers (Task 20.2)
// ===================================================================

/** 7 days — Req-driven TTL for translation cache. */
const TRANSLATE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Build a deterministic, content-addressable key for the
 * `tutor.translate` cache. The hash includes the locale pair so the
 * same text translated to different targets does not collide.
 */
function buildTranslateCacheKey(
  source: string,
  target: string,
  text: string,
): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const hash = createHash('sha256')
    .update(`${source}|${target}|${normalized}`)
    .digest('hex')
    .slice(0, 32);
  return `ai:tutor:translate:${hash}`;
}
