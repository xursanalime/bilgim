import { Injectable, Logger, Optional } from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';
import type {
  BehavioralSignals,
  StoredBehavioralSummary,
} from './types';

/**
 * `BehavioralService` — Task 27.4 (Req 27.6) behavioural-signal
 * collector.
 *
 * The browser posts a per-session summary of human-like interaction
 * (mouse moves, keystrokes, dwell time, form completion latency) to
 * `/security/behavior/report`. The controller validates the body and
 * delegates to this service, which:
 *
 *   1. Computes a heuristic risk score from the summary using a few
 *      rules that mirror the task body:
 *        - form completion `< 2s` AND zero mouse movement → strong bot
 *        - very high typing speed (>15 keystrokes/sec on average) → bot
 *        - zero dwell time on a non-trivial form → bot
 *   2. Persists the summary in Redis (`bd:behavior:<sessionId>`) for
 *      one hour so the bot-detection service can pick it up on the
 *      next login attempt without round-tripping to Postgres.
 *
 * The score is intentionally bounded — this service does not decide
 * the final outcome, that's `BotDetectionService`'s job. We just
 * surface a signal in `[0, 1]` that the aggregator can blend with
 * its other heuristics.
 *
 * ## Storage layout (Redis)
 *
 * | Key                          | Type | TTL     | Purpose |
 * |------------------------------|------|---------|---------|
 * | `bd:behavior:<sessionId>`    | str  | 1 h     | JSON of latest summary |
 *
 * ## Fail-open posture
 *
 * Same as the rest of the security stack — every Redis hit is
 * `try/catch`ed. A Redis outage MUST NOT bubble up as a 5xx; it just
 * means the next bot-detection check sees no behavioural data.
 */
@Injectable()
export class BehavioralService {
  private readonly logger = new Logger(BehavioralService.name);

  /** Below this form-completion latency a non-bot is implausible (ms). */
  static readonly MIN_HUMAN_FORM_MS = 2_000;

  /** Above this typing rate sustained typing is implausible (keys / sec). */
  static readonly MAX_HUMAN_TYPING_RATE = 15;

  /** TTL for a stored summary — 1 hour, matching task body. */
  static readonly SUMMARY_TTL_SEC = 60 * 60;

  /** Redis key prefix for stored summaries. */
  static readonly KEY_PREFIX = 'bd:behavior';

  constructor(@Optional() private readonly redis?: RedisService) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Record a behavioural summary, returning the heuristic bot score
   * computed from it. Values are clamped to `[0, 1]`.
   *
   * Best-effort persistence — Redis failures degrade silently to a
   * computed-but-not-stored score.
   */
  async report(
    signals: BehavioralSignals,
  ): Promise<{ score: number; reasons: string[] }> {
    const sessionId = (signals.sessionId ?? '').trim();
    const sanitised = this.sanitise(signals);
    const { score, reasons } = this.computeScore(sanitised);

    if (this.redis && sessionId) {
      const stored: StoredBehavioralSummary = {
        ...sanitised,
        receivedAt: new Date().toISOString(),
      };
      try {
        await this.redis.set(
          this.summaryKey(sessionId),
          JSON.stringify(stored),
          BehavioralService.SUMMARY_TTL_SEC,
        );
      } catch (err) {
        this.logger.warn(
          `report: SET failed for session ${sessionId}: ${(err as Error).message}`,
        );
      }
    }

    return { score, reasons };
  }

  /**
   * Read the latest stored summary for a session, or `null` when
   * Redis is unreachable / the session never reported.
   */
  async lookup(sessionId: string | undefined | null): Promise<
    StoredBehavioralSummary | null
  > {
    const id = (sessionId ?? '').trim();
    if (!this.redis || !id) return null;
    try {
      const raw = await this.redis.get(this.summaryKey(id));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredBehavioralSummary>;
      if (
        !parsed ||
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.mouseMovements !== 'number' ||
        typeof parsed.keystrokes !== 'number' ||
        typeof parsed.dwellTime !== 'number' ||
        typeof parsed.formCompletionMs !== 'number'
      ) {
        return null;
      }
      return parsed as StoredBehavioralSummary;
    } catch (err) {
      this.logger.warn(
        `lookup: GET/parse failed for session ${id}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Pure scoring helper. Exposed so callers (and unit tests) can
   * compute the score from an in-memory summary without
   * round-tripping through Redis. Returns `score in [0, 1]` plus the
   * stable reason identifiers that fired.
   */
  computeScore(
    signals: BehavioralSignals,
  ): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    const tooFast =
      signals.formCompletionMs > 0 &&
      signals.formCompletionMs < BehavioralService.MIN_HUMAN_FORM_MS;
    const noMouse = signals.mouseMovements <= 0;
    const noDwell = signals.dwellTime <= 0;
    const noKeystrokes = signals.keystrokes <= 0;

    // Strong combined signal: form filled in < 2s AND no mouse movement.
    if (tooFast && noMouse) {
      score += 0.7;
      reasons.push('behavior.form_too_fast_no_mouse');
    } else if (tooFast) {
      // Form latency alone: real users sometimes paste prefilled
      // values, so we treat this as a weaker signal.
      score += 0.3;
      reasons.push('behavior.form_too_fast');
    } else if (noMouse && signals.formCompletionMs >= BehavioralService.MIN_HUMAN_FORM_MS) {
      // Plausible accessibility users — keyboard-only navigation —
      // so we only contribute a small weight when mouse=0.
      score += 0.1;
      reasons.push('behavior.no_mouse_movement');
    }

    // Implausibly fast sustained typing rate.
    if (signals.keystrokes > 0 && signals.dwellTime > 0) {
      const ratePerSec = signals.keystrokes / (signals.dwellTime / 1000);
      if (ratePerSec > BehavioralService.MAX_HUMAN_TYPING_RATE) {
        score += 0.4;
        reasons.push('behavior.typing_rate_too_high');
      }
    }

    // No interaction at all (zero everywhere) — likely a scripted
    // POST that bypassed the form entirely.
    if (noMouse && noKeystrokes && noDwell && tooFast) {
      score += 0.2;
      reasons.push('behavior.zero_interaction');
    }

    if (score < 0) score = 0;
    if (score > 1) score = 1;
    return { score, reasons };
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /** Coerce raw input to safe non-negative integers. */
  private sanitise(signals: BehavioralSignals): BehavioralSignals {
    return {
      sessionId: (signals.sessionId ?? '').trim(),
      mouseMovements: clampNonNegative(signals.mouseMovements),
      keystrokes: clampNonNegative(signals.keystrokes),
      dwellTime: clampNonNegative(signals.dwellTime),
      formCompletionMs: clampNonNegative(signals.formCompletionMs),
    };
  }

  private summaryKey(sessionId: string): string {
    return `${BehavioralService.KEY_PREFIX}:${sessionId}`;
  }
}

function clampNonNegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}
