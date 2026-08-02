import { NotFoundException } from '@nestjs/common';
import { LiveSession, LiveSessionStatus, Prisma } from '@prisma/client';

import { LiveSessionRepository } from '../repositories/live-session.repository';
import { FakeRecorderAdapter } from './fake-recorder.adapter';
import { RECORDING_STATUS, RecordingRepository } from './recording.repository';
import { RecordingService } from './recording.service';

const SESSION_ID = '00000000-0000-0000-0000-000000000aaa';
const LESSON_ID = '00000000-0000-0000-0000-000000000bbb';
const TEACHER_ID = '00000000-0000-0000-0000-000000000ccc';
const ROOM_ID = 'router_42';
const ASSET_ID = '00000000-0000-0000-0000-000000000ddd';

/**
 * Unit tests for RecordingService — Requirements 9.5, 9.6, 9.7, 9.8.
 *
 * Coverage:
 *   - startRecording: idempotent + persists recorderRef (Req 9.2).
 *   - finalizeRecording success: creates MediaAsset(VIDEO, UPLOADED) +
 *     Recording(READY) + Attachment + outbox `recording.ready` +
 *     enqueues `video.transcode` (Req 9.6).
 *   - finalizeRecording failure: creates Recording(FAILED) + transitions
 *     LiveSession to RECORDING_FAILED (Req 9.7, 9.8).
 *   - finalizeRecording idempotency: existing Recording row → skip.
 *   - finalizeRecording with no recorderRef: still produces FAILED row.
 *   - recorder throwing → service still reaches a terminal state (Req 9.8).
 */
