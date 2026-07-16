import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  SentryAdapter,
  SentryCaptureResult,
  SentryEventContext,
} from './sentry.port';

/**
 * RealSentryAdapter — production stub (Task 24.3, Req 26.4).
 *
 * The platform doesn't yet ship `@sentry/node`. This adapter logs a
 * structured "would-have-been-captured" record so production deploys
 * still get a permanent breadcrumb of every 5xx — useful when
 * triaging incidents before the real SDK is wired up.
 *
 * Replacement plan: swap the `console.error` for
 * `Sentry.captureException(error, { extra: context })` inside an
 * `init()`-wrapped scope. The port's contract (`SentryAdapter`) is
 * stable enough that the rest of the codebase won't need to change.
 */
@Injectable()
export class RealSentryAdapter implements SentryAdapter {
  private readonly logger = new Logger(RealSentryAdapter.name);

  async captureException(
    error: unknown,
    context?: SentryEventContext,
  ): Promise<SentryCaptureResult> {
    const eventId = randomUUID();
    const message = (error as Error)?.message ?? String(error);
    const stack =
      error instanceof Error
        ? (error.stack ?? null)?.split('\n').slice(0, 12).join('\n')
        : null;

    this.logger.error({
      message: 'Sentry capture (stub)',
      eventId,
      error: message,
      stack,
      traceId: context?.traceId ?? null,
      route: context?.route ?? null,
      method: context?.method ?? null,
      statusCode: context?.statusCode ?? null,
      userId: context?.userId ?? null,
      tags: context?.tags ?? null,
    });

    return { ok: true, eventId };
  }
}
