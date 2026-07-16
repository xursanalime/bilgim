import {
  pickSupportedMimeType,
  fileExtensionForMime,
  formatDuration,
} from './use-audio-recorder';

describe('pickSupportedMimeType', () => {
  it('returns the first candidate the platform supports', () => {
    const support = (t: string) => t === 'audio/webm';
    expect(
      pickSupportedMimeType(
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'],
        support,
      ),
    ).toBe('audio/webm');
  });

  it('respects candidate preference order', () => {
    const support = () => true; // everything supported
    expect(
      pickSupportedMimeType(['audio/ogg', 'audio/webm'], support),
    ).toBe('audio/ogg');
  });

  it('returns undefined when no candidate is supported', () => {
    const support = () => false;
    expect(pickSupportedMimeType(['audio/webm', 'audio/mp4'], support)).toBeUndefined();
  });
});

describe('fileExtensionForMime', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mp4', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['application/octet-stream', 'dat'],
  ])('maps %s -> %s', (mime, ext) => {
    expect(fileExtensionForMime(mime)).toBe(ext);
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as m:ss with zero padding', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(9_900)).toBe('0:09');
  });

  it('formats multi-minute durations', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(600_000)).toBe('10:00');
  });

  it('clamps negative input to zero', () => {
    expect(formatDuration(-1_000)).toBe('0:00');
  });
});
