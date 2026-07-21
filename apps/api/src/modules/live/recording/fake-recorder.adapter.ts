import { Injectable } from '@nestjs/common';

import {
  FinalizeRecordingInput,
  FinalizeRecordingResult,
  RecorderPort,
  StartRecordingInput,
  StartRecordingResult,
} from './recorder.port';

/**
 * One recorded interaction with the fake adapter. Tests assert against
 * the `calls` array to verify that `RecordingService` drove the port in
 * the right order — this is the substitute for a real recorder
 * pipeline (mediasoup PlainTransport → ffmpeg → R2 upload).
 */
export interface FakeRecorderCall {
  method: 'startRecording' | 'finalizeRecording';
  args: unknown;
}

/**
 * FakeRecorderAdapter — in-memory `RecorderPort` implementation used by
 * tests and local development.
 *
 * Behaviour:
 *   - `startRecording` is idempotent: calling twice for the same
 *     `sessionId` returns the same `recorderRef` and does NOT push a
 *     duplicate call into the call log (matches the production
 *     contract).
 *   - `finalizeRecording` returns a synthetic success payload by
 *     default. Tests can override behaviour via `enqueueFinalizeResult`
 *     so they can simulate failures, partial uploads, retries, etc.
 *   - The fake never touches R2 or ffmpeg.
 *
 * Co-located with the port (rather than under `__mocks__/`) so a future
 * local-dev harness can import it for offline live-session testing.
 */
@Injectable()
export class FakeRecorderAdapter implements RecorderPort {
  /** Ordered log of every (non-deduped) call made against the adapter. */
  readonly calls: FakeRecorderCall[] = [];

  /** sessionId → recorderRef, used to dedupe `startRecording`. */
  private readonly active = new Map<string, string>();

  /** Monotonic counter so refs sort lexically by creation order. */
  private seq = 0;

  /**
   * Queued finalize results. `finalizeRecording` consumes from the head
   * of this array; if empty, returns the default synthetic success.
   */
  private finalizeQueue: FinalizeRecordingResult[] = [];

  /**
   * Optional override for the recorderRef format. Tests use this to
   * inject a specific value (e.g. a known PID) so they can assert on
   * the persisted `LiveSession.recorderRef`.
   */
  public refPrefix = 'fake-recorder';

  async startRecording(
    input: StartRecordingInput,
  ): Promise<StartRecordingResult> {
    const cached = this.active.get(input.sessionId);
    if (cached) {
      // Idempotent — skip logging the duplicate call. The contract is
      // "starting an already-running recorder is a no-op", and tests
      // shouldn't care that the higher layer retried.
      return { recorderRef: cached };
    }

    this.calls.push({ method: 'startRecording', args: input });
    const recorderRef = `${this.refPrefix}-${++this.seq}`;
    this.active.set(input.sessionId, recorderRef);
    return { recorderRef };
  }

  async finalizeRecording(
    input: FinalizeRecordingInput,
  ): Promise<FinalizeRecordingResult> {
    this.calls.push({ method: 'finalizeRecording', args: input });
    this.active.delete(input.sessionId);

    const queued = this.finalizeQueue.shift();
    if (queued) {
      return queued;
    }

    // Default success payload — deterministic so snapshots stay stable.
    return {
      uploadedKey: `recordings/${input.lessonId}/${input.sessionId}.mp4`,
      contentType: 'video/mp4',
      sizeBytes: 1024 * 1024, // 1 MiB
      durationMs: 60_000,
    };
  }

  // ------------------------------------------------------------------
  // Test-only helpers
  // ------------------------------------------------------------------

  /**
   * Push a finalize result that the next call to `finalizeRecording`
   * will return. Subsequent calls fall back to the default success.
   * Allows tests to drive both the success and failure branches without
   * subclassing the adapter.
   */
  enqueueFinalizeResult(result: FinalizeRecordingResult): void {
    this.finalizeQueue.push(result);
  }

  /** True iff a recorder is currently registered for this session. */
  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  countCalls(method: FakeRecorderCall['method']): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}
