import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HLS_VARIANTS } from '../media.types';
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
      });
      const probeCall = runner.calls[0]!;
      expect(probeCall.binary).toBe('ffprobe');
      expect(probeCall.args).toContain('-show_format');
      expect(probeCall.args).toContain('/tmp/in.mp4');
    });

    it('returns zero values when ffprobe fails', async () => {
      runner.enqueue({ exitCode: 1, stdout: '', stderr: 'broken' });
      const result = await service.probe('/tmp/in.mp4');
      expect(result).toEqual({ durationMs: 0, width: 0, height: 0 });
    });

    it('survives malformed ffprobe JSON', async () => {
      runner.enqueue({ exitCode: 0, stdout: 'not-json', stderr: '' });
      const result = await service.probe('/tmp/in.mp4');
      expect(result).toEqual({ durationMs: 0, width: 0, height: 0 });
    });
  });

  describe('transcodeVariant', () => {
    it('invokes ffmpeg with HLS flags + variant scaling', async () => {
      runner.enqueue({ exitCode: 0, stdout: '', stderr: '' });
      const variant = HLS_VARIANTS[2]!; // 720p
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
      // Bitrate flags carry the variant-specific value.
      expect(call.args).toContain('-b:v');
      const bvIndex = call.args.indexOf('-b:v');
      expect(call.args[bvIndex + 1]).toBe(`${variant.videoBitrateKbps}k`);
      // Output dir was created on disk.
      expect(fs.existsSync(outputDir)).toBe(true);
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
          variant: HLS_VARIANTS[1]!,
        }),
      ).rejects.toThrow(/ffmpeg variant 480p failed/);
    });
  });

  describe('writeMasterPlaylist', () => {
    it('writes a master.m3u8 listing every variant by relative path', async () => {
      const out = path.join(tmp, 'master.m3u8');
      await service.writeMasterPlaylist({
        outputPath: out,
        variants: [HLS_VARIANTS[0]!, HLS_VARIANTS[2]!], // 240p + 720p
      });

      const text = fs.readFileSync(out, 'utf8');
      expect(text).toContain('#EXTM3U');
      expect(text).toContain('RESOLUTION=426x240');
      expect(text).toContain('RESOLUTION=1280x720');
      expect(text).toContain('240p/playlist.m3u8');
      expect(text).toContain('720p/playlist.m3u8');
    });
  });
});
