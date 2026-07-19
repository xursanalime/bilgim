import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  LiveSession,
  LiveSessionStatus,
  MediaAsset,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { OutboxService } from '../../../infra/outbox/outbox.service';
import {
  VIDEO_TRANSCODE_BACKOFF_DELAY_MS,
  VIDEO_TRANSCODE_JOB_NAME,
  VIDEO_TRANSCODE_MAX_ATTEMPTS,
} from '../../media/media.types';
import { LiveSessionRepository } from '../repositories/live-session.repository';
import {
  FinalizeRecordingInput,
  FinalizeRecordingResult,
  isFinalizeSuccess,
  RECORDER_PORT,
  RecorderPort,
  StartRecordingInput,
} from './recorder.port';
import {
  RECORDING_STATUS,
  RecordingRepository,
} from './recording.repository';

export interface StartRecordingResult {
  recorderRef: string;
  /** True when this call actually spawned a recorder; false if reused. */
  spawned: boolean;
}

export interface FinalizeRecordingOutcome {
  status: 'READY' | 'FAILED';
  recordingId: string;
  /** MediaAsset id when the finalize succeeded, null otherwise. */
  assetId: string | null;
  /** LiveSession status after finalize — guaranteed to be terminal. */
  liveSessionStatus: LiveSessionStatus;
  /** Failure reason set when status === 'FAILED'. */
  failureReason?: string;
}

/**
 * RecordingService — orchestrates the recorder lifecycle for live
 * sessions (Req 9.5, 9.6, 9.7, 9.8).
 *
 * Responsibilities:
 *
 *   1. **start**: when LiveSession transitions to LIVE (driven by the
 *      `live.started` outbox event), call `RecorderPort.startRecording`
 *      and persist the resulting `recorderRef` on `LiveSession`.
 *      Idempotent — re-running is a no-op when the session already has
 *      a recorderRef.
 *
 *   2. **finalize**: when LiveSession transitions to ENDED (driven by
 *      the `live.ended` outbox event), call
 *      `RecorderPort.finalizeRecording`, then either:
 *        - on success → INSERT MediaAsset(VIDEO, UPLOADED), Recording
 *          (READY), Attachment(role='recording'); enqueue
 *          `video.transcode` for HLS variants (reuses Task 11.2 pipeline).
 *        - on failure → INSERT Recording(FAILED) and transition the
 *          LiveSession to RECORDING_FAILED (Req 9.7, 9.8).
 *      Idempotent — `Recording.sessionId @unique` guarantees a single
 *      row per session, and we catch `P2002` to short-circuit retries.
 *
 * The service NEVER leaves a LiveSession in LIVE — every code path
 * either commits a terminal status (ENDED / RECORDING_FAILED) or
 * propagates an error so the worker retries (which, on its final
 * attempt, will still end up RECORDING_FAILED via the failure branch).
 */
