/**
 * RecorderPort — abstraction over the actual recorder pipeline.
 *
 * Why a port?
 *   The production recorder is a mediasoup `PlainTransport` piped into
 *   `ffmpeg` (or a sidecar Docker recorder). It has heavy dependencies
 *   (RTP, kernel buffers, native libs) that cannot run inside a Jest
 *   sandbox. Keeping the boundary narrow lets `RecordingService` be
 *   driven by deterministic fakes in tests while production wires in
 *   the real adapter.
 *
 * Responsibilities:
 *  - `startRecording`: enqueue / spawn a recorder for an active live
 *    session (Req 9.2). Returns a `recorderRef` that the service
 *    persists on `LiveSession.recorderRef` for later finalize.
 *  - `finalizeRecording`: tell the recorder to flush, mux to MP4 (or
 *    HLS), upload to R2, and return either the resulting object key +
 *    metadata (Req 9.6) or a `failure` reason (Req 9.7).
 *
 * Idempotency contract:
 *  - `startRecording` MUST be safe to retry. If a recorder is already
 *    running for the same `sessionId`, returning the existing
 *    `recorderRef` is the expected behaviour rather than throwing.
 *  - `finalizeRecording` MUST be safe to retry. Once the recorder has
 *    written its output to R2 a second call should observe the same
 *    `uploadedKey` and return success again — the service will detect
 *    a duplicate Recording row via `Recording.sessionId @unique`.
 */

/**
 * Input passed to `startRecording`. The teacher is captured here so the
 * recorder can attach `ownerUserId` to any temporary R2 objects it
 * stages.
 */
export interface StartRecordingInput {
  /** LiveSession id this recorder belongs to. */
  readonly sessionId: string;
  /** Lesson the live session is attached to. */
  readonly lessonId: string;
  /** mediasoup router id (`LiveSession.roomId`) the recorder must consume from. */
  readonly roomId: string;
  /** Teacher who owns the lesson — used as MediaAsset.ownerUserId on finalize. */
  readonly ownerUserId: string;
}

/** Output of a successful `startRecording` call. */
export interface StartRecordingResult {
  /**
   * Opaque handle the recorder uses to reference this session later
   * (PID + container id, k8s pod name, etc.). Persisted on
   * `LiveSession.recorderRef` so finalize can find the same recorder
   * on retry.
   */
  readonly recorderRef: string;
}

/** Input passed to `finalizeRecording`. */
export interface FinalizeRecordingInput {
  /** LiveSession id whose recorder we are flushing. */
  readonly sessionId: string;
  /** Recorder handle returned by `startRecording`. */
  readonly recorderRef: string;
  /** Teacher who owns the resulting MediaAsset. */
  readonly ownerUserId: string;
  /** Lesson id used to construct the R2 object key. */
  readonly lessonId: string;
}

/**
 * Successful finalize — the recorder has written the final asset to R2
 * and reports its key + metadata. The service translates this into a
 * `MediaAsset(kind=VIDEO, status=UPLOADED)` row + Recording + Attachment.
 */
export interface FinalizeRecordingSuccess {
  /** R2 object key of the uploaded MP4 (or HLS master). */
  readonly uploadedKey: string;
  /** MIME type of the uploaded artefact (e.g. `video/mp4`). */
  readonly contentType: string;
  /** Byte size of the uploaded artefact. */
  readonly sizeBytes: number;
  /** Recording duration in milliseconds. */
  readonly durationMs: number;
}

/**
 * Failed finalize — the recorder could not produce a valid artefact
 * after retries. The service translates this into a
 * `Recording(status=FAILED)` and transitions LiveSession to
 * RECORDING_FAILED (Req 9.7).
 */
export interface FinalizeRecordingFailure {
  readonly failure: string;
}

export type FinalizeRecordingResult =
  | FinalizeRecordingSuccess
  | FinalizeRecordingFailure;

/** Type guard: did finalize succeed? */
export function isFinalizeSuccess(
  r: FinalizeRecordingResult,
): r is FinalizeRecordingSuccess {
  return (r as FinalizeRecordingFailure).failure === undefined;
}

/**
 * RecorderPort — every adapter implements this contract.
 *
 * NOTE: methods are async even when the underlying call is synchronous
 * (the fake), so swapping in a remote / process-isolated recorder later
 * does not change the interface.
 */
export interface RecorderPort {
  startRecording(input: StartRecordingInput): Promise<StartRecordingResult>;
  finalizeRecording(
    input: FinalizeRecordingInput,
  ): Promise<FinalizeRecordingResult>;
}

/**
 * DI token for the port. Using a Symbol matches the convention from
 * `MEDIASOUP_PORT` so the wiring style is consistent across the live
 * module.
 */
export const RECORDER_PORT = Symbol('RecorderPort');
