import { FakeRecorderAdapter } from './fake-recorder.adapter';
import { MediasoupRecorderAdapter } from './mediasoup-recorder.adapter';
import { isFinalizeSuccess } from './recorder.port';

describe('FakeRecorderAdapter', () => {
  let adapter: FakeRecorderAdapter;

  beforeEach(() => {
    adapter = new FakeRecorderAdapter();
  });

  it('returns a deterministic monotonic recorderRef on startRecording', async () => {
    const r1 = await adapter.startRecording({
      sessionId: 's1',
      lessonId: 'l1',
      roomId: 'r1',
      ownerUserId: 'u1',
    });
    const r2 = await adapter.startRecording({
      sessionId: 's2',
      lessonId: 'l2',
      roomId: 'r2',
      ownerUserId: 'u1',
    });

    expect(r1.recorderRef).toBe('fake-recorder-1');
    expect(r2.recorderRef).toBe('fake-recorder-2');
    expect(adapter.countCalls('startRecording')).toBe(2);
  });

  it('is idempotent for the same sessionId', async () => {
    const r1 = await adapter.startRecording({
      sessionId: 's1',
      lessonId: 'l1',
      roomId: 'r1',
      ownerUserId: 'u1',
    });
    const r2 = await adapter.startRecording({
      sessionId: 's1',
      lessonId: 'l1',
      roomId: 'r1',
      ownerUserId: 'u1',
    });

    expect(r2.recorderRef).toBe(r1.recorderRef);
    // Idempotent retries are not logged as duplicate calls.
    expect(adapter.countCalls('startRecording')).toBe(1);
    expect(adapter.isActive('s1')).toBe(true);
  });

  it('returns the default success payload from finalizeRecording', async () => {
    await adapter.startRecording({
      sessionId: 's1',
      lessonId: 'lesson-9',
      roomId: 'r1',
      ownerUserId: 'u1',
    });

    const result = await adapter.finalizeRecording({
      sessionId: 's1',
      recorderRef: 'fake-recorder-1',
      ownerUserId: 'u1',
      lessonId: 'lesson-9',
    });

    expect(isFinalizeSuccess(result)).toBe(true);
    if (isFinalizeSuccess(result)) {
      expect(result.uploadedKey).toContain('lesson-9');
      expect(result.contentType).toBe('video/mp4');
      expect(result.durationMs).toBe(60_000);
    }
    expect(adapter.isActive('s1')).toBe(false);
  });

  it('replays queued finalize results in FIFO order', async () => {
    adapter.enqueueFinalizeResult({ failure: 'first' });
    adapter.enqueueFinalizeResult({
      uploadedKey: 'k.mp4',
      contentType: 'video/mp4',
      sizeBytes: 100,
      durationMs: 1000,
    });

    const r1 = await adapter.finalizeRecording({
      sessionId: 's1',
      recorderRef: 'ref',
      ownerUserId: 'u1',
      lessonId: 'l',
    });
    const r2 = await adapter.finalizeRecording({
      sessionId: 's2',
      recorderRef: 'ref',
      ownerUserId: 'u1',
      lessonId: 'l',
    });

    expect(isFinalizeSuccess(r1)).toBe(false);
    expect(isFinalizeSuccess(r2)).toBe(true);
  });
});

describe('MediasoupRecorderAdapter (stub)', () => {
  let adapter: MediasoupRecorderAdapter;

  beforeEach(() => {
    adapter = new MediasoupRecorderAdapter();
  });

  it('startRecording returns a synthetic ref so observability shows the gap', async () => {
    const r = await adapter.startRecording({
      sessionId: 'abc',
      lessonId: 'l',
      roomId: 'router_1',
      ownerUserId: 'u1',
    });
    expect(r.recorderRef).toContain('mediasoup-stub');
    expect(r.recorderRef).toContain('abc');
  });

  it('finalizeRecording returns a failure so LiveSession reaches RECORDING_FAILED (Req 9.7, 9.8)', async () => {
    const result = await adapter.finalizeRecording({
      sessionId: 'abc',
      recorderRef: 'mediasoup-stub:abc',
      ownerUserId: 'u1',
      lessonId: 'l',
    });
    expect(isFinalizeSuccess(result)).toBe(false);
    if (!isFinalizeSuccess(result)) {
      expect(result.failure).toMatch(/stub/);
    }
  });
});
