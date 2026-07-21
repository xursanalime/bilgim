/**
 * AiTextDetectService — thin wrapper over `AiGatewayService.detectAiText`
 * (Task 20.3, Req 13.7, 13.8).
 *
 * Rationale:
 *   The `AiGateway` interface exposes `detectAiText` directly, but
 *   call sites that only care about the AI-text-detection outcome
 *   (e.g. `SubmissionService.submit`) shouldn't have to know about
 *   the broader gateway surface. This service:
 *     - Hides the gateway's `userId` ergonomics behind an optional
 *       parameter so the caller can pass `null` for system-side
 *       traffic (BullMQ workers).
 *     - Centralises the `flagged = likelihood >= threshold` decision
 *       so policy changes only touch one file.
 *     - Caches detection results in Redis keyed by `sha256(text)` for
 *       24 hours (Task 20.3 — cache layer requirement). Two identical
 *       text bodies coming through any caller (the new
 *       `POST /ai/text-detect` endpoint, the homework grading path,
 *       the submit-time signal) reuse the same row, eliminating
 *       redundant upstream calls and saving spend on repeated
 *       essays.
 *     - Returns a stripped-down `{ likelihood, signals, flagged }`
 *       shape — the gateway's `AiTextDetectOutput` is intentionally
 *       narrow but keeping this service as the single boundary makes
 *       it easy to swap implementations (e.g. add a perplexity-only
 *       fast path for very short texts) without churning every
 *       caller.
 *
 * Cache contract (Task 20.3):
 *   - Key: `ai:text-detect:{sha256(text)}` (hex digest of the trimmed
 *     text body). The hash is stable across processes and across
 *     callers, so a teacher detecting the same essay twice (or the
 *     submit pipeline already having seen it) produces a cache hit.
 *   - Value: a JSON-serialised `{ likelihood, signals }` blob. We do
 *     NOT cache the `flagged` boolean or the `threshold` because both
 *     are caller-specific — flag is recomputed against the caller's
 *     threshold on every read.
 *   - TTL: 24 hours. The detection signal is content-derived, so
 *     stale entries are safe; we still expire so prompt-template
 *     upgrades eventually retake the field.
 *   - On Redis errors the cache layer fails open: misses fall
 *     through to the gateway and writes are best-effort. The
 *     detection contract never blocks on cache health.
 *
 * Threshold:
 *   `AI_LIKELIHOOD_FLAG_THRESHOLD` (0.7) is the platform-wide flag
 *   default. Callers can override via the `threshold` argument when
 *   their policy needs a tighter or looser bar (e.g. Req 13.8 caps
 *   the homework-grading threshold at 0.75).
 *
 * Failure mode:
 *   Gateway errors propagate verbatim. The caller decides whether to
 *   degrade gracefully — `SubmissionService.submit` swallows the
 *   error and proceeds with `flagged=false` so a downstream AI hiccup
 *   never blocks a student submission.
 */

import { createHash } from 'crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { RedisService } from '../../infra/redis/redis.service';
import { AI_LIKELIHOOD_FLAG_THRESHOLD } from './ai.constants';
import { AI_GATEWAY, type AiGateway } from './ai.types';

export interface AiTextDetectInput {
  /** Free-form text to classify (essay, paragraph, full submission body). */
  text: string;
  /**
   * Optional userId — used by the gateway's per-user rate limiter
   * (Req 13.5). Pass `null` for server-side traffic so the limiter
   * skips the bucket.
   */
  userId?: string | null;
  /**
   * Optional override for the flag threshold. Defaults to
   * `AI_LIKELIHOOD_FLAG_THRESHOLD` (0.7). Must be in `[0, 1]`.
   */
  threshold?: number;
  /**
   * Set to `true` to skip the cache layer entirely (forces a fresh
   * gateway call). Used by tests and by ops debugging tooling. The
   * fresh result still populates the cache so subsequent callers
   * benefit.
   */
  skipCache?: boolean;
}

export interface AiTextDetectResult {
  /** 0..1 — likelihood the text was AI-generated. */
  likelihood: number;
  /** Provider-emitted reasoning signals; surface to the teacher UI. */
  signals: string[];
  /** True when `likelihood >= threshold`. */
  flagged: boolean;
  /** The threshold that produced `flagged`. Echoed for auditability. */
  threshold: number;
  /** True when the result was served from the Redis cache. */
  cached: boolean;
}

