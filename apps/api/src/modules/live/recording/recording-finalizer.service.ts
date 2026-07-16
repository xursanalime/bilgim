import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';

import { LiveSessionRepository } from '../repositories/live-session.repository';
import { RecordingService } from './recording.service';

/**
 * How a finalized recording may be played back. There is exactly one
 * legal value for a READY recording — `'protected-ticket'` — meaning the
 * client MUST obtain a short-lived Playback_Ticket and stream through the
 * License_Proxy / ProtectedFile path (content-protection-backend
 * Requirements 1–3). The finalizer NEVER hands back a direct, public, or
 * signed storage URL (Req 5.2 / Property 6). `null` means there is nothing
 * playable (the recording failed).
 */
export type RecordingPlaybackChannel = 'protected-ticket' | null;

/**
 * Terminal-state status object returned by {@link RecordingFinalizer.finalize}.
 *
 * This is the shape the frontend reads to decide what to show after a live
 * class ends (Req 5.3): either "recording ready, watch it" or "recording
 * failed". It deliberately exposes only the `assetId` (so the client can
 * request a Playback_Ticket for it) and never a resolvable media URL.
 */
export interface RecordingFinalizationStatus {
  sessionId: string;
  /**
   * The LiveSession's terminal status — guaranteed to be `ENDED` or
   * `RECORDING_FAILED` (Property 6 / Req 5.1). Never a non-terminal value.
   */
  liveSessionStatus: Extract<
    LiveSessionStatus,
    'ENDED' | 'RECORDING_FAILED'
  >;
  /** Recording outcome the frontend can display. */
  recordingStatus: 'READY' | 'FAILED';
  /** The Recording row id, when one was written. */
  recordingId: string | null;
  /**
   * MediaAsset id of the finalized recording (READY only). The client uses
   * this to request a Playback_Ticket — it is NOT a playable URL.
   */
  assetId: string | null;
  /** The only legal playback channel — always the protected path, or null. */
  playback: RecordingPlaybackChannel;
  /** Human-facing reason set when `recordingStatus === 'FAILED'` (Req 5.3). */
  failureReason?: string;
}

/**
 * RecordingFinalizer — content-protection hook that runs when a
 * LiveSession ends (content-protection-backend Requirements 5.1, 5.2, 5.3
 * / Property 6).
 *
 * It is a thin orchestration layer over {@link RecordingService}, which is
 * the live module's authorized writer for the recorder lifecycle
 * (MediaAsset + Recording + Attachment + LiveSession transition). We do NOT
 * reinvent asset creation here — `RecordingService.finalizeRecording`
 * already:
 *   - creates / associates a `MediaAsset` (kind VIDEO, status UPLOADED) on
 *     the session's lesson and links a `Recording` row to it,
 *   - transitions the LiveSession to ENDED (success) or RECORDING_FAILED
 *     (failure),
 *   - is idempotent via `Recording.sessionId @unique`.
 *
 * What this finalizer ADDS on top, for the content-protection contract:
 *
 *   1. **Terminal guarantee (Req 5.1 / Property 6).** A LiveSession must
 *      ALWAYS reach ENDED or RECORDING_FAILED. If `RecordingService`
 *      throws unexpectedly (e.g. a DB error mid-failure-path) or somehow
 *      reports a still-non-terminal status, the finalizer forces
 *      RECORDING_FAILED so the session is never stuck.
 *
 *   2. **Protected-path-only playback (Req 5.2).** The returned status
 *      carries the `assetId` but no media URL. The finalized recording is a
 *      normal protected MediaAsset; playback goes exclusively through the
 *      existing Playback_Ticket + License_Proxy / ProtectedFile path. No
 *      unprotected route is added.
 *
 *   3. **Frontend-readable status (Req 5.3).** On failure the finalizer
 *      surfaces `recordingStatus: 'FAILED'` plus a `failureReason`, mapped
 *      from the underlying outcome, so the UI can explain what happened.
 */
@Injectable()
export class RecordingFinalizer {
  private readonly logger = new Logger(RecordingFinalizer.name);

