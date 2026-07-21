import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';

import { RedisService } from '../../../infra/redis/redis.service';
import {
  SENTRY_ADAPTER,
  type SentryAdapter,
} from '../../../infra/sentry/sentry.port';

import { CorrelationEngine } from './correlation.engine';
import {
  SIEM_RETENTION_LIMIT,
  SIEM_CORRELATION_WINDOW_SEC,
  type SiemEventInput,
  type SiemEventRecord,
  type SiemEventType,
  type SiemSeverity,
} from './siem.types';

/**
 * `SiemService` — Task 27.5, Req 27.7.
 *
 * Central ingestion point for every security-relevant event the
 * platform produces. Three things happen on each call to
 * `recordEvent`:
 *
 *   1. **Structured log emission** — the event is logged at a level
 *      mapped from severity (LOG/WARN/ERROR) and tagged with
 *      `event=security.<type>` so Loki/Grafana can pick it up. The
 *      log line is the SIEM source of truth.
 *   2. **Sentry forwarding** — events with `severity === 'HIGH'` or
 *      `'CRITICAL'` are forwarded through `SENTRY_ADAPTER` so the
 *      on-call rotation gets paged.
 *   3. **Per-IP / per-user buffering** — the latest 1000 events are
 *      retained in Redis lists keyed by IP and userId so the
 *      correlation engine can run sliding-window rules without
 *      hitting durable storage.
 *
 * The service is fail-open: any Redis or Sentry hiccup logs a single
 * WARN line and lets the caller continue. Security telemetry must
 * never block the request that produced it.
 *
 * **Why a separate service instead of inline `logger.warn` calls?**
 * Three reasons:
 *   - Severity is structured (LOW → CRITICAL) so the alert layer
 *     gets a stable contract.
 *   - The correlation engine needs a single sequence per IP / per
 *     user; building it lazily from log queries would force a
 *     dependency on Loki at runtime.
 *   - Future Phase 10 components (impossible-travel, bot-detection)
 *     plug into the same surface without re-implementing the JSON
 *     line shape or the Sentry forwarding rule.
 */
@Injectable()
export class SiemService {
  private readonly logger = new Logger(SiemService.name);

  /** Per-IP retention list TTL — `2 * window` so an idle IP fades out. */
  static readonly RETENTION_TTL_SEC = SIEM_CORRELATION_WINDOW_SEC * 2;

  /** Redis key prefix — centralised so operators can grep them. */
  static readonly KEY_PREFIX = 'siem';

  constructor(
    @Optional() private readonly redis?: RedisService,
    @Optional()
    @Inject(SENTRY_ADAPTER)
    private readonly sentry?: SentryAdapter,
    @Optional()
    @Inject(forwardRef(() => CorrelationEngine))
    private readonly correlationEngine?: CorrelationEngine,
  ) {}

  // =====================================================================
  // Public API
  // =====================================================================

