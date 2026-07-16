/**
 * Sentry port (Task 24.3, Req 26.4).
 *
 * The platform doesn't ship the `@sentry/node` SDK in this phase —
 * adopting it depends on the production telemetry plan. Instead we
 * define a minimal port the rest of the codebase can call, and bind
 * one of two adapters:
 *
 *   - `NoopSentryAdapter` — drops every event, used in dev/test.
 *   - `RealSentryAdapter` — placeholder for the production SDK.
 *     It currently logs to the Nest logger and returns success;
 *     swapping in `Sentry.captureException` later is a one-file
 *     change.
 *
 * Why a port instead of a direct import:
 *   - Lets us unit-test `AllExceptionsFilter` without booting Sentry.
 *   - Keeps the Sentry SDK out of the test-time dependency graph,
 *     so CI doesn't pay the cost of its native bindings.
 *   - Documents the exact subset of Sentry surface this codebase
 *     relies on (currently only `captureException`).
 */
export const SENTRY_ADAPTER = Symbol('SENTRY_ADAPTER');

export interface SentryEventContext {
  /** Request correlation id, used to cross-reference with logs. */
  traceId?: string;
  /** Resolved express route, e.g. `/lessons/:lessonId`. */
  route?: string;
  /** HTTP method when the event originated from a request. */
  method?: string;
  /** HTTP status code returned to the client. */
  statusCode?: number;
  /** Authenticated user id, when available. */
  userId?: string | null;
  /** Free-form key/value bag — keep small (< 4 KB). */
  tags?: Record<string, string | number | boolean | null | undefined>;
}

export interface SentryCaptureResult {
  /** True when the adapter accepted the event for delivery. */
  ok: boolean;
  /** Provider-side event id, when the underlying SDK exposes one. */
  eventId?: string;
}

export interface SentryAdapter {
  /**
   * Report an unhandled exception. Implementations MUST be
   * fire-and-forget — the caller (typically a NestJS filter) cannot
   * afford to block on a remote round-trip while serializing the
   * client's error response.
   */
  captureException(
    error: unknown,
    context?: SentryEventContext,
  ): Promise<SentryCaptureResult>;
}