  constructor(
    private readonly recordingService: RecordingService,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  /**
   * Finalize the recording for a LiveSession that has ended.
   *
   * Always resolves to a terminal status (never leaves the session
   * non-terminal). Re-finalizing an already-finalized session is a no-op
   * that returns the existing outcome (idempotent — delegated to
   * `RecordingService`).
   *
   * @throws NotFoundException when the session id does not exist — there is
   *   nothing to finalize and the caller should surface a 404.
   */
  async finalize(sessionId: string): Promise<RecordingFinalizationStatus> {
    let outcome;
    try {
      outcome = await this.recordingService.finalizeRecording(sessionId);
    } catch (error) {
      // A genuinely-missing session is the caller's problem, not a
      // recording failure — propagate it.
      if (error instanceof NotFoundException) {
        throw error;
      }

      // Anything else (e.g. the failure-path transaction itself threw)
      // must NOT leave the LiveSession stuck. Force RECORDING_FAILED so
      // Property 6 / Req 5.1 holds, then surface a FAILED status (Req 5.3).
      const reason = (error as Error).message ?? 'unknown finalization error';
      this.logger.error(
        `finalize: unexpected error finalizing session ${sessionId}; forcing RECORDING_FAILED: ${reason}`,
        (error as Error).stack,
      );
      await this.forceRecordingFailed(sessionId);
      return {
        sessionId,
        liveSessionStatus: 'RECORDING_FAILED',
        recordingStatus: 'FAILED',
        recordingId: null,
        assetId: null,
        playback: null,
        failureReason: `finalization error: ${reason}`,
      };
    }

    // Defensive re-assertion of the terminal guarantee. RecordingService
    // commits a terminal status on every branch, but Property 6 is
    // load-bearing for content protection, so if we ever observe a
    // non-terminal status we force RECORDING_FAILED rather than trust it.
    let liveSessionStatus: LiveSessionStatus = outcome.liveSessionStatus;
    if (!this.isTerminal(liveSessionStatus)) {
      this.logger.error(
        `finalize: session ${sessionId} reported non-terminal status ${liveSessionStatus} after finalize; forcing RECORDING_FAILED`,
      );
      await this.forceRecordingFailed(sessionId);
      liveSessionStatus = 'RECORDING_FAILED';
    }

    const isReady = outcome.status === 'READY';

    const status: RecordingFinalizationStatus = {
      sessionId,
      liveSessionStatus: liveSessionStatus as Extract<
        LiveSessionStatus,
        'ENDED' | 'RECORDING_FAILED'
      >,
      recordingStatus: isReady ? 'READY' : 'FAILED',
      recordingId: outcome.recordingId ?? null,
      assetId: outcome.assetId,
      // Req 5.2: a READY recording is playable ONLY via the protected
      // ticket path. We expose the marker, never a URL.
      playback: isReady && outcome.assetId ? 'protected-ticket' : null,
    };

    if (!isReady) {
      status.failureReason =
        outcome.failureReason ?? 'recording finalization failed';
    }

    return status;
  }

  /**
   * Force the LiveSession into RECORDING_FAILED when it is still
   * non-terminal. Used only as the safety net for unexpected errors —
   * the happy paths transition through `RecordingService`. Mirrors the
   * status precondition used by `RecordingService.applyFailure` so a
   * session that already moved to ENDED is overwritten to reflect the
   * finalization failure (Req 5.3).
   */
  private async forceRecordingFailed(sessionId: string): Promise<void> {
    try {
      await this.liveSessionRepository.transitionToRecordingFailed(sessionId);
    } catch (error) {
      // Best-effort. If even this write fails the outer error has already
      // been logged; we do not want to mask the original failure.
      this.logger.error(
        `forceRecordingFailed: could not transition session ${sessionId}: ${(error as Error).message}`,
      );
    }
  }

  private isTerminal(status: LiveSessionStatus): boolean {
    return status === 'ENDED' || status === 'RECORDING_FAILED';
  }
}
