/**
 * AiTutorPolicy — request-scoped guard that enforces the
 * "no-completion" policy for the `POST /ai/tutor/{explain,translate,example}`
 * endpoints (Task 20.2, Req 13.2, 13.3, 13.6, Property 4).
 *
 * What the guard does (pre-call):
 *   1. **Strip the student's submission text** from the request body.
 *      Any `Submission.answersJson` content the client tried to embed in
 *      `question` / `contextText` is replaced with a placeholder so the
 *      LLM can never see — and therefore never reproduce — the student's
 *      own answer. Stripping is keyed off `submissionId`: when the body
 *      references an active submission, the guard loads
 *      `Submission.answersJson` and removes any matching substring from
 *      the user-provided text.
 *   2. **Stamp the request** with the original `answersJson` so the
 *      controller / service can run the post-call similarity check
 *      against the actual submission content (not a client-supplied
 *      preview). The stamped value lives at `request.aiTutorPolicy`.
 *
 * What the guard does NOT do:
 *   - It does not call the LLM. The cosine-similarity post-filter and the
 *     "rewrote as hint" rewrite still happen inside `AiGatewayService`
 *     where the model response is observable.
 *   - It does not enforce rate-limits — that is `AiRateLimiterService`.
 *   - It does not write the audit row — that is `AiAuditService`.
 *
 * Why a guard and not an interceptor:
 *   The stripping step mutates the request body BEFORE Zod validation
 *   would normally see it; Nest runs guards before pipes, so the guard
 *   can rewrite `request.body` cleanly. We keep the guard side-effect
 *   tight: only the body fields explicitly listed below are touched.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Per-request payload stamped on the Express request object so the
 * controller / service can read the verified, server-side submission
 * text without re-querying.
 */
export interface AiTutorPolicyContext {
  /** The submission id the client referenced, when valid. */
  submissionId?: string;
  /**
   * The full text content extracted from `Submission.answersJson`. Used
   * by `AiGatewayService.tutor` for the cosine-similarity post-filter.
   * Empty string when there is no active submission.
   */
  submissionText: string;
  /** Whether stripping mutated the request body. */
  stripped: boolean;
  /**
   * Hard rules to append to the system prompt. Centralising them on the
   * guard keeps the policy text auditable from one location.
   */
  systemSuffix: string;
}

const PLACEHOLDER = '[REDACTED: student\'s own answer is not visible to the AI tutor]';

/**
 * Hard rules appended to every tutor system prompt by the guard. The
 * gateway also bakes its own copy in for callers that go through
 * `tutor()` directly (programmatic use, internal jobs); the suffixes
 * are identical so observers see the same policy text either way.
 */
export const AI_TUTOR_SYSTEM_SUFFIX = [
  'HARD RULES (no-completion policy):',
  '- NEVER write a complete sentence/paragraph that the student could submit verbatim.',
  '- NEVER produce final answers to fill-in tasks.',
  '- You may give: rules, examples about a different topic, partial hints.',
  "- If asked to 'do' the task, refuse politely and offer to explain instead.",
].join('\n');

/**
 * Minimum substring length we'll redact. Anything shorter is too generic
 * (a single word, punctuation) — redacting it would make the user
 * message unreadable without protecting anything meaningful.
 */
const MIN_REDACT_LEN = 12;

@Injectable()
export class AiTutorPolicyGuard implements CanActivate {
  private readonly logger = new Logger(AiTutorPolicyGuard.name);

  constructor(@Optional() private readonly prisma?: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const body = (request?.body ?? {}) as Record<string, unknown>;
    const submissionId =
      typeof body['submissionId'] === 'string'
        ? (body['submissionId'] as string)
        : undefined;

    let submissionText = '';
    if (submissionId && this.prisma) {
      try {
        const row = await this.prisma.submission.findUnique({
          where: { id: submissionId },
          select: { answersJson: true, studentId: true },
        });
        if (row) {
          submissionText = extractTextFromAnswers(row.answersJson);
        }
      } catch (error) {
        // Best-effort. A DB miss must not block the tutor — the
        // gateway still applies the similarity check against
        // `contextText` and rewrites as a hint when needed.
        this.logger.warn(
          `AiTutorPolicy: failed to load submission ${submissionId}: ${(error as Error).message}; continuing without strip`,
        );
      }
    }

    let stripped = false;
    if (submissionText.length >= MIN_REDACT_LEN) {
      stripped = redactInBody(body, submissionText);
      if (stripped) {
        this.logger.debug(
          `AiTutorPolicy: redacted submission ${submissionId} text from request body`,
        );
      }
    }

    const policyContext: AiTutorPolicyContext = {
      ...(submissionId !== undefined ? { submissionId } : {}),
      submissionText,
      stripped,
      systemSuffix: AI_TUTOR_SYSTEM_SUFFIX,
    };
    (request as { aiTutorPolicy?: AiTutorPolicyContext }).aiTutorPolicy =
      policyContext;

    return true;
  }
}

/**
 * Walk the request body and replace any substring matching the
 * student's submission text with a placeholder. We only touch the
 * known free-text fields — never the entire body — so unrelated keys
 * (intent, locale, submissionId) survive untouched.
 *
 * Returns whether anything was redacted.
 */
function redactInBody(
  body: Record<string, unknown>,
  submissionText: string,
): boolean {
  const fields = ['question', 'contextText', 'text', 'sentence', 'word'];
  let dirty = false;
  const needles = collectNeedles(submissionText);
  if (needles.length === 0) return false;

  for (const field of fields) {
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    let next = value;
    for (const needle of needles) {
      if (next.includes(needle)) {
        next = next.split(needle).join(PLACEHOLDER);
        dirty = true;
      }
    }
    if (next !== value) {
      body[field] = next;
    }
  }
  return dirty;
}

/**
 * Build the list of substrings we'll search-and-replace for. We split
 * the submission text into sentence-ish chunks so paraphrased prompts
 * still get redacted when they quote a meaningful slice. Chunks shorter
 * than `MIN_REDACT_LEN` are dropped to avoid over-redaction.
 */
function collectNeedles(submissionText: string): string[] {
  const trimmed = submissionText.trim();
  if (trimmed.length < MIN_REDACT_LEN) return [];
  const out = new Set<string>();
  // Whole text — covers the common "student pastes their entire
  // submission" case.
  out.add(trimmed);
  // Sentence-level chunks — handle copy/paste of one paragraph.
  for (const chunk of trimmed.split(/[\n.!?]+/)) {
    const piece = chunk.trim();
    if (piece.length >= MIN_REDACT_LEN) out.add(piece);
  }
  return Array.from(out).sort((a, b) => b.length - a.length);
}

/**
 * Extract a flat text representation from `Submission.answersJson`.
 * The shape varies per module type (writing → `{ text }`, reading →
 * `{ value }`, etc.) so we conservatively concatenate every string
 * leaf we find.
 */
export function extractTextFromAnswers(answers: unknown): string {
  if (answers == null) return '';
  if (typeof answers === 'string') return answers;
  const parts: string[] = [];
  walk(answers, parts);
  return parts.join('\n').trim();
}

function walk(value: unknown, out: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.trim().length > 0) out.push(value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walk(v, out);
    }
  }
}
