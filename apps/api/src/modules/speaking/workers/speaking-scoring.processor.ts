import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import {
  SpeakingScoreOutcome,
  SpeakingScoringService,
} from '../speaking-scoring.service';
import { type SpeakingScoringJob } from '../speaking-scoring.types';

/**
 * SpeakingScoringProcessor — BullMQ worker for the `speaking-scoring`
 * queue (Task 4.2, Req 7.3, 7.4).
 *
 * Delegates to `SpeakingScoringService.score(submissionId)`, which is
 * idempotent — a re-delivered job for a submission that already has an
 * AI_DRAFT row (or that is no longer SUBMITTED) is a no-op. The worker
 * acks the job on the idempotent-skip and not-found paths so BullMQ does
 * not retry forever; any other error bubbles up so the queue's
 * attempts=3 + exponential backoff policy applies. On the FINAL failed
 * attempt the worker marks the submission failed + notifies the
 * instructor for manual review (Task 4.3, Req 7.5) before re-throwing.
 */
@Processor(QUEUE_NAMES.SPEAKING_SCORING)
export class SpeakingScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(SpeakingScoringProcessor.name);

  constructor(private readonly scoringService: SpeakingScoringService) {
    super();
  }

  async process(
    job: Job<SpeakingScoringJob>,
  ): Promise<SpeakingScoreOutcome & { action: 'processed' | 'skipped' | 'not_found' }> {
    const submissionId = job.data?.submissionId;

    if (typeof submissionId !== 'string' || submissionId.length === 0) {
      this.logger.warn(
        `SpeakingScoringProcessor: job ${job.id} missing submissionId; skipping`,
      );
      return {
        submissionId: '',
        action: 'skipped',
        feedbackCreated: false,
        skipped: true,
        score: null,
      };
    }

    let outcome: SpeakingScoreOutcome;
    try {
      outcome = await this.scoringService.score(submissionId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        this.logger.warn(
          `SpeakingScoringProcessor: submission ${submissionId} not found; skipping`,
        );
        return {
          submissionId,
          action: 'not_found',
          feedbackCreated: false,
          skipped: true,
          score: null,
        };
      }

      // Final-failure handling (Task 4.3, Req 7.5). Mirror the
      // email/telegram processors: detect retry exhaustion via
      // attemptsMade vs opts.attempts. On the LAST failed attempt, mark
      // the submission failed + notify the instructor for manual review,
      // then re-throw so BullMQ records the job in the failed set.
      const attempts = job.opts?.attempts ?? 1;
      const willRetry = (job.attemptsMade ?? 0) + 1 < attempts;
      if (!willRetry) {
        try {
          await this.scoringService.markScoringFailed(
            submissionId,
            (error as Error).message,
          );
        } catch (markError) {
          // Never let the failure-marking path mask the original error or
          // crash the worker — log and fall through to the re-throw.
          this.logger.error(
            `SpeakingScoringProcessor: failed to mark submission ${submissionId} ` +
              `as failed: ${(markError as Error).message}`,
          );
        }
      }

      // Re-throw so BullMQ retries (until exhaustion, handled above).
      throw error;
    }

    return {
      ...outcome,
      action: outcome.skipped ? 'skipped' : 'processed',
    };
  }
}
