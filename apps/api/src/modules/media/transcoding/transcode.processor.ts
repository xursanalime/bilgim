import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { MediaAssetRepository } from '../repositories/media-asset.repository';
import { VIDEO_TRANSCODE_JOB_NAME } from '../media.types';
import { TranscodingService } from './transcoding.service';

/**
 * Job payload for the `transcoding` BullMQ queue.
 *
 * `assetId` is the only mandatory field; we re-load `originalKey` /
 * `ownerUserId` from the DB inside the processor so a producer that
 * enqueued an outdated payload (e.g. job survived a key rotation) still
 * gets correct behaviour.
 */
export interface VideoTranscodeJob {
  assetId: string;
}

export interface VideoTranscodeResult {
  assetId: string;
  status: 'READY' | 'SKIPPED';
  hlsManifestKey?: string;
  durationMs?: number;
}

/**
 * VideoTranscodeProcessor — consumes the `transcoding` queue and
 * produces HLS variants (Req 8.3, 8.4, 8.5).
 *
 * State machine wired here:
 *
 *   UPLOADED ──▶ TRANSCODING ──▶ READY      (success)
 *                          └──▶ FAILED      (after retries exhausted)
 *
 * Idempotency:
 *   - The `UPLOADED → TRANSCODING` transition uses `updateMany(... where:
 *     status: 'UPLOADED' ...)` and bails out when the count is 0. So if
 *     two workers (or a retry) pick the same job, only the first flips
 *     the row and only the first runs ffmpeg. The losing worker logs a
 *     SKIPPED result and exits cleanly — BullMQ never retries.
 *   - A retry that lands while the row is already TRANSCODING (the prior
 *     attempt crashed mid-encode) re-enters the encoding path because we
 *     also accept `TRANSCODING → TRANSCODING` as a no-op transition.
 *
 * Failure semantics:
 *   - Any thrown error is re-raised so BullMQ schedules a retry per
 *     `attempts` / `backoff`. On the final attempt we flip the row to
 *     FAILED so consumers stop polling.
 */
@Processor(QUEUE_NAMES.TRANSCODING)
export class VideoTranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoTranscodeProcessor.name);

  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly transcoder: TranscodingService,
  ) {
    super();
  }

  async process(job: Job<VideoTranscodeJob>): Promise<VideoTranscodeResult> {
    const name = job.name;
    if (name !== VIDEO_TRANSCODE_JOB_NAME) {
      // Unknown job names are not fatal — just log + skip so an outbox
      // misconfiguration doesn't fill the failed set.
      this.logger.warn(
        `VideoTranscodeProcessor received unknown job name="${name}" id=${job.id}; skipping`,
      );
      return { assetId: job.data.assetId, status: 'SKIPPED' };
    }

    const { assetId } = job.data;
    if (!assetId) {
      throw new Error('VideoTranscodeJob.assetId is required');
    }

    const asset = await this.assets.findById(assetId);
    if (!asset) {
      this.logger.warn(`Transcode job ${job.id}: asset ${assetId} not found`);
      return { assetId, status: 'SKIPPED' };
    }
    if (asset.kind !== 'VIDEO') {
      this.logger.warn(
        `Transcode job ${job.id}: asset ${assetId} kind=${asset.kind} is not VIDEO`,
      );
      return { assetId, status: 'SKIPPED' };
    }
    if (asset.status === 'READY') {
      this.logger.debug(
        `Transcode job ${job.id}: asset ${assetId} already READY, skipping`,
      );
      const response: VideoTranscodeResult = { assetId, status: 'READY' };
      if (asset.hlsManifestKey) response.hlsManifestKey = asset.hlsManifestKey;
      return response;
    }
    if (!asset.originalKey) {
      // No source key means there is nothing to transcode; mark FAILED.
      await this.assets.transitionStatus(
        assetId,
        asset.status,
        'FAILED',
      );
      throw new Error(
        `Asset ${assetId} has no originalKey; cannot transcode`,
      );
    }

    // Try to claim the job: UPLOADED → TRANSCODING. If the row is
    // already TRANSCODING (a previous attempt crashed mid-encode) we
    // re-enter without the transition. Anything else (FAILED already,
    // never UPLOADED) is a no-op skip.
    if (asset.status === 'UPLOADED') {
      const claimed = await this.assets.transitionStatus(
        assetId,
        'UPLOADED',
        'TRANSCODING',
      );
      if (claimed === 0) {
        this.logger.debug(
          `Transcode job ${job.id}: asset ${assetId} was claimed elsewhere`,
        );
        return { assetId, status: 'SKIPPED' };
      }
    } else if (asset.status !== 'TRANSCODING') {
      this.logger.warn(
        `Transcode job ${job.id}: asset ${assetId} in unexpected status ${asset.status}; skipping`,
      );
      return { assetId, status: 'SKIPPED' };
    }

    try {
      const result = await this.transcoder.run(
        assetId,
        asset.originalKey,
        asset.ownerUserId,
      );

      const flipped = await this.assets.transitionStatus(
        assetId,
        'TRANSCODING',
        'READY',
        {
          hlsManifestKey: result.hlsManifestKey,
          ...(result.durationMs > 0 ? { durationMs: result.durationMs } : {}),
        },
      );
      if (flipped === 0) {
        // Another concurrent worker already finalized the row. Treat as
        // success and surface the existing manifest key.
        const fresh = await this.assets.findById(assetId);
        const response: VideoTranscodeResult = {
          assetId,
          status: 'READY',
          hlsManifestKey: fresh?.hlsManifestKey ?? result.hlsManifestKey,
        };
        if (result.durationMs > 0) response.durationMs = result.durationMs;
        return response;
      }

      this.logger.log(
        `Transcode job ${job.id}: asset ${assetId} READY (manifest=${result.hlsManifestKey})`,
      );
      const success: VideoTranscodeResult = {
        assetId,
        status: 'READY',
        hlsManifestKey: result.hlsManifestKey,
      };
      if (result.durationMs > 0) success.durationMs = result.durationMs;
      return success;
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      const willRetry = job.attemptsMade + 1 < attempts;
      const message = (error as Error).message;
      this.logger.warn(
        `Transcode job ${job.id} attempt ${job.attemptsMade + 1}/${attempts} failed for asset ${assetId}: ${message}`,
      );

      if (!willRetry) {
        // Final attempt — flip to FAILED so the asset is observable as
        // un-recoverable. Lost-update is benign because this branch only
        // runs on the final attempt of a retried job.
        await this.assets.transitionStatus(
          assetId,
          'TRANSCODING',
          'FAILED',
        );
      }
      // Re-throw → BullMQ schedules the next retry (or moves to failed
      // set after the final attempt).
      throw error;
    }
  }
}