@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly recordingRepository: RecordingRepository,
    private readonly outboxService: OutboxService,
    @Inject(RECORDER_PORT) private readonly recorder: RecorderPort,
    @InjectQueue(QUEUE_NAMES.TRANSCODING)
    private readonly transcodingQueue: Queue,
  ) {}

  // ==================================================================
  // Start (driven by live.started outbox event)
  // ==================================================================

  /**
   * Start the recorder for a LiveSession that has just transitioned to
   * LIVE.
   *
   * Idempotency:
   *  - If `LiveSession.recorderRef` is already set, we trust that a
   *    previous call succeeded and return early without re-spawning.
   *    The recorder port itself also dedupes (per its contract), so a
   *    double-call only ever produces one recorder.
   *  - If the session has already moved to a terminal status (ENDED or
   *    RECORDING_FAILED) the start is skipped — finalize is the right
   *    step at this point and will run through the normal `live.ended`
   *    path.
   */
  async startRecording(sessionId: string): Promise<StartRecordingResult> {
    const session =
      await this.liveSessionRepository.findById(sessionId);
    if (!session) {
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `Live session ${sessionId} not found`,
      });
    }

    if (session.status === 'ENDED' || session.status === 'RECORDING_FAILED') {
      this.logger.debug(
        `startRecording: session ${sessionId} already terminal (status=${session.status}); skipping`,
      );
      return {
        recorderRef: session.recorderRef ?? '',
        spawned: false,
      };
    }

    if (session.recorderRef) {
      this.logger.debug(
        `startRecording: session ${sessionId} already has recorderRef=${session.recorderRef}; skipping`,
      );
      return { recorderRef: session.recorderRef, spawned: false };
    }

    const ownerUserId = await this.loadOwnerUserId(session.lessonId);

    const startInput: StartRecordingInput = {
      sessionId: session.id,
      lessonId: session.lessonId,
      roomId: session.roomId ?? '',
      ownerUserId,
    };

    const { recorderRef } = await this.recorder.startRecording(startInput);

    // Persist the ref so finalize can find it on retry. We do not run
    // this inside a transaction with anything else — the worst case is
    // the recorder spawn succeeds but the DB write fails, in which case
    // a retry of `startRecording` will re-spawn (the port dedupes) and
    // the second write will land.
    await this.prisma.liveSession.updateMany({
      where: { id: session.id, recorderRef: null },
      data: { recorderRef },
    });

    this.logger.log(
      `Recorder started for session ${session.id} (lesson=${session.lessonId} ref=${recorderRef})`,
    );

    return { recorderRef, spawned: true };
  }

  // ==================================================================
  // Finalize (driven by live.ended outbox event)
  // ==================================================================

  /**
   * Finalize the recorder for a LiveSession that has transitioned out
   * of LIVE.
   *
   * Two outcomes:
   *   - **success**: MediaAsset(VIDEO, UPLOADED) + Recording(READY) +
   *     Attachment created in a single transaction; LiveSession stays
   *     ENDED; `video.transcode` enqueued so HLS variants are produced
   *     by the Task 11.2 pipeline.
   *   - **failure**: Recording(FAILED) created; LiveSession transitions
   *     LIVE → RECORDING_FAILED (or stays terminal if it already
   *     dropped there); no transcoding enqueued.
   *
   * Idempotency: `Recording.sessionId` is `@unique`, so a duplicate
   * finalize is detected via `P2002` and the existing recording is
   * returned unchanged.
   */
  async finalizeRecording(
    sessionId: string,
  ): Promise<FinalizeRecordingOutcome> {
    const session =
      await this.liveSessionRepository.findById(sessionId);
    if (!session) {
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `Live session ${sessionId} not found`,
      });
    }

    // Idempotent fast-path: a Recording row already exists for this
    // session → finalize was completed before.
    const existing =
      await this.recordingRepository.findBySessionId(sessionId);
    if (existing) {
      this.logger.debug(
        `finalizeRecording: session ${sessionId} already has recording ${existing.id} (status=${existing.status}); skipping`,
      );
      return {
        status: existing.status === RECORDING_STATUS.READY ? 'READY' : 'FAILED',
        recordingId: existing.id,
        assetId: existing.assetId,
        liveSessionStatus: session.status,
        ...(existing.status === RECORDING_STATUS.FAILED
          ? { failureReason: 'previous finalize attempt failed' }
          : {}),
      };
    }

    if (!session.recorderRef) {
      // No recorder ever ran for this session — record a FAILED row so
      // the LiveSession lands in a terminal state (Req 9.8). We do NOT
      // call `recorder.finalizeRecording` because there is no handle to
      // finalize.
      this.logger.warn(
        `finalizeRecording: session ${sessionId} has no recorderRef; recording marked FAILED`,
      );
      return this.applyFailure(
        session,
        'no recorder was started for this session',
      );
    }

    const ownerUserId = await this.loadOwnerUserId(session.lessonId);

    let result: FinalizeRecordingResult;
    try {
      const input: FinalizeRecordingInput = {
        sessionId: session.id,
        recorderRef: session.recorderRef,
        ownerUserId,
        lessonId: session.lessonId,
      };
      result = await this.recorder.finalizeRecording(input);
    } catch (error) {
      // Recorder threw rather than returning a failure object. Treat as
      // a hard failure so the LiveSession reaches RECORDING_FAILED
      // even when the worker is fundamentally broken — Req 9.8 demands
      // we never get stuck in LIVE.
      const message = (error as Error).message;
      this.logger.error(
        `finalizeRecording: recorder threw for session ${sessionId}: ${message}`,
        (error as Error).stack,
      );
      return this.applyFailure(session, `recorder error: ${message}`);
    }

    if (!isFinalizeSuccess(result)) {
      this.logger.warn(
        `finalizeRecording: recorder reported failure for session ${sessionId}: ${result.failure}`,
      );
      return this.applyFailure(session, result.failure);
    }

    // ----- success branch -----
    return this.applySuccess(session, ownerUserId, result);
  }

  // ==================================================================
  // Internals
  // ==================================================================

  /**
   * Persist a successful finalize: MediaAsset(VIDEO, UPLOADED) +
   * Recording(READY) + Attachment + LiveSession(ENDED).
   * Enqueue `video.transcode` so HLS variants are produced by the Task
   * 11.2 pipeline.
   */
  private async applySuccess(
    session: LiveSession,
    ownerUserId: string,
    result: {
      uploadedKey: string;
      contentType: string;
      sizeBytes: number;
      durationMs: number;
    },
  ): Promise<FinalizeRecordingOutcome> {
    let asset: MediaAsset;
    let recordingId: string;

    try {
      const persisted = await this.prisma.$transaction(async (tx) => {
        // 1) MediaAsset(kind=VIDEO, status=UPLOADED). We use VIDEO
        // (not RECORDING) so the Task 11.2 transcode processor picks
        // it up — it filters strictly on `kind === 'VIDEO'`.
        const created = await tx.mediaAsset.create({
          data: {
            ownerUserId,
            kind: 'VIDEO',
            status: 'UPLOADED',
            bytes: BigInt(result.sizeBytes),
            contentType: result.contentType,
            originalKey: result.uploadedKey,
            durationMs:
              result.durationMs > 0 ? result.durationMs : null,
            metadata: {
              source: 'live-recording',
              sessionId: session.id,
              lessonId: session.lessonId,
            } satisfies Prisma.JsonObject,
          },
        });

        // 2) Recording(READY) linked to the new asset.
        const recording = await this.recordingRepository.create(
          {
            lessonId: session.lessonId,
            sessionId: session.id,
            status: RECORDING_STATUS.READY,
            assetId: created.id,
            durationMs:
              result.durationMs > 0 ? result.durationMs : null,
          },
          tx,
        );

        // 3) Attachment so the lesson player surfaces the recording.
        // Position is "next" — derive by counting existing attachments.
        const existingCount = await tx.attachment.count({
          where: { lessonId: session.lessonId },
        });
        await tx.attachment.create({
          data: {
            lessonId: session.lessonId,
            assetId: created.id,
            kind: 'VIDEO',
            role: 'recording',
            position: existingCount,
          },
        });

        // 4) Outbox `recording.ready` for downstream consumers
        // (notifications, search indexing, etc.).
        await this.outboxService.create(tx, {
          topic: 'recording.ready',
          idempotencyKey: `recording.ready:${session.id}`,
          payload: {
            sessionId: session.id,
            lessonId: session.lessonId,
            recordingId: recording.id,
            assetId: created.id,
            durationMs: result.durationMs,
          },
        });

        return { asset: created, recordingId: recording.id };
      });
      asset = persisted.asset;
      recordingId = persisted.recordingId;
    } catch (error) {
      // P2002 on Recording.sessionId means another worker already
      // finalized this session — treat as idempotent success.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.recordingRepository.findBySessionId(session.id);
        if (existing) {
          return {
            status:
              existing.status === RECORDING_STATUS.READY ? 'READY' : 'FAILED',
            recordingId: existing.id,
            assetId: existing.assetId,
            liveSessionStatus: session.status,
          };
        }
      }
      throw error;
    }

    // Best-effort transcode enqueue. Failure is non-fatal — the asset
    // is already UPLOADED so a subsequent retry / orphan-cron pass can
    // re-enqueue. Mirrors `MediaService.enqueueTranscodingJob`.
    await this.enqueueTranscodingJob(asset.id);

    this.logger.log(
      `Recording ${recordingId} READY for session ${session.id} ` +
        `(asset=${asset.id} key=${result.uploadedKey} duration=${result.durationMs}ms)`,
    );

    return {
      status: 'READY',
      recordingId,
      assetId: asset.id,
      liveSessionStatus: session.status,
    };
  }

  /**
   * Persist a failed finalize: Recording(FAILED), and transition the
   * LiveSession to RECORDING_FAILED if it is not already terminal.
   * Req 9.7, 9.8.
   */
  private async applyFailure(
    session: LiveSession,
    failureReason: string,
  ): Promise<FinalizeRecordingOutcome> {
    let recordingId: string;
    let liveSessionStatus = session.status;

    try {
      const persisted = await this.prisma.$transaction(async (tx) => {
        const recording = await this.recordingRepository.create(
          {
            lessonId: session.lessonId,
            sessionId: session.id,
            status: RECORDING_STATUS.FAILED,
            assetId: null,
            durationMs: null,
          },
          tx,
        );

        // Transition the LiveSession to RECORDING_FAILED only if it is
        // currently non-terminal. If it has already moved to ENDED
        // (e.g. the API endpoint flipped it before finalize ran), we
        // still want the failure reflected — overwrite ENDED →
        // RECORDING_FAILED.
        const updated = await tx.liveSession.updateMany({
          where: {
            id: session.id,
            status: { in: ['STARTING', 'LIVE', 'ENDED'] },
          },
          data: {
            status: 'RECORDING_FAILED',
            endedAt: session.endedAt ?? new Date(),
          },
        });
        if (updated.count > 0) {
          liveSessionStatus = 'RECORDING_FAILED';
        }

        return { recordingId: recording.id };
      });
      recordingId = persisted.recordingId;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.recordingRepository.findBySessionId(session.id);
        if (existing) {
          return {
            status: 'FAILED',
            recordingId: existing.id,
            assetId: existing.assetId,
            liveSessionStatus,
            failureReason,
          };
        }
      }
      throw error;
    }

    this.logger.warn(
      `Recording ${recordingId} FAILED for session ${session.id}: ${failureReason} ` +
        `(LiveSession.status=${liveSessionStatus})`,
    );

    return {
      status: 'FAILED',
      recordingId,
      assetId: null,
      liveSessionStatus,
      failureReason,
    };
  }

  /**
   * Look up the lesson's owning teacher. Used as `MediaAsset.ownerUserId`
   * on the finalized asset. Mirrors `LiveService.assertTeacherOwnsLesson`'s
   * lookup so the ownership chain stays consistent.
   */
  private async loadOwnerUserId(lessonId: string): Promise<string> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        group: {
          select: { course: { select: { teacherId: true } } },
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${lessonId} not found`,
      });
    }
    return lesson.group.course.teacherId;
  }

  /**
   * Enqueue the BullMQ `video.transcode` job. Idempotent via
   * `jobId = assetId` (BullMQ refuses duplicates while the prior job
   * is still in the queue / completed cache). Failure is logged but
   * not surfaced — the asset is already `UPLOADED`, so the orphan
   * cleanup cron / a future retry can re-enqueue if needed.
   */
  private async enqueueTranscodingJob(assetId: string): Promise<void> {
    try {
      await this.transcodingQueue.add(
        VIDEO_TRANSCODE_JOB_NAME,
        { assetId },
        {
          jobId: assetId,
          attempts: VIDEO_TRANSCODE_MAX_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: VIDEO_TRANSCODE_BACKOFF_DELAY_MS,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
      this.logger.log(
        `Enqueued video.transcode job for recording asset ${assetId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue video.transcode for asset ${assetId}: ${(error as Error).message}`,
      );
    }
  }
}
