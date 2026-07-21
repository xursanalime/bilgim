/**
 * AiRateLimiterService — per-user token bucket dedicated to AI calls
 * (Req 13.5: 60 calls / 10 minutes per student).
 *
 * Why a dedicated rate limiter:
 *   The global `RateLimitInterceptor` is keyed by route + IP/user and
 *   is meant for HTTP traffic shaping. AI calls have a stricter quota
 *   that survives across endpoints (`/ai/tutor`, `/ai/translate-word`,
 *   …) — they all draw from the same bucket. A dedicated counter
 *   keyed by `userId` only is the simplest way to enforce that
 *   without leaking AI policy into the generic interceptor.
 *
 * Implementation:
 *   - Redis INCR + EXPIRE NX, identical pattern to the global limiter.
 *   - Failure mode: open. If Redis is down we let the call through and
 *     log a warning; the alternative — blocking every student because
 *     Redis hiccups — is worse for the platform.
 *   - When the limit is breached we throw `AiRateLimitedError(local)`
 *     so the global filter maps it to 429 with `Retry-After`.
 *
 * Anonymous calls:
 *   The gateway protects "user-less" intents (e.g. translateWord
 *   triggered by a public reading widget) by keying on a stable
 *   pseudo-id provided by the controller (typically the IP). When no
 *   id is provided we DO NOT rate-limit — that branch is reserved for
 *   internal/server-side traffic (BullMQ workers).
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../config/env.schema';
import { RedisService } from '../../infra/redis/redis.service';
import {
  DEFAULT_RATE_LIMIT_MAX_CALLS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
} from './ai.constants';
import { AiRateLimitedError } from './ai.errors';

export interface RateLimiterCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

@Injectable()
export class AiRateLimiterService {
  private readonly logger = new Logger(AiRateLimiterService.name);
  private readonly windowMs: number;
  private readonly maxCalls: number;

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional() config?: ConfigService<EnvConfig, true>,
  ) {
    this.windowMs =
      config?.get('AI_RATE_LIMIT_WINDOW_MS', { infer: true }) ??
      DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.maxCalls =
      config?.get('AI_RATE_LIMIT_MAX_CALLS', { infer: true }) ??
      DEFAULT_RATE_LIMIT_MAX_CALLS;
  }

  /**
   * Record one AI call against the user's quota and throw
   * `AiRateLimitedError` if the call would exceed the window cap.
   *
   * `subject` is the bucket key — typically `user:<id>`. Anonymous
   * call sites should compose their own key (`anon:<ip>`).
   */
  async assertWithinLimit(subject: string | null | undefined): Promise<void> {
    if (!subject) return; // server-side traffic — no limit
    const result = await this.check(subject);
    if (!result.allowed) {
      throw new AiRateLimitedError(result.retryAfterMs, 'local');
    }
  }

  /**
   * Lower-level check that returns the bucket state without throwing.
   * Useful for the controller layer that wants to surface remaining
   * quota in response headers.
   */
  async check(subject: string): Promise<RateLimiterCheckResult> {
    if (!this.redis) {
      // No Redis wired (unit tests, dev-without-cache). Allow every
      // call but track in-memory so tests can assert quota math.
      return this.checkInMemory(subject);
    }

    const key = `ai:rl:${subject}`;
    const ttlSeconds = Math.max(1, Math.ceil(this.windowMs / 1000));
    try {
      const client = this.redis.getClient();
      const pipeline = client.multi();
      pipeline.incr(key);
      pipeline.expire(key, ttlSeconds, 'NX' as any);
      pipeline.ttl(key);
      const replies = await pipeline.exec();

      const count = parseReply<number>(replies, 0) ?? 0;
      let ttl = parseReply<number>(replies, 2) ?? ttlSeconds;
      if (ttl < 0) {
        await client.expire(key, ttlSeconds);
        ttl = ttlSeconds;
      }

      const allowed = count <= this.maxCalls;
      return {
        allowed,
        remaining: Math.max(0, this.maxCalls - count),
        retryAfterMs: allowed ? 0 : Math.max(1000, ttl * 1000),
      };
    } catch (error) {
      this.logger.warn(
        `AiRateLimiterService: Redis check failed for ${subject}: ${(error as Error).message}; allowing call`,
      );
      return {
        allowed: true,
        remaining: this.maxCalls,
        retryAfterMs: 0,
      };
    }
  }

  // -----------------------------------------------------------------
  // In-memory fallback (used by tests). Only correct under a single
  // process; production MUST have Redis configured.
  // -----------------------------------------------------------------

  private memoryBuckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  private checkInMemory(subject: string): RateLimiterCheckResult {
    const now = Date.now();
    const bucket = this.memoryBuckets.get(subject);
    if (!bucket || bucket.resetAt <= now) {
      this.memoryBuckets.set(subject, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return {
        allowed: true,
        remaining: this.maxCalls - 1,
        retryAfterMs: 0,
      };
    }
    bucket.count += 1;
    const allowed = bucket.count <= this.maxCalls;
    return {
      allowed,
      remaining: Math.max(0, this.maxCalls - bucket.count),
      retryAfterMs: allowed ? 0 : Math.max(1000, bucket.resetAt - now),
    };
  }

  /** Test-only: drop the in-memory state between cases. */
  resetForTesting(): void {
    this.memoryBuckets.clear();
  }
}

function parseReply<T>(replies: any, index: number): T | null {
  if (!Array.isArray(replies) || !Array.isArray(replies[index])) return null;
  return (replies[index][1] as T) ?? null;
}
