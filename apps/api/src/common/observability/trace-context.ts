import { randomUUID } from 'crypto';

/**
 * Trace-context helpers (Task 24.3).
 *
 * Centralises the rules for resolving the `traceId` / `requestId`
 * correlation key from an HTTP request and decorating outbound work
 * (BullMQ jobs, downstream HTTP calls) with the same id so a single
 * user-initiated action can be stitched together end-to-end across
 * the API, the workers, and Sentry/Tempo.
 *
 * Header precedence:
 *   1. `X-Request-Id`  — the de-facto standard set by ingress / API
 *      gateways and the value most clients already send.
 *   2. `X-Trace-Id`    — legacy header used by older parts of the
 *      EduBridge fleet; kept for backward compatibility so a request
 *      originated by an older client still gets stitched together.
 *   3. Newly generated UUIDv4 — the request had no correlation id, so
 *      we mint one ourselves.
 *
 * Output: the resolved id is echoed back to the caller via the
 * `X-Request-Id` and `X-Trace-Id` response headers (see
 * `LoggingInterceptor`) and forwarded into BullMQ via
 * `withTraceJobOptions` so workers can log the same correlation id.
 */

export const TRACE_REQUEST_HEADER = 'x-request-id';
export const TRACE_LEGACY_HEADER = 'x-trace-id';

/**
 * Read the trace id from a request, falling back to a fresh UUID.
 * Pure — does not mutate the request.
 */
export function resolveTraceId(headers: Record<string, unknown>): string {
  const direct = readHeader(headers, TRACE_REQUEST_HEADER);
  if (direct) return direct;
  const legacy = readHeader(headers, TRACE_LEGACY_HEADER);
  if (legacy) return legacy;
  return randomUUID();
}

/**
 * Apply both response headers (`X-Request-Id` + `X-Trace-Id`) to the
 * given response object. No-op when `setHeader` is unavailable so the
 * helper is safe to call from non-HTTP contexts (websocket, GraphQL
 * subscription) without guards at the call site.
 */
export function applyTraceResponseHeaders(
  response: { setHeader?: (name: string, value: string) => void } | null | undefined,
  traceId: string,
): void {
  if (!response || typeof response.setHeader !== 'function') return;
  response.setHeader('X-Request-Id', traceId);
  response.setHeader('X-Trace-Id', traceId);
}

/**
 * Resolve the trace id from a request and stamp it onto the request
 * object. Called from both `LoggingInterceptor` (HTTP entry) and a
 * standalone middleware in tests so the side effect is consistent.
 */
export function attachTraceIdToRequest<T extends { headers?: Record<string, unknown>; traceId?: string; requestId?: string }>(
  request: T,
): string {
  const traceId = resolveTraceId(request.headers ?? {});
  request.traceId = traceId;
  request.requestId = traceId;
  return traceId;
}

function readHeader(headers: Record<string, unknown>, key: string): string | null {
  const raw = headers?.[key];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v.length > 0);
    return typeof first === 'string' && first.length > 0 ? first : null;
  }
  return null;
}
