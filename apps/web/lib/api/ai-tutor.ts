/**
 * BilgimAI tutor client — mirrors the real backend contract exposed by
 * `TutorController` (`apps/api/src/modules/ai/tutor.controller.ts`):
 *
 *   POST /ai/tutor/explain    → { reply, policyChecks }   (30 calls / 1h)
 *   POST /ai/tutor/translate  → { translation, cached }   (100 calls / 1h)
 *   POST /ai/tutor/example    → { reply, policyChecks }   (30 calls / 1h)
 *
 * These three intents (EXPLAIN / TRANSLATE / EXAMPLE) are the
 * English-only tutor surface (Req 11.1). The backend enforces a
 * no-verbatim-answer policy (Req 11.3 / 11.4): replies that drift onto
 * the student's active submission are rewritten as hints
 * (`policyChecks.rewroteAsHint`), and verbatim "give me the answer"
 * prompts against an active assignment are refused outright with a
 * `TUTOR_REFUSED_ANSWER` 403.
 *
 * The transport is plain JSON (no SSE) — the chat surface renders a
 * progressive/typing reveal of the completed reply rather than true
 * token streaming.
 */

import { apiClient, ApiClientError } from '../api-client';

export type TutorIntent = 'EXPLAIN' | 'TRANSLATE' | 'EXAMPLE';
export type TutorLocale = 'uz' | 'ru' | 'en';

/**
 * Per-intent rate-limit caps declared on the controller routes. Mirrored
 * here so the UI can show a friendly "remaining calls" indicator
 * (Req 11.3) without a dedicated quota endpoint. The window is one hour.
 */
export const TUTOR_RATE_LIMITS: Record<
  TutorIntent,
  { readonly max: number; readonly windowMs: number }
> = {
  EXPLAIN: { max: 30, windowMs: 60 * 60 * 1000 },
  TRANSLATE: { max: 100, windowMs: 60 * 60 * 1000 },
  EXAMPLE: { max: 30, windowMs: 60 * 60 * 1000 },
};

/** Policy assertions surfaced per reply (Req 11.4 hint-only framing). */
export interface TutorPolicyChecks {
  noFullAnswer: boolean;
  rewroteAsHint: boolean;
  similarity: number;
  reason?: string;
}

export interface TutorReply {
  reply: string;
  policyChecks: TutorPolicyChecks;
}

export interface TutorTranslateReply {
  translation: string;
  cached: boolean;
}

export interface ExplainParams {
  question: string;
  locale: TutorLocale;
  contextText?: string;
}

export interface ExampleParams {
  question: string;
  locale: TutorLocale;
  contextText?: string;
}

export interface TranslateParams {
  text: string;
  sourceLocale: TutorLocale;
  targetLocale: TutorLocale;
}

/**
 * Thrown when the tutor route (or the upstream model) is rate-limited.
 * `retryAfterMs` drives the cooldown countdown in the UI.
 */
export class TutorRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly source: 'local' | 'upstream' | 'route';

  constructor(retryAfterMs: number, source: 'local' | 'upstream' | 'route' = 'route') {
    super('AI_RATE_LIMITED');
    this.name = 'TutorRateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.source = source;
  }
}

/**
 * Thrown when the tutor refuses a verbatim-answer request against an
 * active assignment (`TUTOR_REFUSED_ANSWER`, Req 11.4). The UI renders
 * the refusal as guidance rather than an error.
 */
export class TutorRefusedError extends Error {
  readonly reason: string | undefined;

  constructor(reason?: string) {
    super('TUTOR_REFUSED_ANSWER');
    this.name = 'TutorRefusedError';
    this.reason = reason;
  }
}

/**
 * Map an `ApiClientError` onto a typed tutor error. The api-client
 * unwraps the backend envelope into `details`, so `retryAfterMs` /
 * `code` are read from there; a 429 with no body defaults to a 60s
 * cooldown.
 */
function translateError(err: unknown): never {
  if (err instanceof ApiClientError) {
    const details = (err.details ?? {}) as {
      code?: string;
      reason?: string;
      retryAfterMs?: number;
      source?: 'local' | 'upstream';
    };
    if (err.statusCode === 429) {
      const ms =
        typeof details.retryAfterMs === 'number' && details.retryAfterMs > 0
          ? details.retryAfterMs
          : 60_000;
      throw new TutorRateLimitError(ms, details.source ?? 'route');
    }
    if (err.statusCode === 403 && details.code === 'TUTOR_REFUSED_ANSWER') {
      throw new TutorRefusedError(details.reason);
    }
  }
  throw err;
}

export const aiTutorApi = {
  async explain(params: ExplainParams): Promise<TutorReply> {
    try {
      return await apiClient.post<TutorReply>('/ai/tutor/explain', {
        question: params.question,
        locale: params.locale,
        ...(params.contextText ? { contextText: params.contextText } : {}),
      });
    } catch (err) {
      return translateError(err);
    }
  },

  async example(params: ExampleParams): Promise<TutorReply> {
    try {
      return await apiClient.post<TutorReply>('/ai/tutor/example', {
        question: params.question,
        locale: params.locale,
        ...(params.contextText ? { contextText: params.contextText } : {}),
      });
    } catch (err) {
      return translateError(err);
    }
  },

  async translate(params: TranslateParams): Promise<TutorTranslateReply> {
    try {
      return await apiClient.post<TutorTranslateReply>('/ai/tutor/translate', {
        text: params.text,
        sourceLocale: params.sourceLocale,
        targetLocale: params.targetLocale,
      });
    } catch (err) {
      return translateError(err);
    }
  },
};
