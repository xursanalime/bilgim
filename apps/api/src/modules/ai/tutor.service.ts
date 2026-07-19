/**
 * TutorService — task 20.2 surface for the AI Tutor mode.
 *
 * Responsibilities (above and beyond `AiGatewayService.tutor*`):
 *   1. **Verbatim-answer refusal.** Before dispatching to the gateway,
 *      we detect prompts of the form "give me the answer", "do my
 *      homework for me", "solve this for me" — when an `assignmentId`
 *      is present, those prompts get a 403 `TUTOR_REFUSED_ANSWER`. The
 *      gateway's similarity post-filter handles the leakier cases
 *      (model returns the answer in disguise); the pre-flight check
 *      here saves an upstream token spend on prompts we know up-front
 *      to be policy violations and gives the client a clean,
 *      actionable error code (Req 13.6, Property 4).
 *   2. **Load lesson + assignment context.** When `assignmentId` is
 *      provided, we fetch the assignment title / description plus its
 *      lesson title from Postgres and append a short summary to
 *      `contextText` so the model has enough grounding to give a
 *      hint without seeing the answer. The lookup is best-effort: a
 *      missing assignment is logged but not fatal — students who
 *      reference a stale id still get a (hint-only) response.
 *   3. **Seed default `AiPromptTemplate` rows on demand.** The
 *      gateway already falls back to built-in defaults when the DB row
 *      is missing, but Req 13 calls for the prompts to be auditable
 *      from `AiPromptTemplate`. `seedDefaultsIfMissing()` upserts the
 *      tutor.{explain,translate,example}.v1 keys when they don't
 *      exist — operators can then edit the row to roll the prompt
 *      forward without redeploying.
 *
 * Why a service in addition to the controller's gateway calls:
 *   The refusal logic is not a generic gateway concern — programmatic
 *   `tutor()` callers (BullMQ workers, worker scripts) bypass the
 *   "homework is active" filter on purpose. Putting the refusal here
 *   keeps the controller surface honest (every HTTP tutor call goes
 *   through `TutorService.explain/translate/example`) while leaving
 *   the gateway's `tutor()` reusable for non-HTTP code paths.
 *
 * Rate-limiting:
 *   The gateway already enforces the per-user 60-call/10-minute quota
 *   inside `dispatchIntent`. We do not double-charge here — the
 *   tutor-mode-specific limits (30 explains/h, 100 translates/h)
 *   live as `@RateLimit(...)` decorators on the controller routes.
 */

