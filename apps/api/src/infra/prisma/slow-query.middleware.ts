import { Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Threshold (ms) above which a Prisma operation is logged as "slow".
 * 200ms matches the design.md API budget envelope: with a p95 latency
 * target of <250ms for the whole request, any single query crossing
 * 200ms is interesting enough to surface in development logs.
 */
export const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 200;

export interface SlowQueryMiddlewareOptions {
  /** Override the 200ms default — primarily for tests. */
  thresholdMs?: number;
  /** Custom Nest logger (tests pass an in-memory spy). */
  logger?: Pick<Logger, 'warn'>;
  /** Override `Date.now()` — primarily for deterministic tests. */
  now?: () => number;
}

/**
 * Build a Prisma middleware function that emits a single `warn` log
 * line per query taking longer than {@link
 * DEFAULT_SLOW_QUERY_THRESHOLD_MS} milliseconds.
 *
 * The log payload is intentionally narrow:
 *
 *   ```json
 *   { "model": "User", "action": "findMany", "durationMs": 312 }
 *   ```
 *
 * No SQL, no params — that responsibility lives in the
 * `prisma.factory` query-event listener (which scrubs PII before
 * logging). This middleware focuses on the `(model, action,
 * duration)` triple that engineers can grep for in Loki without ever
 * touching user data.
 *
 * Returned as a higher-order helper so tests can construct one with a
 * stub logger and clock without depending on Nest's DI.
 *
 * Requirements: 20.7 (observability), 26 (structured logging).
 */
export function createSlowQueryMiddleware(
  options: SlowQueryMiddlewareOptions = {},
): Prisma.Middleware {
  const threshold =
    options.thresholdMs ?? DEFAULT_SLOW_QUERY_THRESHOLD_MS;
  const logger = options.logger ?? new Logger('PrismaSlowQuery');
  const now = options.now ?? Date.now;

  return async function slowQueryMiddleware(params, next) {
    const startedAt = now();
    try {
      return await next(params);
    } finally {
      const durationMs = now() - startedAt;
      if (durationMs > threshold) {
        logger.warn({
          message: 'Slow Prisma query',
          model: params.model ?? 'raw',
          action: params.action,
          durationMs,
        });
      }
    }
  };
}

/**
 * Wire {@link createSlowQueryMiddleware} into a `PrismaClient`
 * instance when the operator has opted in.
 *
 * Activation rules (Task 24.2):
 *   - `LOG_SLOW_QUERIES === true`  → attach the middleware in any env.
 *   - `LOG_SLOW_QUERIES === false` → never attach.
 *   - `LOG_SLOW_QUERIES` undefined → attach only in `development`,
 *     so production stays quiet by default.
 *
 * Returns `true` when the middleware was attached, `false` otherwise
 * — useful for diagnostics and easy to assert against in tests.
 */
export function maybeAttachSlowQueryMiddleware(
  client: PrismaClient,
  env: { NODE_ENV?: string; LOG_SLOW_QUERIES?: boolean | undefined },
  options: SlowQueryMiddlewareOptions = {},
): boolean {
  const explicit = env.LOG_SLOW_QUERIES;
  const shouldAttach =
    explicit === true ||
    (explicit === undefined && env.NODE_ENV === 'development');

  if (!shouldAttach) return false;

  // `$use` is deprecated in Prisma 5.x in favor of `$extends`, but it
  // is still supported and is the simplest hook for cross-model
  // duration logging. We keep the helper small enough that swapping
  // to a `$extends` middleware later is a one-file change.
  // Cast through `any` so the helper compiles cleanly on every
  // Prisma version in our matrix.
  const c = client as unknown as {
    $use: (mw: Prisma.Middleware) => void;
  };
  c.$use(createSlowQueryMiddleware(options));
  return true;
}