  /**
   * Record one security event. Always returns successfully — the
   * service swallows downstream failures so a Redis blip cannot
   * suppress an auth response or a controller's normal flow.
   */
  async recordEvent(event: SiemEventInput): Promise<void> {
    const record = this.buildRecord(event);

    // 1) Always emit the structured log first — it's the source of truth.
    this.emitStructuredLog(record);

    // 2) Forward HIGH/CRITICAL to Sentry for paging.
    if (
      (record.severity === 'HIGH' || record.severity === 'CRITICAL') &&
      this.sentry
    ) {
      try {
        const ctx: {
          traceId?: string;
          userId?: string | null;
          tags: Record<string, string>;
        } = {
          userId: record.userId,
          tags: {
            eventType: record.type,
            severity: record.severity,
            clientIp: record.ip,
          },
        };
        if (record.traceId) ctx.traceId = record.traceId;
        await this.sentry.captureException(
          new SiemSecurityEvent(record),
          ctx,
        );
      } catch (err) {
        this.logger.warn(
          `recordEvent: Sentry forward failed for ${record.type}: ${(err as Error).message}`,
        );
      }
    }

    // 3) Buffer in Redis for the correlation engine (best-effort).
    await this.bufferEvent(record);

    // 4) Run correlation rules synchronously — produces follow-on
    //    events when matches fire. The engine guards against
    //    re-entrancy so a correlation match doesn't recurse.
    if (this.correlationEngine) {
      try {
        await this.correlationEngine.evaluate(record);
      } catch (err) {
        this.logger.warn(
          `recordEvent: correlation engine failed: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Read the recent event sequence for a given IP. Returns the most
   * recent first. Window is the standard correlation window
   * (15 min). Internal — exposed for the correlation engine and
   * tests.
   */
  async readRecentForIp(
    ip: string,
    windowSec: number = SIEM_CORRELATION_WINDOW_SEC,
  ): Promise<SiemEventRecord[]> {
    return this.readWindow(this.ipKey(this.normalizeIp(ip)), windowSec);
  }

  /** Same shape as `readRecentForIp` but keyed by userId. */
  async readRecentForUser(
    userId: string,
    windowSec: number = SIEM_CORRELATION_WINDOW_SEC,
  ): Promise<SiemEventRecord[]> {
    return this.readWindow(this.userKey(userId), windowSec);
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private buildRecord(event: SiemEventInput): SiemEventRecord {
    return {
      type: event.type,
      severity: event.severity,
      userId: event.userId ?? null,
      ip: this.normalizeIp(event.ip),
      traceId: event.traceId ?? null,
      occurredAt: Date.now(),
      payload: this.sanitizePayload(event.payload ?? {}),
    };
  }

  /**
   * Sanitize the payload bag so we never leak secrets / PII into the
   * log stream. Authorization, Cookie, password, token and similar
   * keys are dropped. We only redact at the top level (deep redaction
   * is the caller's responsibility — they know which fields exist).
   */
  private sanitizePayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const lower = key.toLowerCase();
      if (
        lower === 'password' ||
        lower === 'token' ||
        lower === 'authorization' ||
        lower === 'cookie' ||
        lower === 'secret'
      ) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = value;
    }
    return out;
  }

  /**
   * Map severity to the Nest log level. Loki picks up the level field
   * and the dashboards filter on it; we keep the JSON line identical
   * across levels so a single regex fits all severities.
   */
  private emitStructuredLog(record: SiemEventRecord): void {
    const message = `Security event: ${record.type}`;
    const line = {
      event: record.type,
      severity: record.severity,
      message,
      userId: record.userId,
      clientIp: record.ip,
      traceId: record.traceId,
      occurredAt: new Date(record.occurredAt).toISOString(),
      payload: record.payload,
    };

    switch (record.severity) {
      case 'CRITICAL':
      case 'HIGH':
        this.logger.error(line);
        break;
      case 'MEDIUM':
        this.logger.warn(line);
        break;
      case 'LOW':
      default:
        this.logger.log(line);
        break;
    }
  }

  /**
   * Push the event onto the per-IP and (when known) per-user Redis
   * lists. Each list is capped at `SIEM_RETENTION_LIMIT` via `LTRIM`
   * so memory stays bounded even on a long-running attacker.
   */
  private async bufferEvent(record: SiemEventRecord): Promise<void> {
    if (!this.redis) return;
    const serialised = JSON.stringify(record);
    const keys = [this.ipKey(record.ip)];
    if (record.userId) keys.push(this.userKey(record.userId));

    for (const key of keys) {
      try {
        const client = this.redis.getClient();
        await client.lpush(key, serialised);
        await client.ltrim(key, 0, SIEM_RETENTION_LIMIT - 1);
        await client.expire(key, SiemService.RETENTION_TTL_SEC);
      } catch (err) {
        this.logger.warn(
          `bufferEvent: LPUSH failed for ${key}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async readWindow(
    key: string,
    windowSec: number,
  ): Promise<SiemEventRecord[]> {
    if (!this.redis) return [];
    const cutoff = Date.now() - windowSec * 1000;
    let raw: string[];
    try {
      const client = this.redis.getClient();
      raw = (await client.lrange(key, 0, SIEM_RETENTION_LIMIT - 1)) as string[];
    } catch (err) {
      this.logger.warn(
        `readWindow: LRANGE failed for ${key}: ${(err as Error).message}`,
      );
      return [];
    }

    const out: SiemEventRecord[] = [];
    for (const entry of raw) {
      try {
        const parsed = JSON.parse(entry) as SiemEventRecord;
        if (parsed.occurredAt >= cutoff) {
          out.push(parsed);
        }
      } catch {
        // Drop unparseable entries silently — they shouldn't exist
        // because we control both write and read paths.
      }
    }
    return out;
  }

  private ipKey(ip: string): string {
    return `${SiemService.KEY_PREFIX}:ip:${ip}`;
  }

  private userKey(userId: string): string {
    return `${SiemService.KEY_PREFIX}:user:${userId}`;
  }

  private normalizeIp(ip: string): string {
    return (ip ?? 'unknown').trim() || 'unknown';
  }
}

/**
 * Tagged Error subclass so Sentry's "issue" grouping picks events
 * up by type rather than location. The platform never throws this
 * — `SiemService` constructs it for the `captureException` call.
 */
export class SiemSecurityEvent extends Error {
  readonly siemType: SiemEventType;
  readonly siemSeverity: SiemSeverity;
  readonly siemRecord: SiemEventRecord;

  constructor(record: SiemEventRecord) {
    super(`Security event: ${record.type} (${record.severity})`);
    this.name = 'SiemSecurityEvent';
    this.siemType = record.type;
    this.siemSeverity = record.severity;
    this.siemRecord = record;
  }
}
