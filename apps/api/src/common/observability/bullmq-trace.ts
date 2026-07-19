import type { JobsOptions } from 'bullmq';

/**
 * BullMQ trace propagation (Task 24.3).
 *
 * `withTraceJobOptions` merges the originating request's `traceId` /
 * `requestId` into the BullMQ job options so the worker can pull
 * them off `job.opts` and log them alongside its own messages. This
 * is what lets us answer "show me every log line caused by request
 * abc-123" — the HTTP entry, the outbox dispatch, the email worker,
 * all share the same id.
 *
 * Implementation detail: BullMQ accepts arbitrary keys on the
 * `metadata` field of `JobsOptions` but does not type it tightly.
 * We use the `repeat: undefined` carrier-agnostic shape and stash
 * the trace id under `metadata.traceId`. Workers read it via the
 * `readTraceFromJob` helper.
 *
 * Why options instead of payload: stuffing `traceId` into the job
 * payload would force every job schema to grow a new field and would
 * collide with idempotency-key invariants for some job shapes
 * (notification fan-out treats payload as the contract surface).
 * Putting it on `opts.metadata` keeps the payload clean.
 */

export interface TraceJobMetadata {
  traceId: string;
  requestId: string;
  /**
   * Optional user id of the originating actor. Workers can use this
   * to redact PII or to reconstruct the actor on retries.
   */
  userId?: string | null;
}

interface JobsOptionsWithMetadata extends JobsOptions {
  metadata?: TraceJobMetadata & Record<string, unknown>;
}

/**
 * Merge a `traceId` (and optionally a `userId`) into BullMQ job
 * options. Existing options are preserved verbatim.
 */
export function withTraceJobOptions(
  base: JobsOptions | undefined,
  trace: { traceId: string; userId?: string | null } | null | undefined,
): JobsOptionsWithMetadata {
  if (!trace || !trace.traceId) return (base ?? {}) as JobsOptionsWithMetadata;

  const existing = (base ?? {}) as JobsOptionsWithMetadata;
  const existingMeta =
    (existing.metadata as Record<string, unknown> | undefined) ?? {};
  return {
    ...existing,
    metadata: {
      ...existingMeta,
      traceId: trace.traceId,
      requestId: trace.traceId,
      userId: trace.userId ?? null,
    },
  };
}

/**
 * Read the trace metadata back from a BullMQ Job (used by workers).
 * Returns `null` when no trace was attached.
 */
export function readTraceFromJob(job: {
  opts?: { metadata?: Record<string, unknown> | undefined };
}): TraceJobMetadata | null {
  const meta = job?.opts?.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const traceId = typeof meta.traceId === 'string' ? meta.traceId : null;
  if (!traceId) return null;
  return {
    traceId,
    requestId:
      typeof meta.requestId === 'string' ? meta.requestId : traceId,
    userId:
      typeof meta.userId === 'string' || meta.userId === null
        ? (meta.userId as string | null)
        : null,
  };
}
