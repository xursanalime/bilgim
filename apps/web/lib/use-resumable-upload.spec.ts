import { partByteRange, overallProgress } from './use-resumable-upload';

describe('partByteRange', () => {
  const PART = 5 * 1024 * 1024; // 5 MiB

  it('returns full-size ranges for interior parts', () => {
    const r = partByteRange(2, PART, PART * 3);
    expect(r).toEqual({ start: PART, end: PART * 2, size: PART });
  });

  it('clamps the final part to the file end', () => {
    const fileSize = PART * 2 + 1234;
    const last = partByteRange(3, PART, fileSize);
    expect(last.start).toBe(PART * 2);
    expect(last.end).toBe(fileSize);
    expect(last.size).toBe(1234);
  });

  it('handles a single part smaller than the part size', () => {
    const r = partByteRange(1, PART, 100);
    expect(r).toEqual({ start: 0, end: 100, size: 100 });
  });

  it('covers the whole file across contiguous parts with no gaps/overlap', () => {
    const fileSize = PART * 2 + 777;
    const ranges = [1, 2, 3].map((n) => partByteRange(n, PART, fileSize));
    expect(ranges[0]!.start).toBe(0);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.start).toBe(ranges[i - 1]!.end);
    }
    expect(ranges[ranges.length - 1]!.end).toBe(fileSize);
    const total = ranges.reduce((s, r) => s + r.size, 0);
    expect(total).toBe(fileSize);
  });

  it('never reads past the file for an out-of-range part number', () => {
    const r = partByteRange(99, PART, PART);
    expect(r.start).toBe(PART);
    expect(r.size).toBe(0);
  });
});

describe('overallProgress', () => {
  it('is 0 when nothing has uploaded', () => {
    const parts = [
      { status: 'pending' as const, loaded: 0, size: 100 },
      { status: 'pending' as const, loaded: 0, size: 100 },
    ];
    expect(overallProgress(parts)).toEqual({
      uploadedBytes: 0,
      totalBytes: 200,
      percent: 0,
    });
  });

  it('counts done parts at full size and in-flight parts at loaded bytes', () => {
    const parts = [
      { status: 'done' as const, loaded: 100, size: 100 },
      { status: 'uploading' as const, loaded: 50, size: 100 },
      { status: 'pending' as const, loaded: 0, size: 100 },
    ];
    const r = overallProgress(parts);
    expect(r.uploadedBytes).toBe(150);
    expect(r.totalBytes).toBe(300);
    expect(r.percent).toBe(50);
  });

  it('reaches 100 when every part is done', () => {
    const parts = [
      { status: 'done' as const, loaded: 100, size: 100 },
      { status: 'done' as const, loaded: 200, size: 200 },
    ];
    expect(overallProgress(parts).percent).toBe(100);
  });

  it('is 0 for an empty part list (avoids divide-by-zero)', () => {
    expect(overallProgress([])).toEqual({
      uploadedBytes: 0,
      totalBytes: 0,
      percent: 0,
    });
  });
});
