import { NotFoundException } from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';

import { LiveSessionRepository } from '../repositories/live-session.repository';
import { RecordingFinalizer } from './recording-finalizer.service';
import { FinalizeRecordingOutcome, RecordingService } from './recording.service';

const SESSION_ID = '00000000-0000-0000-0000-000000000aaa';
const ASSET_ID = '00000000-0000-0000-0000-000000000ddd';

/**
 * Unit tests for RecordingFinalizer — content-protection-backend Task 4.1,
 * Requirements 5.1, 5.2, 5.3, Property 6.
 *
 * The finalizer wraps RecordingService (the authorized recorder-lifecycle
 * writer). These tests verify the content-protection contract it layers on
 * top:
 *   - successful finalize → ENDED + MediaAsset/Recording surfaced + the
 *     ONLY playback channel is the protected ticket path (Req 5.1, 5.2).
 *   - failure → RECORDING_FAILED + a frontend-readable status (Req 5.3).
 *   - idempotent re-finalize → returns the existing outcome, no extra work.
 *   - never exposes an unprotected/direct media URL (Req 5.2).
 *   - terminal guarantee: even when RecordingService throws unexpectedly,
 *     the session is forced to RECORDING_FAILED (Property 6 / Req 5.1).
 */
describe('RecordingFinalizer', () => {
  let recordingService: { finalizeRecording: jest.Mock };
  let liveSessionRepository: { transitionToRecordingFailed: jest.Mock };
  let finalizer: RecordingFinalizer;

  function readyOutcome(
    overrides: Partial<FinalizeRecordingOutcome> = {},
  ): FinalizeRecordingOutcome {
    return {
      status: 'READY',
      recordingId: 'rec-1',
      assetId: ASSET_ID,
      liveSessionStatus: 'ENDED' as LiveSessionStatus,
      ...overrides,
    };
  }

  function failedOutcome(
    overrides: Partial<FinalizeRecordingOutcome> = {},
  ): FinalizeRecordingOutcome {
    return {
      status: 'FAILED',
      recordingId: 'rec-fail-1',
      assetId: null,
      liveSessionStatus: 'RECORDING_FAILED' as LiveSessionStatus,
      failureReason: 'ffmpeg crashed',
      ...overrides,
    };
  }

  beforeEach(() => {
    recordingService = { finalizeRecording: jest.fn() };
    liveSessionRepository = {
      transitionToRecordingFailed: jest.fn().mockResolvedValue(true),
    };
    finalizer = new RecordingFinalizer(
      recordingService as unknown as RecordingService,
      liveSessionRepository as unknown as LiveSessionRepository,
    );
  });

  // ==================================================================
  // Success (Req 5.1, 5.2)
  // ==================================================================

  describe('successful finalize', () => {
    it('transitions to ENDED, surfaces the MediaAsset + Recording, and marks protected-only playback', async () => {
      recordingService.finalizeRecording.mockResolvedValue(readyOutcome());

      const status = await finalizer.finalize(SESSION_ID);

      expect(recordingService.finalizeRecording).toHaveBeenCalledWith(
        SESSION_ID,
      );
      expect(status).toEqual({
        sessionId: SESSION_ID,
        liveSessionStatus: 'ENDED',
        recordingStatus: 'READY',
        recordingId: 'rec-1',
        assetId: ASSET_ID,
        playback: 'protected-ticket',
      });
      // Happy path never forces a failure transition.
      expect(
        liveSessionRepository.transitionToRecordingFailed,
      ).not.toHaveBeenCalled();
    });

    it('does NOT expose any unprotected/direct media URL (Req 5.2)', async () => {
      recordingService.finalizeRecording.mockResolvedValue(readyOutcome());

      const status = await finalizer.finalize(SESSION_ID);

      // The only playback affordance is the protected ticket marker — the
      // asset id is a reference, not a resolvable URL.
      expect(status.playback).toBe('protected-ticket');

      // Defensive: assert no URL-ish key leaked into the response, and no
      // value looks like a URL.
      const json = JSON.stringify(status);
      expect(json).not.toMatch(/https?:\/\//i);
      const forbiddenKeys = ['url', 'href', 'signedUrl', 'manifestUrl', 'src'];
      for (const key of forbiddenKeys) {
        expect(Object.prototype.hasOwnProperty.call(status, key)).toBe(false);
      }
    });
  });

  // ==================================================================
  // Failure (Req 5.3)
  // ==================================================================

  describe('failed finalize', () => {
    it('sets RECORDING_FAILED and surfaces a frontend-readable failure status', async () => {
      recordingService.finalizeRecording.mockResolvedValue(failedOutcome());

      const status = await finalizer.finalize(SESSION_ID);

      expect(status).toEqual({
        sessionId: SESSION_ID,
        liveSessionStatus: 'RECORDING_FAILED',
        recordingStatus: 'FAILED',
        recordingId: 'rec-fail-1',
        assetId: null,
        playback: null,
        failureReason: 'ffmpeg crashed',
      });
    });

    it('provides a default failure reason when the outcome omits one', async () => {
      const outcome: FinalizeRecordingOutcome = {
        status: 'FAILED',
        recordingId: 'rec-fail-1',
        assetId: null,
        liveSessionStatus: 'RECORDING_FAILED' as LiveSessionStatus,
      };
      recordingService.finalizeRecording.mockResolvedValue(outcome);

      const status = await finalizer.finalize(SESSION_ID);

      expect(status.recordingStatus).toBe('FAILED');
      expect(status.failureReason).toBeDefined();
      expect(status.playback).toBeNull();
    });
  });

  // ==================================================================
  // Idempotency
  // ==================================================================

  describe('idempotent re-finalize', () => {
    it('returns the existing READY outcome without extra work', async () => {
      // RecordingService already collapses a re-finalize to the existing
      // row; the finalizer simply maps it. Two calls must agree.
      recordingService.finalizeRecording.mockResolvedValue(
        readyOutcome({ recordingId: 'rec-existing' }),
      );

      const first = await finalizer.finalize(SESSION_ID);
      const second = await finalizer.finalize(SESSION_ID);

      expect(second).toEqual(first);
      expect(second.recordingStatus).toBe('READY');
      expect(second.playback).toBe('protected-ticket');
      expect(
        liveSessionRepository.transitionToRecordingFailed,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Terminal guarantee (Property 6 / Req 5.1)
  // ==================================================================

  describe('terminal-state guarantee', () => {
    it('forces RECORDING_FAILED when RecordingService throws unexpectedly', async () => {
      recordingService.finalizeRecording.mockRejectedValue(
        new Error('db exploded'),
      );

      const status = await finalizer.finalize(SESSION_ID);

      expect(
        liveSessionRepository.transitionToRecordingFailed,
      ).toHaveBeenCalledWith(SESSION_ID);
      expect(status.liveSessionStatus).toBe('RECORDING_FAILED');
      expect(status.recordingStatus).toBe('FAILED');
      expect(status.assetId).toBeNull();
      expect(status.playback).toBeNull();
      expect(status.failureReason).toContain('db exploded');
    });

    it('forces RECORDING_FAILED when the outcome reports a non-terminal status', async () => {
      recordingService.finalizeRecording.mockResolvedValue(
        failedOutcome({ liveSessionStatus: 'LIVE' as LiveSessionStatus }),
      );

      const status = await finalizer.finalize(SESSION_ID);

      expect(
        liveSessionRepository.transitionToRecordingFailed,
      ).toHaveBeenCalledWith(SESSION_ID);
      expect(status.liveSessionStatus).toBe('RECORDING_FAILED');
    });

    it('propagates NotFoundException for a missing session (nothing to finalize)', async () => {
      recordingService.finalizeRecording.mockRejectedValue(
        new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND' }),
      );

      await expect(finalizer.finalize(SESSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        liveSessionRepository.transitionToRecordingFailed,
      ).not.toHaveBeenCalled();
    });
  });
});
