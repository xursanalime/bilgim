/**
 * TutorConversationService — Redis-backed multi-turn history for the
 * `/v1/ai/tutor/explain` endpoint (Task 20.2 chat-style tutor).
 *
 * Why this lives outside `AiGatewayService`:
 *   The gateway's adapter contract is single-turn — every provider
 *   call is a `{ system, user }` pair so we can swap providers without
 *   coupling to their multi-turn message shape (see comment in
 *   `adapters/types.ts`). Multi-turn context for the chat-style tutor
 *   is therefore folded into the *user prompt* as a "Previous
 *   conversation" preamble; this service is the authority on how that
 *   preamble is built and how long it survives.
 *
 * Storage layout:
 *   - Key:   `ai:tutor:conversation:{conversationId}`
 *   - Value: JSON-encoded `{ turns: ConversationTurn[], updatedAt }`.
 *   - TTL:   1 hour, refreshed on every write so an active session
 *            doesn't expire mid-thread (and an idle one is reaped).
 *
 * Bounds:
 *   - At most `MAX_TURNS = 10` user / assistant entries are kept
 *     (counts both sides — so 5 student + 5 tutor turns). New turns
 *     evict oldest in FIFO order.
 *   - Each turn's content is hard-capped at 4 000 chars (the same
 *     limit Zod enforces on the request body) to bound the prompt
 *     size we'll concatenate.
 *
 * Failure mode:
 *   - All Redis errors degrade to "no history available". We never
 *     block a tutor call on cache I/O — the rest of the pipeline
 *     (rate-limit, gateway, audit) still does its job. Logged at WARN
 *     so ops can see cache trouble without flooding ERROR.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service';

/**
 * One persisted turn. The role is constrained to `student` / `tutor`
 * because the gateway's adapters only see single-turn `{system,user}`
 * traffic — the role here is purely for prompt-stitching purposes.
 */
export interface ConversationTurn {
  role: 'student' | 'tutor';
  content: string;
  /** ISO timestamp — informational, used for debug only. */
  at: string;
}

/** Max turns kept in cache (combined student + tutor). */
export const MAX_TURNS = 10;

/** Hard cap per turn so the rendered prompt stays bounded. */
const MAX_CONTENT_CHARS = 4_000;

/** Cache TTL — 1 hour, refreshed on every write. */
export const CONVERSATION_TTL_SECONDS = 60 * 60;

const KEY_PREFIX = 'ai:tutor:conversation:';

interface StoredEnvelope {
  turns: ConversationTurn[];
  updatedAt: string;
}

@Injectable()
export class TutorConversationService {
  private readonly logger = new Logger(TutorConversationService.name);

  constructor(@Optional() private readonly redis?: RedisService) {}

  /**
   * Read the persisted turns for `conversationId`. Returns an empty
   * array when:
   *   - no `redis` is wired (unit-test / dev-without-cache),
   *   - the key has expired or never existed,
   *   - the stored value cannot be parsed (treated as cache miss).
   */
  async getHistory(conversationId: string | undefined): Promise<ConversationTurn[]> {
    if (!conversationId || !this.redis) return [];
    try {
      const raw = await this.redis.get(this.keyFor(conversationId));
      if (!raw) return [];
      const parsed = safeParseEnvelope(raw);
      if (!parsed) return [];
      return parsed.turns.slice(-MAX_TURNS);
    } catch (error) {
      this.logger.warn(
        `TutorConversationService.getHistory: cache read failed for ${conversationId}: ${(error as Error).message}; treating as miss`,
      );
      return [];
    }
  }

  /**
   * Append the (student question, tutor reply) pair as two new turns
   * to the conversation. Keeps the FIFO bound at `MAX_TURNS` and
   * refreshes the 1-hour TTL.
   *
   * No-ops when `conversationId` is missing OR when both sides are
   * empty — empty turns would just inflate the bucket without
   * carrying useful context.
   */
  async appendTurn(
    conversationId: string | undefined,
    studentContent: string,
    tutorContent: string,
  ): Promise<void> {
    if (!conversationId || !this.redis) return;

    const studentClean = clamp(studentContent);
    const tutorClean = clamp(tutorContent);
    if (studentClean.length === 0 && tutorClean.length === 0) return;

    let history: ConversationTurn[] = [];
    try {
      const raw = await this.redis.get(this.keyFor(conversationId));
      if (raw) {
        const parsed = safeParseEnvelope(raw);
        if (parsed) history = parsed.turns;
      }
    } catch (error) {
      this.logger.warn(
        `TutorConversationService.appendTurn: cache read failed for ${conversationId}: ${(error as Error).message}; starting fresh history`,
      );
      history = [];
    }

    const now = new Date().toISOString();
    if (studentClean.length > 0) {
      history.push({ role: 'student', content: studentClean, at: now });
    }
    if (tutorClean.length > 0) {
      history.push({ role: 'tutor', content: tutorClean, at: now });
    }

    // FIFO truncate to the last MAX_TURNS entries.
    if (history.length > MAX_TURNS) {
      history = history.slice(-MAX_TURNS);
    }

    const envelope: StoredEnvelope = { turns: history, updatedAt: now };
    try {
      await this.redis.set(
        this.keyFor(conversationId),
        JSON.stringify(envelope),
        CONVERSATION_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `TutorConversationService.appendTurn: cache write failed for ${conversationId}: ${(error as Error).message}; turn dropped`,
      );
    }
  }

  /**
   * Render the persisted history as a "Previous conversation" preamble
   * the gateway can prepend to the student's `contextText`. We use a
   * stable, human-readable format so the prompt stays auditable
   * (operators can read the AiCall row and reconstruct what the model
   * saw).
   *
   * Returns an empty string when there is no history — the caller
   * should treat that as "no preamble".
   */
  renderForPrompt(turns: ConversationTurn[]): string {
    if (!turns || turns.length === 0) return '';
    const lines = ['[Previous conversation]'];
    for (const turn of turns) {
      const label = turn.role === 'student' ? 'Student' : 'Tutor';
      lines.push(`${label}: ${turn.content}`);
    }
    return lines.join('\n');
  }

  private keyFor(conversationId: string): string {
    return `${KEY_PREFIX}${conversationId}`;
  }
}

function clamp(value: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  return trimmed.length > MAX_CONTENT_CHARS
    ? trimmed.slice(0, MAX_CONTENT_CHARS)
    : trimmed;
}

function safeParseEnvelope(raw: string): StoredEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEnvelope>;
    if (!parsed || !Array.isArray(parsed.turns)) return null;
    const turns: ConversationTurn[] = [];
    for (const t of parsed.turns) {
      if (!t || (t.role !== 'student' && t.role !== 'tutor')) continue;
      if (typeof t.content !== 'string') continue;
      turns.push({
        role: t.role,
        content: t.content,
        at: typeof t.at === 'string' ? t.at : new Date().toISOString(),
      });
    }
    return {
      turns,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
