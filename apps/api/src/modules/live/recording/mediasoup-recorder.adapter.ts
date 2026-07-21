import { Injectable, Logger } from '@nestjs/common';

import {
  FinalizeRecordingInput,
  FinalizeRecordingResult,
  RecorderPort,
  StartRecordingInput,
  StartRecordingResult,
} from './recorder.port';

/**
 * MediasoupRecorderAdapter — production-shaped stub for the real
 * recorder pipeline.
 *
 * The real implementation is infrastructure-heavy:
 *  1. `startRecording` allocates a mediasoup `PlainTransport` on the
 *     same router as the live session, subscribes it to the teacher's
 *     audio + video producers, and pipes the RTP into an `ffmpeg`
 *     subprocess (or external Docker recorder sidecar). The recorder
 *     writes the in-progress mux to local disk or directly to a tmp
 *     R2 multipart upload.
 *  2. `finalizeRecording` signals the ffmpeg child to flush, waits for
 *     it to exit cleanly, optionally repackages the MP4 into HLS, and
 *     uploads the result to R2 via `R2Service.putObject` (or completes
 *     the in-flight multipart). It returns the resulting object key,
 *     content type, byte size, and duration.
 *
 * Why a stub for now?
 *   The real pipeline has hard dependencies on:
 *    - a running mediasoup native worker (cannot run in CI),
 *    - a system `ffmpeg` binary with libx264/aac,
 *    - access to UDP ports for RTP,
 *    - a Docker daemon (when using an external recorder).
 *   Standing those up in this iteration would conflate "wire the
 *   orchestration" with "ship a recorder". This adapter therefore:
 *    - **never claims success** so production cannot accidentally trust
 *      it with real recordings,
 *    - returns a `failure` from `finalizeRecording` so the service
 *      transitions LiveSession to `RECORDING_FAILED` rather than
 *      silently leaving it in LIVE (Req 9.7, 9.8),
 *    - logs a TODO marker so ops + future maintainers know the gap.
 *
 * Tests use `FakeRecorderAdapter` instead — the tasks list calls this
 * out explicitly.
 */
@Injectable()
export class MediasoupRecorderAdapter implements RecorderPort {
  private readonly logger = new Logger(MediasoupRecorderAdapter.name);

  async startRecording(
    input: StartRecordingInput,
  ): Promise<StartRecordingResult> {
    // TODO(live-recording): replace with real mediasoup PlainTransport
    // → ffmpeg pipe spawn. Until then, return a stable but obviously
    // synthetic ref so observability shows what's missing.
    this.logger.warn(
      `MediasoupRecorderAdapter is a stub — startRecording is a no-op for ` +
        `session=${input.sessionId} lesson=${input.lessonId} room=${input.roomId}. ` +
        `Real implementation is infrastructure-heavy (mediasoup PlainTransport, ` +
        `ffmpeg pipe, R2 upload).`,
    );
    return { recorderRef: `mediasoup-stub:${input.sessionId}` };
  }

  async finalizeRecording(
    input: FinalizeRecordingInput,
  ): Promise<FinalizeRecordingResult> {
    // TODO(live-recording): drive the real ffmpeg flush + R2 upload.
    // Returning a failure keeps the LiveSession from drifting into a
    // false-success state (Req 9.7, 9.8).
    this.logger.warn(
      `MediasoupRecorderAdapter.finalizeRecording is a stub — returning ` +
        `failure for session=${input.sessionId} ref=${input.recorderRef}. ` +
        `LiveSession will transition to RECORDING_FAILED.`,
    );
    return {
      failure:
        'MediasoupRecorderAdapter is a stub — real recorder not yet implemented',
    };
  }
}
