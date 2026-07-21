/**
 * AiGradingProcessor — BullMQ worker that drives the AI grading
 * precheck for a single submission (Task 18.2, Req 12.3, 12.4, 13.7,
 * 13.8).
 *
 * Job source:
 *   `SubmissionService.submit(...)` enqueues a job onto the dedicated
 *   `ai-grading` queue (see `infra/bullmq/queue.constants.ts`). The
 *   payload carries everything the worker needs to load the submission
 *   plus the resolved `assignment.modules × answersJson` slices so the
 *   processor doesn't have to reach out to extra modules at runtime.
 *
 * Idempotency:
 *   The processor delegates to `AiGradingService.precheck(submissionId)`,
 *   which itself is idempotent — a re-delivered job for the same
 *   submission returns `{ skipped: true }` without writing a second
 *   Feedback row or extra `AiCall` rows. The worker therefore acks the
 *   job (does not re-throw) on the skipped path.
 *
 * Failure handling:
 *   - 404 (submission deleted between enqueue and dequeue) → SKIPPED
 *     result so BullMQ doesn't retry forever.
 *   - Any other error bubbles up to BullMQ; the queue config sets
 *     attempts=3 with exponential backoff, which is the right policy
 *     for transient adapter / network issues.
 */

import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { HomeworkModuleType } from '@prisma/client';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { AiGradingService, PrecheckResult } from '../ai-grading.service';

/** BullMQ job name used by the processor. */
export const AI_GRADING_JOB_NAME = 'submission.precheck';

/**
 * Job payload pushed onto `ai-grading` by `SubmissionService.submit`.
 *
 * `modules` is the resolved AssignmentModule × answersJson product —
 * we compute it at enqueue time so the worker doesn't have to fan out
 * across two repositories. The processor still re-loads the
 * Submission + Assignment inside `AiGradingService.precheck` to make
 * sure it grades against the current DB state (the snapshot in the
 * payload is just a convenience for tracing / dashboards and could
 * drift from the row by the time the worker runs).
 */
export interface AiGradingJob {
  submissionId: string;
  assignmentId: string;
  studentId: string;
  modules: Array<{
    type: HomeworkModuleType;
    configJson: unknown;
    answer: unknown;
  }>;
  /** Stamped for traceability — matches the Feedback idempotency tag. */
  idempotencyKey?: string;
}

export interface AiGradingJobResult {
  submissionId: string;
  action: 'processed' | 'skipped' | 'not_found';
  feedbackCreated: boolean;
  aiLikelihood: number;
  aiFlagged: boolean;
  moduleCount: number;
}

@Processor(QUEUE_NAMES.AI_GRADING)
export class AiGradingProcessor extends WorkerHost {
  private readonly logger = new Logger(AiGradingProcessor.name);

  constructor(private readonly aiGradingService: AiGradingService) {
    super();
  }

  async process(job: Job<AiGradingJob>): Promise<AiGradingJobResult> {
    const submissionId = job.data?.submissionId;

    if (typeof submissionId !== 'string' || submissionId.length === 0) {
      this.logger.warn(
        `AiGradingProcessor: job ${job.id} missing submissionId; skipping`,
      );
      return {
        submissionId: '',
        action: 'skipped',
        feedbackCreated: false,
        aiLikelihood: 0,
        aiFlagged: false,
        moduleCount: 0,
      };
    }

    let result: PrecheckResult;
    try {
      result = await this.aiGradingService.precheck(submissionId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        this.logger.warn(
          `AiGradingProcessor: submission ${submissionId} not found; skipping`,
        );
        return {
          submissionId,
          action: 'not_found',
          feedbackCreated: false,
          aiLikelihood: 0,
          aiFlagged: false,
          moduleCount: 0,
        };
      }
      throw error;
    }

    return {
      submissionId,
      action: result.skipped ? 'skipped' : 'processed',
      feedbackCreated: result.feedbackCreated,
      aiLikelihood: result.aiLikelihood,
      aiFlagged: result.aiFlagged,
      moduleCount: result.moduleCount,
    };
  }
}
