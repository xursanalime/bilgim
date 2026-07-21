import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { RecordingService } from './recording.service';

/**
 * BullMQ job payload for the recording processor.
 *
 * Pushed onto the dedicated `live-recording` queue by `OutboxDispatcher`
 * via the topic→queue map. The processor inspects `topic` to decide
 * whether to start or finalize a recording.
 *
 * Why a dedicated queue?
 *   `live.started` / `live.ended` events are fanned out to BOTH the
 *   `notification-fanout` queue (so students get the live-started push
 *   alert) and the `live-recording` queue (so the recorder lifecycle
 *   runs). BullMQ assigns each job to a single consumer per queue, so
 *   we cannot rely on the same queue feeding two different processors.
 */
export interface RecordingJob {
  topic: string;
  payload: {
    sessionId?: string;
    [key: string]: unknown;
  };
  outboxEventId?: string;
  idempotencyKey?: string;
}

export interface RecordingJobResult {
  topic: string;
  sessionId: string;
  action: 'started' | 'finalized' | 'skipped';
  /** Set on the finalize path. */
  status?: 'READY' | 'FAILED';
  recordingId?: string;
  assetId?: string | null;
  failureReason?: string;
}

/**
 * RecordingProcessor — translates `live.started` / `live.ended` outbox
 * events into recorder lifecycle calls (Req 9.2, 9.5, 9.6, 9.7, 9.8).
 *
 * Behaviour:
 *  - `live.started` → `RecordingService.startRecording(sessionId)`. This
 *    is best-effort: a thrown error bubbles up to BullMQ for retry, but
 *    a missing session causes a SKIPPED result so the queue does not
 *    spin forever.
 *  - `live.ended` → `RecordingService.finalizeRecording(sessionId)`.
 *    The service guarantees the LiveSession reaches a terminal status
 *    (Req 9.8); the processor merely surfaces the outcome.
 *  - any other topic that lands here is ignored — the dispatcher only
 *    routes recording-related topics to this queue, so an unrelated
 *    job is a wiring bug we surface as a SKIPPED result.
 */
@Processor(QUEUE_NAMES.LIVE_RECORDING)
export class RecordingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(private readonly recordingService: RecordingService) {
    super();
  }

  async process(job: Job<RecordingJob>): Promise<RecordingJobResult> {
    const topic = job.data?.topic ?? job.name;
    const sessionId = job.data?.payload?.sessionId;

    if (topic !== 'live.started' && topic !== 'live.ended') {
      // Not a recording topic — handled by another processor.
      return {
        topic,
        sessionId: sessionId ?? '',
        action: 'skipped',
      };
    }

    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      this.logger.warn(
        `RecordingProcessor: ${topic} payload missing sessionId; skipping (job=${job.id})`,
      );
      return { topic, sessionId: '', action: 'skipped' };
    }

    if (topic === 'live.started') {
      try {
        await this.recordingService.startRecording(sessionId);
        return { topic, sessionId, action: 'started' };
      } catch (error) {
        // Re-throw → BullMQ retries with the configured backoff. If
        // the session has been cleaned up between dispatch and process
        // (e.g. test scenario), surface as a SKIPPED result rather
        // than retrying forever.
        const code = (error as { status?: number }).status;
        if (code === 404) {
          this.logger.warn(
            `RecordingProcessor: live.started session ${sessionId} not found; skipping`,
          );
          return { topic, sessionId, action: 'skipped' };
        }
        throw error;
      }
    }

    // topic === 'live.ended'
    try {
      const outcome = await this.recordingService.finalizeRecording(sessionId);
      const result: RecordingJobResult = {
        topic,
        sessionId,
        action: 'finalized',
        status: outcome.status,
        recordingId: outcome.recordingId,
        assetId: outcome.assetId,
      };
      if (outcome.failureReason) {
        result.failureReason = outcome.failureReason;
      }
      return result;
    } catch (error) {
      const code = (error as { status?: number }).status;
      if (code === 404) {
        this.logger.warn(
          `RecordingProcessor: live.ended session ${sessionId} not found; skipping`,
        );
        return { topic, sessionId, action: 'skipped' };
      }
      // Any other error → bubble up so BullMQ retries. RecordingService
      // already commits a RECORDING_FAILED status on permanent failures
      // (Req 9.8), so this only retries genuinely-transient errors.
      throw error;
    }
  }
}
