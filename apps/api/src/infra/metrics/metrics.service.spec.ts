import { MetricsService, statusClassFromCode } from './metrics.service';

/**
 * MetricsService unit tests (Task 24.3).
 *
 * The service owns a private prom-client `Registry`. We assert the
 * exposition body so that downstream Grafana dashboards / alert rules
 * can rely on the metric names + labels the spec requires:
 *
 *   - http_request_duration_seconds            (Histogram, RED)
 *   - http_requests_total                      (Counter, RED — companion)
 *   - notifications_dispatched_total           (Counter, business)
 *   - bilgim_notification_failed_total      (Counter, business — terminal failures)
 *   - payme_transitions_total                  (Counter, business)
 *   - outbox_pending_events                    (Gauge, USE)
 *   - bilgim_outbox_pending                 (Gauge alias under bilgim_ namespace)
 *   - ai_calls_total                           (Counter, business)
 *   - bilgim_ai_call_duration_seconds       (Histogram, latency)
 */
describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(async () => {
    metrics = new MetricsService();
    metrics.onModuleInit();
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  it('exposes all required custom metric names in Prometheus exposition format', async () => {
    metrics.observeHttpRequest('GET', '/lessons/:id', 200, 0.012);
    metrics.recordNotificationDispatched('LESSON_PUBLISHED', 'EMAIL', 'SENT');
    metrics.recordNotificationFailed('LESSON_PUBLISHED', 'EMAIL', 'upstream_5xx');
    metrics.recordPaymeTransition('CREATED', 'PAID');
    metrics.setOutboxPending(7);
    metrics.recordAiCall('TUTOR_EXPLAIN', 'claude-3-5-sonnet-latest', 'OK');
    metrics.observeAiCallDuration('TUTOR_EXPLAIN', 'claude-3-5-sonnet-latest', 850);

    const { contentType, body } = await metrics.render();

    expect(contentType).toContain('text/plain');
    expect(body).toContain('# TYPE http_request_duration_seconds histogram');
    expect(body).toContain('# TYPE http_requests_total counter');
    expect(body).toContain('# TYPE notifications_dispatched_total counter');
    expect(body).toContain('# TYPE bilgim_notification_failed_total counter');
    expect(body).toContain('# TYPE payme_transitions_total counter');
    expect(body).toContain('# TYPE outbox_pending_events gauge');
    expect(body).toContain('# TYPE bilgim_outbox_pending gauge');
    expect(body).toContain('# TYPE ai_calls_total counter');
    expect(body).toContain('# TYPE bilgim_ai_call_duration_seconds histogram');

    // Default Node.js process metrics — at least one well-known sample.
    expect(body).toMatch(
      /process_cpu_user_seconds_total|process_resident_memory_bytes/,
    );

    // Label values flow through to the exposition lines.
    expect(body).toMatch(
      /notifications_dispatched_total\{[^}]*kind="LESSON_PUBLISHED"[^}]*channel="EMAIL"[^}]*status="SENT"[^}]*\}/,
    );
    expect(body).toMatch(
      /bilgim_notification_failed_total\{[^}]*kind="LESSON_PUBLISHED"[^}]*channel="EMAIL"[^}]*reason="upstream_5xx"[^}]*\}/,
    );
    expect(body).toMatch(
      /payme_transitions_total\{[^}]*from_state="CREATED"[^}]*to_state="PAID"[^}]*\}/,
    );
    expect(body).toMatch(
      /ai_calls_total\{[^}]*intent="TUTOR_EXPLAIN"[^}]*provider="claude-3-5-sonnet-latest"[^}]*status="OK"[^}]*\}/,
    );
    expect(body).toMatch(
      /bilgim_ai_call_duration_seconds_count\{[^}]*intent="TUTOR_EXPLAIN"[^}]*provider="claude-3-5-sonnet-latest"[^}]*\}\s+1/,
    );
    expect(body).toMatch(/outbox_pending_events(?:\{[^}]*\})?\s+7/);
    expect(body).toMatch(/bilgim_outbox_pending(?:\{[^}]*\})?\s+7/);
  });

  it('observeHttpRequest normalises empty routes to "unmatched" and tags status_class', async () => {
    metrics.observeHttpRequest('GET', '', 404, 0.001);
    const { body } = await metrics.render();
    expect(body).toMatch(
      /http_request_duration_seconds_count\{[^}]*method="GET"[^}]*route="unmatched"[^}]*status_code="404"[^}]*\}/,
    );
    expect(body).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="unmatched"[^}]*status_class="4xx"[^}]*\}\s+1/,
    );
  });

  it('histogram buckets are aligned with the p95 SLO budget', async () => {
    metrics.observeHttpRequest('POST', '/auth/login', 200, 0.04);
    const { body } = await metrics.render();
    expect(body).toMatch(
      /http_request_duration_seconds_bucket\{[^}]*le="0\.25"[^}]*\}/,
    );
  });

  it('observeAiCallDuration ignores non-finite latencies', async () => {
    metrics.observeAiCallDuration('TUTOR_EXPLAIN', 'claude', Number.NaN);
    metrics.observeAiCallDuration('TUTOR_EXPLAIN', 'claude', -1);
    metrics.observeAiCallDuration('TUTOR_EXPLAIN', 'claude', 250);
    const { body } = await metrics.render();
    // Only one observation should be recorded — the 250ms sample.
    expect(body).toMatch(
      /bilgim_ai_call_duration_seconds_count\{[^}]*intent="TUTOR_EXPLAIN"[^}]*provider="claude"[^}]*\}\s+1/,
    );
  });
});

describe('statusClassFromCode', () => {
  it.each([
    [199, 'other'],
    [200, '2xx'],
    [299, '2xx'],
    [301, '3xx'],
    [404, '4xx'],
    [499, '4xx'],
    [500, '5xx'],
    [599, '5xx'],
    [600, 'other'],
  ])('maps %i → %s', (code, expected) => {
    expect(statusClassFromCode(code)).toBe(expected);
  });

  it('returns "other" for non-finite values', () => {
    expect(statusClassFromCode(Number.NaN)).toBe('other');
  });
});