describe('RecordingService', () => {
  let recorder: FakeRecorderAdapter;
  let liveSessionRepository: jest.Mocked<LiveSessionRepository>;
  let recordingRepository: {
    findBySessionId: jest.Mock;
    create: jest.Mock;
  };
  let outboxService: { create: jest.Mock };
  let transcodingQueue: { add: jest.Mock };
  let prisma: {
    lesson: { findUnique: jest.Mock };
    liveSession: { updateMany: jest.Mock };
    $transaction: jest.Mock;
    mediaAsset: { create: jest.Mock };
    attachment: { count: jest.Mock; create: jest.Mock };
  };
  let service: RecordingService;

  function buildSession(
    overrides: Partial<LiveSession> = {},
  ): LiveSession {
    return {
      id: SESSION_ID,
      lessonId: LESSON_ID,
      status: 'LIVE' as LiveSessionStatus,
      startedAt: new Date('2024-01-01T00:00:00Z'),
      endedAt: null,
      roomId: ROOM_ID,
      recorderRef: null,
      ...overrides,
    } as LiveSession;
  }

  function setupOwnedLesson(): void {
    prisma.lesson.findUnique.mockResolvedValue({
      id: LESSON_ID,
      groupId: 'group-1',
      group: { course: { teacherId: TEACHER_ID } },
    });
  }

  beforeEach(() => {
    recorder = new FakeRecorderAdapter();

    liveSessionRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<LiveSessionRepository>;

    recordingRepository = {
      findBySessionId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
    };

    transcodingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    prisma = {
      lesson: { findUnique: jest.fn() },
      liveSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
      mediaAsset: {
        create: jest.fn().mockResolvedValue({
          id: ASSET_ID,
          ownerUserId: TEACHER_ID,
          kind: 'VIDEO',
          status: 'UPLOADED',
          originalKey: 'recordings/X.mp4',
        }),
      },
      attachment: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'att-1' }),
      },
    };

    service = new RecordingService(
      prisma as never,
      liveSessionRepository,
      recordingRepository as never,
      outboxService as never,
      recorder,
      transcodingQueue as never,
    );
  });

  // ==================================================================
  // startRecording (Req 9.2)
  // ==================================================================

  describe('startRecording', () => {
    it('spawns the recorder and persists recorderRef on the LiveSession', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(buildSession());

      const result = await service.startRecording(SESSION_ID);

      expect(result.spawned).toBe(true);
      expect(result.recorderRef).toMatch(/^fake-recorder-/);
      expect(recorder.countCalls('startRecording')).toBe(1);
      expect(prisma.liveSession.updateMany).toHaveBeenCalledWith({
        where: { id: SESSION_ID, recorderRef: null },
        data: { recorderRef: result.recorderRef },
      });
    });

    it('is idempotent when the session already has a recorderRef', async () => {
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ recorderRef: 'fake-recorder-99' }),
      );

      const result = await service.startRecording(SESSION_ID);

      expect(result.spawned).toBe(false);
      expect(result.recorderRef).toBe('fake-recorder-99');
      expect(recorder.countCalls('startRecording')).toBe(0);
      expect(prisma.liveSession.updateMany).not.toHaveBeenCalled();
    });

    it('skips when the LiveSession is already terminal', async () => {
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED' }),
      );

      const result = await service.startRecording(SESSION_ID);

      expect(result.spawned).toBe(false);
      expect(recorder.countCalls('startRecording')).toBe(0);
    });

    it('throws 404 when the session does not exist', async () => {
      liveSessionRepository.findById.mockResolvedValue(null);

      await expect(service.startRecording(SESSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('skips without spawning a recorder when the teacher opted out (shouldRecord=false)', async () => {
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ shouldRecord: false }),
      );

      const result = await service.startRecording(SESSION_ID);

      expect(result.spawned).toBe(false);
      expect(recorder.countCalls('startRecording')).toBe(0);
      expect(prisma.liveSession.updateMany).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // finalizeRecording — SUCCESS path (Req 9.6)
  // ==================================================================

  describe('finalizeRecording success', () => {
    it('writes MediaAsset+Recording+Attachment+outbox and enqueues transcoding', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      recordingRepository.create.mockResolvedValue({
        id: 'rec-1',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);

      // MediaAsset created with kind=VIDEO, status=UPLOADED so the
      // task-11.2 transcoder picks it up.
      expect(prisma.mediaAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerUserId: TEACHER_ID,
          kind: 'VIDEO',
          status: 'UPLOADED',
          contentType: 'video/mp4',
          originalKey: expect.stringContaining(SESSION_ID),
          metadata: expect.objectContaining({
            source: 'live-recording',
            sessionId: SESSION_ID,
          }),
        }),
      });

      expect(recordingRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.READY,
          assetId: ASSET_ID,
          durationMs: 60_000,
        }),
        expect.anything(),
      );

      // Attachment auto-attached to the lesson with role='recording'.
      expect(prisma.attachment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          lessonId: LESSON_ID,
          assetId: ASSET_ID,
          kind: 'VIDEO',
          role: 'recording',
        }),
      });

      // Outbox emits recording.ready with idempotent key.
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'recording.ready',
          idempotencyKey: `recording.ready:${SESSION_ID}`,
          payload: expect.objectContaining({
            sessionId: SESSION_ID,
            recordingId: 'rec-1',
            assetId: ASSET_ID,
          }),
        }),
      );

      // Transcode job enqueued, reusing the Task 11.2 pipeline.
      expect(transcodingQueue.add).toHaveBeenCalledWith(
        'video.transcode',
        { assetId: ASSET_ID },
        expect.objectContaining({ jobId: ASSET_ID }),
      );

      expect(outcome).toEqual({
        status: 'READY',
        recordingId: 'rec-1',
        assetId: ASSET_ID,
        liveSessionStatus: 'ENDED',
      });
    });

    it('positions the new attachment at the next available index', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      prisma.attachment.count.mockResolvedValue(3);
      recordingRepository.create.mockResolvedValue({
        id: 'rec-2',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });

      await service.finalizeRecording(SESSION_ID);

      expect(prisma.attachment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ position: 3 }),
      });
    });

    it('does not let a transcode-enqueue failure abort the finalize (already UPLOADED)', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      transcodingQueue.add.mockRejectedValueOnce(new Error('redis down'));
      recordingRepository.create.mockResolvedValue({
        id: 'rec-3',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);
      expect(outcome.status).toBe('READY');
      expect(outcome.recordingId).toBe('rec-3');
    });
  });

  // ==================================================================
  // finalizeRecording — FAILURE path (Req 9.7, 9.8)
  // ==================================================================

  describe('finalizeRecording failure', () => {
    it('creates Recording(FAILED) and transitions LiveSession to RECORDING_FAILED', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      recorder.enqueueFinalizeResult({ failure: 'ffmpeg crashed' });
      recordingRepository.create.mockResolvedValue({
        id: 'rec-fail-1',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.FAILED,
        assetId: null,
        durationMs: null,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(recordingRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: RECORDING_STATUS.FAILED,
          assetId: null,
        }),
        expect.anything(),
      );
      expect(prisma.liveSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: SESSION_ID,
          status: { in: ['STARTING', 'LIVE', 'ENDED'] },
        },
        data: expect.objectContaining({ status: 'RECORDING_FAILED' }),
      });
      // No transcode enqueued on the failure path.
      expect(transcodingQueue.add).not.toHaveBeenCalled();
      // No MediaAsset row was created.
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();

      expect(outcome).toEqual({
        status: 'FAILED',
        recordingId: 'rec-fail-1',
        assetId: null,
        liveSessionStatus: 'RECORDING_FAILED',
        failureReason: 'ffmpeg crashed',
      });
    });

    it('still reaches FAILED when the recorder THROWS instead of returning a failure (Req 9.8)', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      // Override the fake adapter to throw.
      const throwingRecorder: FakeRecorderAdapter = {
        ...recorder,
        startRecording: recorder.startRecording.bind(recorder),
        finalizeRecording: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as FakeRecorderAdapter;
      service = new RecordingService(
        prisma as never,
        liveSessionRepository,
        recordingRepository as never,
        outboxService as never,
        throwingRecorder,
        transcodingQueue as never,
      );
      recordingRepository.create.mockResolvedValue({
        id: 'rec-fail-2',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.FAILED,
        assetId: null,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(outcome.status).toBe('FAILED');
      expect(outcome.failureReason).toContain('recorder error');
      expect(outcome.liveSessionStatus).toBe('RECORDING_FAILED');
    });

    it('marks FAILED when no recorder was ever started (no recorderRef)', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: null }),
      );
      recordingRepository.create.mockResolvedValue({
        id: 'rec-fail-3',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.FAILED,
        assetId: null,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(outcome.status).toBe('FAILED');
      expect(outcome.failureReason).toMatch(/no recorder/);
      // Recorder never invoked because there was no handle.
      expect(recorder.countCalls('finalizeRecording')).toBe(0);
    });

    it('marks SKIPPED (not FAILED) when the teacher opted out of recording', async () => {
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: null, shouldRecord: false }),
      );

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(outcome.status).toBe('SKIPPED');
      expect(outcome.assetId).toBeNull();
      expect(outcome.liveSessionStatus).toBe('ENDED');
      expect(recordingRepository.create).not.toHaveBeenCalled();
      // Status must NOT be overwritten to RECORDING_FAILED for an opt-out.
      expect(prisma.liveSession.updateMany).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // finalizeRecording — idempotency
  // ==================================================================

  describe('finalizeRecording idempotency', () => {
    it('returns the existing Recording row without re-running on retry', async () => {
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );
      recordingRepository.findBySessionId.mockResolvedValue({
        id: 'rec-existing',
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(outcome).toEqual({
        status: 'READY',
        recordingId: 'rec-existing',
        assetId: ASSET_ID,
        liveSessionStatus: 'ENDED',
      });
      // No new writes anywhere.
      expect(recordingRepository.create).not.toHaveBeenCalled();
      expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
      expect(transcodingQueue.add).not.toHaveBeenCalled();
      expect(recorder.countCalls('finalizeRecording')).toBe(0);
    });

    it('translates a P2002 (concurrent finalize) into idempotent success', async () => {
      setupOwnedLesson();
      liveSessionRepository.findById.mockResolvedValue(
        buildSession({ status: 'ENDED', recorderRef: 'fake-recorder-1' }),
      );

      // First check finds nothing → we enter the success branch.
      recordingRepository.findBySessionId
        .mockResolvedValueOnce(null)
        // After the P2002 catch, the second lookup returns the winner.
        .mockResolvedValueOnce({
          id: 'rec-winner',
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.READY,
          assetId: ASSET_ID,
          durationMs: 60_000,
        });

      // Make the transaction throw P2002.
      const collision = new Prisma.PrismaClientKnownRequestError(
        'unique violation',
        { code: 'P2002', clientVersion: 'test' } as never,
      );
      prisma.$transaction.mockRejectedValueOnce(collision);

      const outcome = await service.finalizeRecording(SESSION_ID);

      expect(outcome.status).toBe('READY');
      expect(outcome.recordingId).toBe('rec-winner');
      expect(outcome.assetId).toBe(ASSET_ID);
      expect(transcodingQueue.add).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // edge cases
  // ==================================================================

  it('throws 404 when the session does not exist', async () => {
    liveSessionRepository.findById.mockResolvedValue(null);
    await expect(
      service.finalizeRecording(SESSION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
