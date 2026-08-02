/**
 * Observability primitives (Task 24.3).
 *
 * Re-exports the trace-context, BullMQ propagation, and JSON logger
 * helpers so feature modules can wire them with a single import:
 *
 *   import { withTraceJobOptions, resolveTraceId } from '../../common/observability';
 *
 * The infra-level prom-client registry lives at
 * `apps/api/src/infra/metrics` and is intentionally separate — it
 * owns its own NestJS module so bootstrapping can wire global
 * interceptors and the `/metrics` controller.
 */
export {
  TRACE_REQUEST_HEADER,
  TRACE_LEGACY_HEADER,
  resolveTraceId,
  applyTraceResponseHeaders,
  attachTraceIdToRequest,
} from './trace-context';
export {
  withTraceJobOptions,
  readTraceFromJob,
  type TraceJobMetadata,
} from './bullmq-trace';
export {
  StructuredLogger,
  shouldUseJsonLogger,
} from './structured-logger';