import {
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import {
  PROMPT_TEMPLATE_KEYS,
  PromptTemplateKey,
} from './ai.constants';
import { TutorRefusedAnswerError } from './ai.errors';
import { AiGatewayService } from './ai.gateway.service';
import {
  PromptTemplateLoader,
  type ResolvedPromptTemplate,
} from './prompt-template.loader';
import { TutorConversationService } from './tutor-conversation.service';
import type {
  TutorExampleInput,
  TutorExplainInput,
  TutorOutput,
  TutorTranslateInput,
  TutorTranslateOutput,
} from './ai.types';

/**
 * Inputs accepted by `TutorService.explain`. Mirrors the
 * `/v1/ai/tutor/explain` body: a question + optional context, plus
 * the (optional) `submissionId` / `assignmentId` that anchor the
 * no-completion policy.
 */
export interface TutorServiceExplainInput {
  userId: string;
  question: string;
  contextText?: string;
  locale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  assignmentId?: string;
  /**
   * Verified server-side submission text loaded by `AiTutorPolicyGuard`.
   * The gateway uses it for the cosine-similarity post-filter. Optional
   * because non-HTTP callers may not have a guard run upstream.
   */
  submissionText?: string;
  /**
   * Optional client-supplied id that threads multi-turn sessions
   * (chat-style tutor). `TutorService` loads previous turns from Redis
   * and prepends them to `contextText` so the model sees the on-going
   * conversation. After the call, the (question, reply) pair is
   * appended to the cache.
   */
  conversationId?: string;
}

export interface TutorServiceTranslateInput {
  userId: string;
  text: string;
  sourceLocale: 'uz' | 'ru' | 'en';
  targetLocale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  assignmentId?: string;
  submissionText?: string;
}

export interface TutorServiceExampleInput {
  userId: string;
  /** The topic / question the student wants an analogous example of. */
  topic: string;
  contextText?: string;
  locale: 'uz' | 'ru' | 'en';
  submissionId?: string;
  assignmentId?: string;
  submissionText?: string;
}

/**
 * Patterns that indicate the student is asking for a complete answer.
 * The list is short on purpose — false negatives are recovered by the
 * gateway's similarity post-filter, false positives directly degrade
 * the student experience by refusing legitimate questions. Matches
 * are case-insensitive and language-aware (uz/ru/en).
 *
 * Order matters: more specific patterns should come first so the
 * resulting `reason` field reflects the strongest match.
 */
const ANSWER_REQUEST_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  // English — direct asks
  {
    regex: /\b(?:give|tell|write|provide|hand)\s+(?:me\s+)?(?:the\s+|a\s+|my\s+)?(?:full\s+|complete\s+|final\s+|correct\s+)?answer(?:s)?\b/i,
    reason: 'asks for the answer outright',
  },
  {
    regex: /\b(?:do|solve|finish|complete|write|answer)\s+(?:my|this|the)\s+(?:homework|assignment|task|exercise|problem|essay|question)/i,
    reason: 'asks the tutor to complete the assignment',
  },
  {
    regex: /\b(?:what(?:'s|\s+is)|tell\s+me)\s+the\s+(?:right|correct|final|full)\s+answer\b/i,
    reason: 'asks for the correct answer',
  },
  // Uzbek — common phrasings
  {
    regex: /\bjavob(?:ni|ini|larini)?\s+(?:ber|yoz|aytib\s+ber|to[\u02BB']liq)/i,
    reason: 'javobni so\u02BBraydi (uz)',
  },
  {
    regex: /\b(?:uy|uy\s+vazifa|vazifa|test)(?:mni|ni|si)?\s+(?:bajar|yech|yoz|qil)/i,
    reason: 'uy vazifani bajarib berishni so\u02BBraydi (uz)',
  },
  // Russian
  {
    regex: /(?:^|[^\p{L}])(?:дай|скажи|напиши|реши)\s+(?:мне\s+)?(?:полный\s+|правильный\s+)?ответ/iu,
    reason: 'просит дать ответ (ru)',
  },
  {
    regex: /(?:^|[^\p{L}])(?:сделай|реши|напиши)\s+(?:моё|мою|мой|это|задание|задачу|домашку|тест)/iu,
    reason: 'просит сделать задание (ru)',
  },
];

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  private seededOnce = false;

  constructor(
    private readonly gateway: AiGatewayService,
    private readonly templateLoader: PromptTemplateLoader,
    @Optional() private readonly conversation?: TutorConversationService,
    @Optional() private readonly prisma?: PrismaClient,
  ) {}

  /**
   * `POST /v1/ai/tutor/explain` — Socratic tutor.
   *
   * The pre-flight refusal runs only when `assignmentId` is provided.
   * Without an active assignment, "give me the answer" prompts still
   * reach the gateway (for example, a student asking generic exam
   * prep questions) and the gateway's similarity post-filter takes
   * over. With an assignment, we know there's a concrete homework on
   * the line and we hard-block the verbatim ask.
   *
   * Multi-turn chat: when `conversationId` is provided, previous turns
   * are loaded from Redis (max 10, 1h TTL) and folded into
   * `contextText` as a "Previous conversation" preamble. After the
   * gateway responds, the (question, reply) pair is appended back to
   * the cache so the next call sees the full thread.
   */
  async explain(input: TutorServiceExplainInput): Promise<TutorOutput> {
    await this.ensureTemplatesSeeded();
    const refusal = this.checkAnswerRefusal(input.question, input.assignmentId);
    if (refusal) throw refusal;

    const enrichedContext = await this.enrichContextWithAssignment(
      input.contextText,
      input.assignmentId,
    );
    const conversationContext = await this.loadConversationContext(
      enrichedContext,
      input.conversationId,
    );

    const gatewayInput: TutorExplainInput = {
      userId: input.userId,
      question: input.question,
      ...(conversationContext !== undefined
        ? { contextText: conversationContext }
        : {}),
      locale: input.locale,
      ...(input.submissionId !== undefined
        ? { submissionId: input.submissionId }
        : {}),
      ...(input.submissionText !== undefined
        ? { submissionText: input.submissionText }
        : {}),
      ...(input.assignmentId !== undefined
        ? { assignmentId: input.assignmentId }
        : {}),
    };
    const result = await this.gateway.tutorExplain(gatewayInput);
    if (input.conversationId && this.conversation) {
      // Persist the (question, final reply) pair — the reply we cache
      // is the policy-rectified `result.reply`, not the raw model text,
      // so the next prompt the model sees is also policy-clean.
      await this.conversation.appendTurn(
        input.conversationId,
        input.question,
        result.reply,
      );
    }
    return result;
  }

  /**
   * `POST /v1/ai/tutor/translate` — translation helper. The cache
   * (Property 15 hook for task 18.5) is keyed on the (text, target)
   * pair inside `AiGatewayService.tutorTranslate`; this service
   * forwards the request unchanged. We still run the pre-flight
   * refusal because a student could try to launder an answer through
   * "translate this answer for me".
   */
  async translate(
    input: TutorServiceTranslateInput,
  ): Promise<TutorTranslateOutput> {
    await this.ensureTemplatesSeeded();
    const refusal = this.checkAnswerRefusal(input.text, input.assignmentId);
    if (refusal) throw refusal;

    const gatewayInput: TutorTranslateInput = {
      userId: input.userId,
      text: input.text,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      ...(input.submissionId !== undefined
        ? { submissionId: input.submissionId }
        : {}),
      ...(input.submissionText !== undefined
        ? { submissionText: input.submissionText }
        : {}),
      ...(input.assignmentId !== undefined
        ? { assignmentId: input.assignmentId }
        : {}),
    };
    return this.gateway.tutorTranslate(gatewayInput);
  }

  /**
   * `POST /v1/ai/tutor/example` — analogous-example generator. The
   * gateway uses the `tutor.example.v1` template which already binds
   * the model to "different topic / different numbers" wording; the
   * post-filter still rewrites the reply if it accidentally drifts
   * back onto the student's submission.
   */
  async example(input: TutorServiceExampleInput): Promise<TutorOutput> {
    await this.ensureTemplatesSeeded();
    const refusal = this.checkAnswerRefusal(input.topic, input.assignmentId);
    if (refusal) throw refusal;

    const enrichedContext = await this.enrichContextWithAssignment(
      input.contextText,
      input.assignmentId,
    );

    const gatewayInput: TutorExampleInput = {
      userId: input.userId,
      question: input.topic,
      ...(enrichedContext !== undefined ? { contextText: enrichedContext } : {}),
      locale: input.locale,
      ...(input.submissionId !== undefined
        ? { submissionId: input.submissionId }
        : {}),
      ...(input.submissionText !== undefined
        ? { submissionText: input.submissionText }
        : {}),
      ...(input.assignmentId !== undefined
        ? { assignmentId: input.assignmentId }
        : {}),
    };
    return this.gateway.tutorExample(gatewayInput);
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  /**
   * Build a `TutorRefusedAnswerError` when the prompt is a verbatim
   * ask for the answer AND the call references an active assignment.
   * Returns `null` when the prompt is fine.
   */
  private checkAnswerRefusal(
    prompt: string,
    assignmentId: string | undefined,
  ): TutorRefusedAnswerError | null {
    if (!assignmentId) return null;
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return null;
    for (const { regex, reason } of ANSWER_REQUEST_PATTERNS) {
      if (regex.test(trimmed)) {
        this.logger.warn(
          `TutorService: refused verbatim-answer request for assignment=${assignmentId} (reason="${reason}")`,
        );
        return new TutorRefusedAnswerError(reason, assignmentId);
      }
    }
    return null;
  }

  /**
   * Append a short "for context" line to the user-supplied
   * `contextText` describing the assignment + lesson title. The model
   * sees the title only — never the description verbatim — so we don't
   * leak teacher-authored answer hints.
   */
  private async enrichContextWithAssignment(
    contextText: string | undefined,
    assignmentId: string | undefined,
  ): Promise<string | undefined> {
    if (!assignmentId || !this.prisma) return contextText;
    let summary = '';
    try {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          title: true,
          dueAt: true,
          lesson: { select: { title: true } },
        },
      });
      if (!assignment) return contextText;
      const parts: string[] = [];
      if (assignment.lesson?.title) {
        parts.push(`Lesson: ${assignment.lesson.title}`);
      }
      if (assignment.title) {
        parts.push(`Assignment: ${assignment.title}`);
      }
      if (parts.length === 0) return contextText;
      summary = `[Active assignment context — ${parts.join(' / ')}]`;
    } catch (error) {
      this.logger.warn(
        `TutorService: failed to load assignment ${assignmentId}: ${(error as Error).message}; continuing without enrichment`,
      );
      return contextText;
    }
    if (!contextText || contextText.trim().length === 0) return summary;
    if (contextText.includes(summary)) return contextText;
    return `${summary}\n\n${contextText}`;
  }

  /**
   * Lazy-seed the three tutor.* `AiPromptTemplate` rows on first use.
   * We rely on the loader's built-in defaults to know what to insert,
   * which means `prompt-template.loader.ts` is the single source of
   * truth for the prompt copy. Seeding is guarded by an in-process
   * `seededOnce` flag — under pod restart the seed runs again but the
   * UPSERT semantics keep it idempotent.
   */
  async seedDefaultsIfMissing(): Promise<void> {
    if (!this.prisma) return;
    const keys: PromptTemplateKey[] = [
      PROMPT_TEMPLATE_KEYS.TUTOR_EXPLAIN,
      PROMPT_TEMPLATE_KEYS.TUTOR_TRANSLATE,
      PROMPT_TEMPLATE_KEYS.TUTOR_EXAMPLE,
    ];
    for (const key of keys) {
      let template: ResolvedPromptTemplate;
      try {
        template = await this.templateLoader.resolve(key);
      } catch (error) {
        this.logger.warn(
          `TutorService.seedDefaultsIfMissing: cannot resolve template ${key}: ${(error as Error).message}`,
        );
        continue;
      }
      try {
        const existing = await this.prisma.aiPromptTemplate.findUnique({
          where: { key },
          select: { id: true },
        });
        if (existing) continue;
        await this.prisma.aiPromptTemplate.create({
          data: {
            key: template.key,
            intent: template.intent,
            systemText: template.systemText,
            userTemplate: template.userTemplate,
            modelName: template.modelName,
            maxTokens: template.maxTokens,
            isActive: true,
          },
        });
        this.logger.log(
          `TutorService: seeded default AiPromptTemplate ${key}`,
        );
      } catch (error) {
        // Best-effort. Re-running the seeder will fix any transient
        // failure; a permanent failure would have already surfaced
        // through the gateway's call path.
        this.logger.warn(
          `TutorService.seedDefaultsIfMissing: failed for ${key}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async ensureTemplatesSeeded(): Promise<void> {
    if (this.seededOnce) return;
    this.seededOnce = true;
    await this.seedDefaultsIfMissing();
  }

  /**
   * Prepend the persisted multi-turn history to the caller's
   * `contextText`. Returns the original context unchanged when there
   * is no `conversationId`, no service wired, or no prior turns. The
   * preamble is kept on its own block so the gateway's similarity
   * post-filter still treats the student's submission text (folded in
   * by `mergeContext`) as a separate signal.
   */
  private async loadConversationContext(
    contextText: string | undefined,
    conversationId: string | undefined,
  ): Promise<string | undefined> {
    if (!conversationId || !this.conversation) return contextText;
    const turns = await this.conversation.getHistory(conversationId);
    const preamble = this.conversation.renderForPrompt(turns);
    if (!preamble) return contextText;
    if (!contextText || contextText.trim().length === 0) return preamble;
    if (contextText.includes(preamble)) return contextText;
    return `${preamble}\n\n${contextText}`;
  }

  /** Test-only: reset the in-process seed flag between cases. */
  resetForTesting(): void {
    this.seededOnce = false;
  }
}
