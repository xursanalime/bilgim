import { Injectable, Logger } from '@nestjs/common';

import {
  SentryAdapter,
  SentryCaptureResult,
  SentryEventContext,
} from './sentry.port';

/**
 * NoopSentryAdapter — drops every event (Task 24.3).
 *
 * Used in dev / test environments where shipping errors to a real
 * Sentry project would generate noise. We still log a debug line so
 * developers can confirm the call site fired during local debugging.
 */
@Injectable()
export class NoopSentryAdapter implements SentryAdapter {
  private readonly logger = new Logger(NoopSentryAdapter.name);

  async captureException(
    error: unknown,
    context?: SentryEventContext,
  ): Promise<SentryCaptureResult> {
    this.logger.debug(
      `Sentry (noop) capture: ${(error as Error)?.message ?? String(error)} traceId=${context?.traceId ?? '-'}`,
    );
    return { ok: true };
  }
}
