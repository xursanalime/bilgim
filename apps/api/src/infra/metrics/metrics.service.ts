import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * MetricsService — single source of truth for the Prometheus registry
 * (Task 24.3, Req 26.2 — RED + USE).
 *
 * Owns one process-wide `Registry`, default Node.js metrics
 * (memory, GC, event-loop lag) and the custom histograms / counters /
 * gauges declared by the Task 24.3 spec:
 *
 *   - `http_request_duration_seconds{method,route,status_code}`
 *     — observed by `MetricsInterceptor` for every HTTP request.
 *   - `http_requests_total{method,route,status_class}`
 *     — companion counter that lets dashboards plot request rate and
 *       error rate (status_class = 2xx / 3xx / 4xx / 5xx) without
 *       histogram quantile math.
 *   - `notifications_dispatched_total{kind,channel,status}`
 *     — incremented by the notification fan-out / delivery workers.
 *   - `edubridge_notification_failed_total{kind,channel,reason}`
 *     — bumped from `NotificationDeliveryWorker.onFailure` so on-call
 *       can alert on a sudden failure ratio without slicing the
 *       noisier `notifications_dispatched_total` series.
 *   - `payme_transitions_total{from_state,to_state}`
 *     — incremented by `PaymeService` whenever it changes a
 *       `PaymeTransaction.state` (CREATED→PAID, CREATED→CANCELED, etc.).
 *   - `outbox_pending_events`
 *     — gauge set periodically by `OutboxDispatcher` so an alert can
 *       fire when the outbox lag grows (Req 26.6).
 *   - `edubridge_outbox_pending`
 *     — alias for the same gauge with the `edubridge_` prefix that
 *       Task 24.3 calls out explicitly. Keeping both names lets the
 *       existing dashboards keep working while we migrate.
 *   - `ai_calls_total{intent,provider,status}`
 *     — incremented by `AiAuditService` once per outbound AI call.
 *   - `edubridge_ai_call_duration_seconds{intent,provider}`
 *     — histogram of AI gateway call latency, observed from
 *       `AiAuditService.record(...)` so each `AiCall` row produces one
 *       sample. Buckets cover 50ms → 30s, the realistic envelope for
 *       Anthropic / OpenAI + retry overhead.
 *
 * The service is instantiated as a singleton in the `MetricsModule`,
 * which is `@Global()` so any feature module can `@Inject(MetricsService)`
 * without an explicit import. Counters / gauges are pre-registered at
 * boot so `metrics()` always exposes a stable label set even before
 * the first observation.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry: Registry;
  private defaultMetricsCollected = false;

  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_class'>;
  readonly notificationsDispatched: Counter<'kind' | 'channel' | 'status'>;
  readonly notificationFailures: Counter<'kind' | 'channel' | 'reason'>;
  readonly paymeTransitions: Counter<'from_state' | 'to_state'>;
  readonly outboxPending: Gauge<string>;
  /** Alias gauge under the `edubridge_` namespace required by Task 24.3. */
  readonly edubridgeOutboxPending: Gauge<string>;
  readonly aiCalls: Counter<'intent' | 'provider' | 'status'>;
  readonly aiCallDuration: Histogram<'intent' | 'provider'>;

  constructor() {
    this.registry = new Registry();
    // Apply a stable namespace prefix so dashboards don't have to
    // distinguish edubridge metrics from third-party scrapes.
    this.registry.setDefaultLabels({ service: 'edubridge-api' });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds, labelled by method/route/status_code',
      labelNames: ['method', 'route', 'status_code'] as const,
      // Aligned with the p95 < 250ms requirement (Req 20.7) — buckets
      // around the SLO let us watch the regression budget at a glance.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests served, labelled by method/route/status_class (2xx/3xx/4xx/5xx)',
      labelNames: ['method', 'route', 'status_class'] as const,
      registers: [this.registry],
    });

    this.notificationsDispatched = new Counter({
      name: 'notifications_dispatched_total',
      help: 'Notification deliveries dispatched, labelled by kind/channel/status',
      labelNames: ['kind', 'channel', 'status'] as const,
      registers: [this.registry],
    });

    this.notificationFailures = new Counter({
      name: 'edubridge_notification_failed_total',
      help: 'Notification delivery failures (terminal — final retry exhausted), labelled by kind/channel/reason',
      labelNames: ['kind', 'channel', 'reason'] as const,
      registers: [this.registry],
    });

    this.paymeTransitions = new Counter({
      name: 'payme_transitions_total',
      help: 'Payme transaction state-machine transitions',
      labelNames: ['from_state', 'to_state'] as const,
      registers: [this.registry],
    });

    this.outboxPending = new Gauge({
      name: 'outbox_pending_events',
      help: 'Number of OutboxEvent rows currently in PENDING status',
      registers: [this.registry],
    });

    this.edubridgeOutboxPending = new Gauge({
      name: 'edubridge_outbox_pending',
      help: 'Number of OutboxEvent rows currently in PENDING status (edubridge_ prefix)',
      registers: [this.registry],
    });

    this.aiCalls = new Counter({
      name: 'ai_calls_total',
      help: 'AI gateway calls, labelled by intent/provider/status',
      labelNames: ['intent', 'provider', 'status'] as const,
      registers: [this.registry],
    });

    this.aiCallDuration = new Histogram({
      name: 'edubridge_ai_call_duration_seconds',
      help: 'AI gateway call latency in seconds, labelled by intent/provider',
      labelNames: ['intent', 'provider'] as const,
      // Anthropic / OpenAI typical P50 ~600ms, P95 ~3s, with retries
      // pushing into 10–30s for slow/large prompts.
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    if (this.defaultMetricsCollected) return;
    // Default Node.js process metrics — memory, GC, event-loop lag,
    // CPU, file descriptors. Idempotent across hot-reloads.
    collectDefaultMetrics({ register: this.registry });
    this.defaultMetricsCollected = true;
    this.logger.log('Prometheus default + custom metrics registered');
  }

  onModuleDestroy(): void {
    // Reset the registry on shutdown so test runs that bring the
    // module up multiple times never collide on metric names
    // (prom-client throws on duplicate registration).
    this.registry.clear();
    this.defaultMetricsCollected = false;
  }

  /**
   * Render the full registry in Prometheus exposition format.
   * Used by the `/metrics` controller.
   */
  async render(): Promise<{ contentType: string; body: string }> {
    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }

  /**
   * Test-only escape hatch — allows specs to assert on a metric
   * without parsing the exposition format.
   */
  getRegistry(): Registry {
    return this.registry;
  }

  // ------------------------------------------------------------------
  // Convenience recorders — keep callers free of label-bag plumbing.
  // ------------------------------------------------------------------

  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    // Fall back to a stable placeholder when the route can't be
    // resolved (404 paths, raw express routes). Without this, every
    // unique URL would produce a new label series and blow up the
    // metric cardinality.
    const safeRoute = route && route.length > 0 ? route : 'unmatched';
    const upperMethod = method.toUpperCase();
    this.httpRequestDuration
      .labels(upperMethod, safeRoute, String(statusCode))
      .observe(durationSeconds);
    this.httpRequestsTotal
      .labels(upperMethod, safeRoute, statusClassFromCode(statusCode))
      .inc();
  }

  recordNotificationDispatched(
    kind: string,
    channel: string,
    status: string,
  ): void {
    this.notificationsDispatched.labels(kind, channel, status).inc();
  }

  /**
   * Record a *terminal* notification failure (final retry exhausted
   * or unrecoverable validation error). Called from the per-channel
   * BullMQ workers when they decide not to retry. The `reason` label
   * is a stable short tag (`upstream_5xx`, `chat_id_missing`,
   * `user_not_found`, …) — keep cardinality bounded.
   */
  recordNotificationFailed(
    kind: string,
    channel: string,
    reason: string,
  ): void {
    this.notificationFailures.labels(kind, channel, reason).inc();
  }

  recordPaymeTransition(fromState: string, toState: string): void {
    this.paymeTransitions.labels(fromState, toState).inc();
  }

  setOutboxPending(value: number): void {
    this.outboxPending.set(value);
    this.edubridgeOutboxPending.set(value);
  }

  recordAiCall(intent: string, provider: string, status: string): void {
    this.aiCalls.labels(intent, provider, status).inc();
  }

  /**
   * Observe one AI gateway call latency sample for the
   * `edubridge_ai_call_duration_seconds` histogram. `latencyMs` may
   * be 0 when the call short-circuited (rate-limited, no provider
   * round-trip) — we still record it so the count series stays
   * aligned with `ai_calls_total`.
   */
  observeAiCallDuration(
    intent: string,
    provider: string,
    latencyMs: number,
  ): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.aiCallDuration
      .labels(intent, provider)
      .observe(latencyMs / 1000);
  }
}

/** Map a numeric HTTP status into one of `2xx | 3xx | 4xx | 5xx | other`. */
export function statusClassFromCode(statusCode: number): string {
  if (!Number.isFinite(statusCode)) return 'other';
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
}