/** TTL for the AI-text-detection cache. Task 20.3 — 24 hours. */
export const AI_TEXT_DETECT_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** Redis key prefix for the AI-text-detection cache. */
export const AI_TEXT_DETECT_CACHE_PREFIX = 'ai:text-detect:';

/** Internal shape stored under each cache key. */
interface CachedDetection {
  likelihood: number;
  signals: string[];
}

@Injectable()
export class AiTextDetectService {
  private readonly logger = new Logger(AiTextDetectService.name);

  constructor(
    @Optional() @Inject(AI_GATEWAY) private readonly gateway?: AiGateway,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Classify `text` as AI- or human-authored. Skips the gateway call
   * for empty input and returns `flagged=false` so callers don't
   * need to special-case "no answer yet".
   *
   * Cache flow:
   *   1. Compute `sha256(trimmedText)` → key.
   *   2. Read `ai:text-detect:{sha256}` from Redis. On hit, return the
   *      cached `{ likelihood, signals }` and recompute `flagged`
   *      against the caller's threshold.
   *   3. On miss, call the gateway, then write the result back to
   *      Redis with a 24h TTL.
   */
  async detect(input: AiTextDetectInput): Promise<AiTextDetectResult> {
    const text = (input.text ?? '').trim();
    const threshold = clamp01(input.threshold ?? AI_LIKELIHOOD_FLAG_THRESHOLD);

    if (text.length === 0) {
      return {
        likelihood: 0,
        signals: ['empty-text'],
        flagged: false,
        threshold,
        cached: false,
      };
    }

    const cacheKey = buildCacheKey(text);

    // Cache lookup — best-effort. Failures fall through to the gateway.
    if (!input.skipCache) {
      const hit = await this.tryReadCache(cacheKey);
      if (hit) {
        const likelihood = clamp01(hit.likelihood);
        return {
          likelihood,
          signals: hit.signals,
          flagged: likelihood >= threshold,
          threshold,
          cached: true,
        };
      }
    }

    if (!this.gateway) {
      // Gateway not wired (rare — only happens in narrowly scoped
      // unit tests that bypass `AiModule`). We log and degrade to a
      // not-flagged response so callers still get a stable shape.
      this.logger.warn(
        'AiTextDetectService.detect: AiGateway is not wired; returning likelihood=0',
      );
      return {
        likelihood: 0,
        signals: ['gateway-unavailable'],
        flagged: false,
        threshold,
        cached: false,
      };
    }

    const response = await this.gateway.detectAiText({
      ...(input.userId ? { userId: input.userId } : {}),
      text,
    });

    const likelihood = clamp01(response.likelihood ?? 0);
    const signals = response.signals ?? [];

    // Best-effort cache write. We never block on this — the cache is
    // a performance / cost optimisation, not a correctness layer.
    await this.tryWriteCache(cacheKey, { likelihood, signals });

    return {
      likelihood,
      signals,
      flagged: likelihood >= threshold,
      threshold,
      cached: false,
    };
  }

  // ==================================================================
  // Cache helpers
  // ==================================================================

  private async tryReadCache(key: string): Promise<CachedDetection | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CachedDetection>;
      if (
        typeof parsed.likelihood !== 'number' ||
        !Array.isArray(parsed.signals)
      ) {
        // Corrupt entry — log and treat as miss. The next call will
        // overwrite it with a well-formed payload.
        this.logger.warn(
          `AiTextDetectService: malformed cache entry for ${key}; treating as miss`,
        );
        return null;
      }
      return {
        likelihood: parsed.likelihood,
        signals: parsed.signals.map((s) => String(s)),
      };
    } catch (error) {
      this.logger.warn(
        `AiTextDetectService: cache read failed for ${key}: ${(error as Error).message}; treating as miss`,
      );
      return null;
    }
  }

  private async tryWriteCache(
    key: string,
    value: CachedDetection,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        AI_TEXT_DETECT_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `AiTextDetectService: cache write failed for ${key}: ${(error as Error).message}`,
      );
    }
  }
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Build the Redis cache key for `text`. The hash is computed over the
 * already-trimmed body so trivial whitespace differences (tab vs.
 * space, trailing newline) collapse onto the same cache entry.
 */
function buildCacheKey(text: string): string {
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  return `${AI_TEXT_DETECT_CACHE_PREFIX}${digest}`;
}
