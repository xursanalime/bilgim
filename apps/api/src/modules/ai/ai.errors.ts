import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * AiRateLimitedError — 429 surfaced when either:
 *   1. The per-user in-memory rate limiter rejects the call (Req 13.5
 *      — 60 calls / 10 minutes by default), or
 *   2. The Anthropic API itself returns 429 from the upstream model.
 *
 * Implemented as a Nest HttpException so the global
 * `AllExceptionsFilter` can map it to `{ code: 'AI_RATE_LIMITED', ... }`
 * directly — there is no separate translator.
 *
 * `retryAfterMs` is exposed so the controller can surface a
 * `Retry-After` header (rounded up to seconds) and so call sites can
 * decide whether to enqueue a deferred BullMQ retry.
 */
export class AiRateLimitedError extends HttpException {
  readonly code = 'AI_RATE_LIMITED';

  constructor(
    public readonly retryAfterMs: number,
    public readonly source: 'local' | 'upstream' = 'local',
    message = 'Too many AI requests',
  ) {
    super(
      {
        code: 'AI_RATE_LIMITED',
        message,
        retryAfterMs,
        source,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * AiTemplateNotFoundError — 404 surfaced when an `AiPromptTemplate`
 * referenced by a caller is missing or inactive. We wrap NotFound so
 * the global filter produces a consistent error envelope.
 */
export class AiTemplateNotFoundError extends HttpException {
  readonly code = 'AI_TEMPLATE_NOT_FOUND';

  constructor(public readonly templateKey: string) {
    super(
      {
        code: 'AI_TEMPLATE_NOT_FOUND',
        message: `AI prompt template "${templateKey}" not found or inactive`,
        templateKey,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * AiUpstreamError — 502 surfaced when the Anthropic API returns an
 * error that is NOT a 429 (those become `AiRateLimitedError`). The
 * adapter still records an `AiCall` row before throwing so the audit
 * trail captures the failure.
 */
export class AiUpstreamError extends HttpException {
  readonly code = 'AI_UPSTREAM_ERROR';

  constructor(
    public readonly upstreamStatus: number | null,
    public readonly upstreamMessage: string,
  ) {
    super(
      {
        code: 'AI_UPSTREAM_ERROR',
        message: `Anthropic upstream error: ${upstreamMessage}`,
        upstreamStatus,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/**
 * TutorRefusedAnswerError — 403 surfaced by `TutorService` when a
 * student's prompt is a verbatim "give me the answer" request against
 * an active homework assignment (Req 13.6 — AI tutor MUST never
 * produce a complete answer the student could submit).
 *
 * The error is raised BEFORE the gateway dispatch so we never burn
 * upstream tokens on requests that we know up-front will be blocked.
 * The 403 status (instead of 400) is deliberate: this is a policy
 * decision, not a malformed-request issue. The `code` field is the
 * machine-readable signal mobile / web clients use to render the
 * "I can't give you the answer, but I can help you think through it"
 * UI affordance.
 */
export class TutorRefusedAnswerError extends HttpException {
  readonly code = 'TUTOR_REFUSED_ANSWER';

  constructor(
    public readonly reason: string,
    public readonly assignmentId?: string,
  ) {
    super(
      {
        code: 'TUTOR_REFUSED_ANSWER',
        message:
          'AI tutor cannot produce a complete answer to your active homework. Try asking for a hint, an explanation of the rule, or a different example.',
        reason,
        ...(assignmentId !== undefined ? { assignmentId } : {}),
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
