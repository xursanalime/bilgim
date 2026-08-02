import {
  readTraceFromJob,
  withTraceJobOptions,
} from './bullmq-trace';

/**
 * BullMQ trace propagation (Task 24.3, Req 26.1).
 *
 * Round-trip property: anything `withTraceJobOptions` writes,
 * `readTraceFromJob` must be able to read back. Existing
 * `JobsOptions` keys are preserved verbatim so callers can keep
 * passing their own `jobId` / `attempts` settings unchanged.
 */
describe('withTraceJobOptions', () => {
  it('returns the base options unchanged when trace is null/undefined', () => {
    const base = { jobId: 'abc', attempts: 5 };
    expect(withTraceJobOptions(base, null)).toEqual(base);
    expect(withTraceJobOptions(base, undefined)).toEqual(base);
  });

  it('returns an empty options object when both base and trace are missing', () => {
    expect(withTraceJobOptions(undefined, null)).toEqual({});
  });

  it('merges traceId + requestId + userId into options.metadata', () => {
    const merged = withTraceJobOptions(
      { jobId: 'abc' },
      { traceId: 't-1', userId: 'u-1' },
    );
    expect(merged).toEqual({
      jobId: 'abc',
      metadata: {
        traceId: 't-1',
        requestId: 't-1',
        userId: 'u-1',
      },
    });
  });

  it('preserves pre-existing metadata fields untouched', () => {
    const merged = withTraceJobOptions(
      { jobId: 'abc', metadata: { source: 'cron' } } as never,
      { traceId: 't-1' },
    );
    expect(merged).toMatchObject({
      jobId: 'abc',
      metadata: {
        source: 'cron',
        traceId: 't-1',
        requestId: 't-1',
        userId: null,
      },
    });
  });

  it('is a no-op when traceId is empty string', () => {
    const base = { jobId: 'abc' };
    expect(withTraceJobOptions(base, { traceId: '' })).toEqual(base);
  });
});

describe('readTraceFromJob', () => {
  it('round-trips the metadata written by withTraceJobOptions', () => {
    const opts = withTraceJobOptions(undefined, {
      traceId: 't-9',
      userId: 'u-9',
    });
    const trace = readTraceFromJob({ opts });
    expect(trace).toEqual({
      traceId: 't-9',
      requestId: 't-9',
      userId: 'u-9',
    });
  });

  it('returns null when the job has no metadata', () => {
    expect(readTraceFromJob({ opts: {} })).toBeNull();
    expect(readTraceFromJob({})).toBeNull();
  });

  it('returns null when metadata.traceId is missing', () => {
    expect(
      readTraceFromJob({ opts: { metadata: { source: 'cron' } } }),
    ).toBeNull();
  });

  it('falls back to traceId when requestId is missing', () => {
    const trace = readTraceFromJob({
      opts: { metadata: { traceId: 't-9' } },
    });
    expect(trace).toEqual({
      traceId: 't-9',
      requestId: 't-9',
      userId: null,
    });
  });
});
