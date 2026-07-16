/**
 * AiAuditService — writes one `AiCall` row per gateway invocation
 * (Req 13.4). The service is intentionally write-only: nothing else
 * in the gateway pipeline reads back from `AiCall` synchronously, so
 * we keep the surface narrow and let the Prisma client batch where
 * possible.
 *
 * Failure mode:
 *   The audit row write is best-effort. A failure to persist MUST NOT
 *   abort the user-facing response — the operator still gets the
 *   business outcome and we log the audit failure for follow-up. The
 *   alternative (failing the request when audit fails) would convert
 *   a non-critical infra hiccup into a customer-facing 500.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { MetricsService } from '../../infra/metrics/metrics.service';
import type { AiCallAuditRow } from './ai.types';

@Injectable()
export class AiAuditService {
  private readonly logger = new Logger(AiAuditService.name);

  constructor(
    @Optional() private readonly prisma?: PrismaClient,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async record(row: AiCallAuditRow): Promise<void> {
    // Increment the Prometheus counter regardless of whether Prisma
    // is wired — operators rely on `ai_calls_total` to spot rate-limit
    // / error spikes even on dev clusters where the audit DB is in
    // memory or absent.
    this.metrics?.recordAiCall(
      row.intent,
      row.modelName ?? 'unknown',
      row.status,
    );
    // Observe the matching latency sample on the
    // `bilgim_ai_call_duration_seconds` histogram so dashboards can
    // plot p50 / p95 latency per intent + provider (Task 24.3,
    // Req 26.2). Negative / non-finite latencies are filtered inside
    // the metric service.
    this.metrics?.observeAiCallDuration(
      row.intent,
      row.modelName ?? 'unknown',
      row.latencyMs,
    );

    if (!this.prisma) {
      // No Prisma wired — typical in unit tests. Logging is enough for
      // CI assertions; tests that care about audit content stub the
      // client.
      this.logger.debug(
        `AiAuditService: skipping write (no PrismaClient) intent=${row.intent} status=${row.status}`,
      );
      return;
    }
    try {
      await this.prisma.aiCall.create({
        data: {
          userId: row.userId,
          intent: row.intent,
          templateKey: row.templateKey,
          modelName: row.modelName,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          costUsd: new Prisma.Decimal(row.costUsd.toFixed(6)),
          latencyMs: row.latencyMs,
          refType: row.refType,
          refId: row.refId,
          status: row.status,
          errorMsg: row.errorMsg,
        },
      });
    } catch (error) {
      this.logger.error(
        `AiAuditService: failed to record AiCall for intent=${row.intent}: ${(error as Error).message}`,
      );
    }
  }
}
