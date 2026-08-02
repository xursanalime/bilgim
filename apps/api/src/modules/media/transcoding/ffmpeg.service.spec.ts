import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HLS_CRF, ResolvedHlsVariant } from '../media.types';
import { FfmpegRunner, FfmpegExecResult } from './ffmpeg.runner';
import { FfmpegService } from './ffmpeg.service';

/**
 * Unit tests for FfmpegService — verify command construction without
 * ever invoking the real ffmpeg / ffprobe binaries.
 *
 * Approach: the abstract `FfmpegRunner` is stubbed with a recording fake
 * that captures `{binary, args}` for assertion. The service writes a few
 * files to a tmpdir we clean up after each test.
 */
class FakeRunner extends FfmpegRunner {
  calls: Array<{ binary: string; args: string[] }> = [];
  results: FfmpegExecResult[] = [];

  enqueue(result: FfmpegExecResult): void {
    this.results.push(result);
  }

  async run(binary: string, args: readonly string[]): Promise<FfmpegExecResult> {
    this.calls.push({ binary, args: [...args] });
    return (
      this.results.shift() ?? {
        exitCode: 0,
        stdout: '{}',
        stderr: '',
      }
    );
  }
}

describe('FfmpegService', () => {
  const BT709 = {
    range: 'tv',
    space: 'bt709',
    primaries: 'bt709',
    transfer: 'bt709',
  };

  /**
   * Synthetic ladder rung with output dimensions already resolved, as the
   * service takes it. Self-contained (not looked up from the real
   * `HLS_VARIANTS` ladder by position) so these fixtures don't silently
   * drift when the platform ladder's rungs are added, removed, or
   * reordered — only the `-maxrate`/`-b:a` self-consistency check below
   * cares about the bitrate value, not its real-world accuracy.
   */
  const resolved = (
    name: string,
    width: number,
    height: number,
  ): ResolvedHlsVariant => ({
    name,
    width,
    height,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 96,
    outputWidth: width,
    outputHeight: height,
  });

  let runner: FakeRunner;
  let service: FfmpegService;
  let tmp: string;

  beforeEach(() => {
    runner = new FakeRunner();
    service = new FfmpegService(runner, new ConfigService({}));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-svc-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('probe', () => {
    it('parses duration and dimensions from ffprobe JSON output', async () => {
      runner.enqueue({
        exitCode: 0,
        stdout: JSON.stringify({
          format: { duration: '125.5' },
          streams: [
            { codec_type: 'audio' },
            { codec_type: 'video', width: 1920, height: 1080 },
          ],
        }),
        stderr: '',
      });

      const result = await service.probe('/tmp/in.mp4');

      expect(result).toEqual({
        durationMs: 125_500,
        width: 1920,
        height: 1080,
        // Untagged HD source falls back to Rec.709, the same assumption
        // a player makes for a stream this size.
        color: BT709,
      });
      const probeCall = runner.calls[0]!;
      expect(probeCall.binary).toBe('ffprobe');
      expect(probeCall.args).toContain('-show_format');
      expect(probeCall.args).toContain('/tmp/in.mp4');
    });

    it('returns zero values when ffprobe fails', async () => {
      runner.enqueue({ exitCode: 1, stdout: '', stderr: 'broken' });
      const result = await service.probe('/tmp/in.mp4');
      expect(result).toEqual({
        durationMs: 0,
        width: 0,
        height: 0,
        color: BT709,
      });
    });

    it('survives malformed ffprobe JSON', async () => {
      runner.enqueue({ exitCode: 0, stdout: 'not-json', stderr: '' });
      const result = await service.probe('/tmp/in.mp4');
      expect(result).toEqual({
        durationMs: 0,
        width: 0,
        height: 0,
        color: BT709,
      });
    });

    it('carries the source colour description through', async () => {
      runner.enqueue({
        exitCode: 0,
        stdout: JSON.stringify({
          format: { duration: '10' },
          streams: [
            {
              codec_type: 'video',
              width: 640,
              height: 480,
              color_range: 'pc',
              color_space: 'bt470bg',
              color_primaries: 'bt470bg',
              color_transfer: 'gamma28',
            },
          ],
        }),
        stderr: '',
      });

      const result = await service.probe('/tmp/in.mp4');

      expect(result.color).toEqual({
        range: 'pc',
        space: 'bt470bg',
        primaries: 'bt470bg',
        transfer: 'gamma28',
      });
    });

    it('rejects colour values that are not real ffmpeg enums', async () => {
      // ffprobe reports "unknown" for untagged streams, and the value ends
      // up in an ffmpeg argv — anything unrecognised must not get through.
      runner.enqueue({
        exitCode: 0,
        stdout: JSON.stringify({
          format: { duration: '10' },
          streams: [
            {
              codec_type: 'video',
              width: 1920,
              height: 1080,
              color_range: 'unknown',
              color_space: 'reserved',
              color_primaries: '; rm -rf /',
              color_transfer: 'unknown',
            },
          ],
        }),
        stderr: '',
      });

      const result = await service.probe('/tmp/in.mp4');

      expect(result.color).toEqual(BT709);
    });
  });

  describe('transcodeVariant', () => {
    it('invokes ffmpeg with HLS flags + variant scaling', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      const variant = resolved('720p', 1280, 720); // 720p
      const outputDir = path.join(tmp, '720p');

      await service.transcodeVariant({
        inputPath: path.join(tmp, 'src.mp4'),
        outputDir,
        variant,
      });

      const call = runner.calls[0]!;
      expect(call.binary).toBe('ffmpeg');
      expect(call.args).toContain('-hls_time');
      expect(call.args).toContain('vod');
      expect(call.args.some((a) => a.includes('scale=w=1280:h=720'))).toBe(true);
      expect(call.args.some((a) => a.includes('libx264'))).toBe(true);
      // Constant quality, with the ladder's bitrate applied as a VBV cap.
      expect(call.args).not.toContain('-b:v');
      const crfIndex = call.args.indexOf('-crf');
      expect(call.args[crfIndex + 1]).toBe(String(HLS_CRF));
      const maxrateIndex = call.args.indexOf('-maxrate');
      expect(call.args[maxrateIndex + 1]).toBe(`${variant.videoBitrateKbps}k`);
      // Output dir was created on disk.
      expect(fs.existsSync(outputDir)).toBe(true);
    });

    it('scales to the resolved dimensions without padding the frame', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      // Portrait 720p rung: black bars here would both waste bitrate and
      // shrink the picture the viewer actually sees.
      await service.transcodeVariant({
        inputPath: path.join(tmp, 'src.mp4'),
        outputDir: path.join(tmp, '720p'),
        variant: resolved('720p', 720, 1280),
      });

      const call = runner.calls[0]!;
      expect(call.args.some((a) => a.includes('scale=w=720:h=1280'))).toBe(true);
      expect(call.args.some((a) => a.includes('pad='))).toBe(false);
    });

    it('tags the rendition with the source colour description', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      await service.transcodeVariant({
        inputPath: path.join(tmp, 'src.mp4'),
        outputDir: path.join(tmp, '240p'),
        variant: resolved('240p', 426, 240),
        color: BT709,
      });

      const { args } = runner.calls[0]!;
      expect(args[args.indexOf('-colorspace') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_primaries') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_trc') + 1]).toBe('bt709');
      expect(args[args.indexOf('-color_range') + 1]).toBe('tv');
    });

    it('encodes with the profile the master playlist advertises', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      await service.transcodeVariant({
        inputPath: path.join(tmp, 'src.mp4'),
        outputDir: path.join(tmp, '1440p'),
        variant: resolved('1440p', 2560, 1440),
      });

      const { args } = runner.calls[0]!;
      // `h264CodecString` declares High (0x64); a stream encoded as Main
      // would be advertised as something it is not.
      expect(args[args.indexOf('-profile:v') + 1]).toBe('high');
    });

    it('throws when ffmpeg exits non-zero', async () => {
      runner.enqueue({
        exitCode: 1,
        stdout: '',
        stderr: 'codec not found',
      });
      await expect(
        service.transcodeVariant({
          inputPath: path.join(tmp, 'src.mp4'),
          outputDir: path.join(tmp, '480p'),
          variant: resolved('480p', 854, 480),
        }),
      ).rejects.toThrow(/ffmpeg variant 480p failed/);
    });
  });

  describe('transcodeAllVariants', () => {
    it('gives every rung the same colour tags as the source', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      await service.transcodeAllVariants({
        inputPath: path.join(tmp, 'src.mp4'),
        hlsDir: path.join(tmp, 'hls'),
        variants: [resolved('240p', 426, 240), resolved('720p', 1280, 720)],
        color: BT709,
      });

      const { args } = runner.calls[0]!;
      // One set of tags per output — without them the SD rung would be
      // rendered as Rec.601 while the HD rung stays Rec.709.
      expect(args.filter((a) => a === '-colorspace')).toHaveLength(2);
      expect(args.filter((a) => a === '-crf')).toHaveLength(2);
      expect(args.some((a) => a.includes('pad='))).toBe(false);
    });

    it('bounds threads on every output, not just the first', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      await service.transcodeAllVariants({
        inputPath: path.join(tmp, 'src.mp4'),
        hlsDir: path.join(tmp, 'hls'),
        variants: [resolved('240p', 426, 240), resolved('720p', 1280, 720)],
      });

      // ffmpeg scopes an option to the next file it sees. One `-threads`
      // before `-i` binds the decoder alone, leaving each encoder on
      // x264's host-derived default — the OOM the pin exists to avoid.
      const { args } = runner.calls[0]!;
      expect(args.filter((a) => a === '-threads')).toHaveLength(3);
    });
  });

  describe('writeMasterPlaylist', () => {
    it('writes a master.m3u8 listing every variant by relative path', async () => {
      const out = path.join(tmp, 'master.m3u8');
      await service.writeMasterPlaylist({
        outputPath: out,
        variants: [resolved('240p', 426, 240), resolved('720p', 1280, 720)],
      });

      const text = fs.readFileSync(out, 'utf8');
      expect(text).toContain('#EXTM3U');
      expect(text).toContain('RESOLUTION=426x240');
      expect(text).toContain('RESOLUTION=1280x720');
      expect(text).toContain('240p/playlist.m3u8');
      expect(text).toContain('720p/playlist.m3u8');
    });

    it('scales the declared codec level with the frame size', async () => {
      const out = path.join(tmp, 'master.m3u8');
      await service.writeMasterPlaylist({
        outputPath: out,
        variants: [resolved('240p', 426, 240), resolved('1440p', 2560, 1440)],
      });

      // A single hard-coded level cannot cover the whole ladder: players
      // check CODECS before committing, and one that under-declares gets
      // a 1440p rung thrown out as unsupported.
      const text = fs.readFileSync(out, 'utf8');
      expect(text).toContain('CODECS="avc1.64001e,mp4a.40.2"'); // 3.0
      expect(text).toContain('CODECS="avc1.640033,mp4a.40.2"'); // 5.1
    });

    it('advertises the real output size, not the ladder box', async () => {
      const out = path.join(tmp, 'master.m3u8');
      await service.writeMasterPlaylist({
        outputPath: out,
        variants: [resolved('1080p', 1080, 1920)], // portrait 1080p
      });

      // Players pick a rung partly on RESOLUTION; declaring 1920x1080 for
      // a frame that is actually 1080x1920 mis-sorts the ladder.
      expect(fs.readFileSync(out, 'utf8')).toContain('RESOLUTION=1080x1920');
    });
  });
});
