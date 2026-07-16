import { Job } from 'bullmq';

import { RecordingProcessor } from './recording.processor';
import { RecordingService } from './recording.service';

const SESSION_ID = '00000000-0000-0000-0000-000000000aaa';
const LESSON_ID = '00000000-0000-0000-0000-000000000bbb';

/**
 * Unit tests for RecordingProcessor — Requirements 9.5, 9.6, 9.7, 9.8.
 *
 * Coverage:
 *   - live.started → RecordingService.startRecording
 *   - live.ended → RecordingService.finalizeRecording
 *   - missing sessionId → SKIPPED
 *   - unrelated topic → SKIPPED (defence in depth)
 *   - 404 from service → SKIPPED (no infinite retry)
 *   - other errors → re-thrown so BullMQ retries
 */
describe('RecordingProcessor', () => {
  let recordingService: jest.Mocked<RecordingService>;
  let processor: RecordingProcessor;

  function buildJob(
    topic: string,
    payload: Record<string, unknown>,
  ): Job<{
    topic: string;
    payload: Record<string, unknown>;
    outboxEventId?: string;
    idempotencyKey?: string;
  }> {
    return {
      id: 'job-1',
      name: topic,
      data: { topic, payload, outboxEventId: 'evt-1', idempotencyKey: 'k-1' },
    } as unknown as Job<{
      topic: string;
      payload: Record<string, unknown>;
    }>;
  }

  beforeEach(() => {
    recordingService = {
      startRecording: jest.fn().mockResolvedValue({
        recorderRef: 'fake-recorder-1',
        spawned: true,
      }),
      finalizeRecording: jest.fn().mockResolvedValue({
        status: 'READY',
        recordingId: 'rec-1',
        assetId: 'asset-1',
        liveSessionStatus: 'ENDED',
      }),
    } as unknown as jest.Mocked<RecordingService>;

    processor = new RecordingProcessor(recordingService);
  });

  // ------------------------------------------------------------------
  // live.started
  // ------------------------------------------------------------------

  describe('live.started', () => {
    it('drives RecordingService.startRecording for a valid payload', async () => {
      const job = buildJob('live.started', {
        sessionId: SESSION_ID,
        lessonId: LESSON_ID,
      });

      const result = await processor.process(job);

      expect(recordingService.startRecording).toHaveBeenCalledWith(SESSION_ID);
      expect(result).toEqual({
        topic: 'live.started',
        sessionId: SESSION_ID,
        action: 'started',
      });
    });

    it('skips when sessionId is missing', async () => {
      const job = buildJob('live.started', {
        // intentionally missing sessionId
        lessonId: LESSON_ID,
      });

      const result = await processor.process(job);

      expect(recordingService.startRecording).not.toHaveBeenCalled();
      expect(result.action).toBe('skipped');
    });

    it('skips on a 404 from the service (session disappeared)', async () => {
      const job = buildJob('live.started', { sessionId: SESSION_ID });
      const notFound = Object.assign(new Error('not found'), { status: 404 });
      recordingService.startRecording.mockRejectedValueOnce(notFound);

      const result = await processor.process(job);

      expect(result.action).toBe('skipped');
    });

    it('re-throws non-404 errors so BullMQ retries with backoff', async () => {
      const job = buildJob('live.started', { sessionId: SESSION_ID });
      recordingService.startRecording.mockRejectedValueOnce(
        new Error('redis flaky'),
      );

      await expect(processor.process(job)).rejects.toThrow(/redis flaky/);
    });
  });

  // ------------------------------------------------------------------
  // live.ended
  // ------------------------------------------------------------------

  describe('live.ended', () => {
    it('drives RecordingService.finalizeRecording and returns the outcome', async () => {
      const job = buildJob('live.ended', {
        sessionId: SESSION_ID,
        lessonId: LESSON_ID,
      });

      const result = await processor.process(job);

      expect(recordingService.finalizeRecording).toHaveBeenCalledWith(
        SESSION_ID,
      );
      expect(result).toEqual({
        topic: 'live.ended',
        sessionId: SESSION_ID,
        action: 'finalized',
        status: 'READY',
        recordingId: 'rec-1',
        assetId: 'asset-1',
      });
    });

    it('surfaces FAILED status + reason on the failure path (Req 9.7)', async () => {
      recordingService.finalizeRecording.mockResolvedValueOnce({
        status: 'FAILED',
        recordingId: 'rec-fail-1',
        assetId: null,
        liveSessionStatus: 'RECORDING_FAILED',
        failureReason: 'ffmpeg crashed',
      });
      const job = buildJob('live.ended', { sessionId: SESSION_ID });

      const result = await processor.process(job);

      expect(result).toEqual({
        topic: 'live.ended',
        sessionId: SESSION_ID,
        action: 'finalized',
        status: 'FAILED',
        recordingId: 'rec-fail-1',
        assetId: null,
        failureReason: 'ffmpeg crashed',
      });
    });

    it('skips on a 404 from the service', async () => {
      const job = buildJob('live.ended', { sessionId: SESSION_ID });
      const notFound = Object.assign(new Error('not found'), { status: 404 });
      recordingService.finalizeRecording.mockRejectedValueOnce(notFound);

      const result = await processor.process(job);
      expect(result.action).toBe('skipped');
    });

    it('re-throws transient errors so BullMQ retries (Req 9.8 retry budget)', async () => {
      const job = buildJob('live.ended', { sessionId: SESSION_ID });
      recordingService.finalizeRecording.mockRejectedValueOnce(
        new Error('postgres connection refused'),
      );

      await expect(processor.process(job)).rejects.toThrow(
        /postgres connection refused/,
      );
    });
  });

  // ------------------------------------------------------------------
  // unrelated topics
  // ------------------------------------------------------------------

  it('skips topics that are not recording-related (defence-in-depth)', async () => {
    const job = buildJob('lesson.published', { lessonId: LESSON_ID });

    const result = await processor.process(job);

    expect(recordingService.startRecording).not.toHaveBeenCalled();
    expect(recordingService.finalizeRecording).not.toHaveBeenCalled();
    expect(result.action).toBe('skipped');
  });
});
