import * as fs from 'fs';
import { Readable } from 'stream';
import * as os from 'os';
import * as path from 'path';

import { R2Service } from '../../../infra/r2/r2.service';
import { HLS_VARIANTS, ResolvedHlsVariant } from '../media.types';
import { FfmpegService } from './ffmpeg.service';
import { TranscodingService } from './transcoding.service';

/**
 * Unit tests for TranscodingService — exercise the orchestration logic
 * without invoking ffmpeg or touching R2.
 *
 * Strategy:
 *   - Stub `R2Service.getObjectBuffer` / `putObject` with jest mocks.
 *   - Stub `FfmpegService` so that `transcodeAllVariants` writes a dummy
 *     `playlist.m3u8` + a `seg_000.ts` into the variant directory the
 *     service hands it. That mirrors the real layout enough to assert
 *     the upload set covers manifests + segments + master playlist.
 */
describe('TranscodingService', () => {
  const ASSET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OWNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const SOURCE_KEY = 'media/owner/video/2025/01/source.mp4';
  const PROBE_COLOR = {
    range: 'tv',
    space: 'bt709',
    primaries: 'bt709',
    transfer: 'bt709',
  };

  let r2: jest.Mocked<R2Service>;
  let ffmpeg: jest.Mocked<FfmpegService>;
  let service: TranscodingService;

  beforeEach(() => {
    r2 = {
      // The service streams the source to disk rather than buffering it;
      // hand back a fresh Readable per call so `pipeline` can consume it.
      getObjectReadStream: jest
        .fn()
        .mockImplementation(async () => Readable.from([Buffer.from('fake-mp4')])),
      // Drain the body like the real R2 client does. `uploadHlsTree`
      // hands us lazily-opened read streams; a mock that resolves without
      // consuming them lets `cleanupWorkDir` delete the files first, and
      // the deferred open then throws ENOENT out of band.
      putObject: jest.fn(async (_key: string, body: unknown) => {
        if (body && typeof (body as Readable).resume === 'function') {
          const stream = body as Readable;
          await new Promise<void>((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
            stream.resume();
          });
        }
      }),
    } as any;

    ffmpeg = {
      probe: jest
        .fn()
        .mockResolvedValue({
          durationMs: 60_000,
          width: 2560,
          height: 1440,
          color: PROBE_COLOR,
        }),
      transcodeAllVariants: jest.fn(async (input) => {
        // Write a dummy playlist + segment per variant so the uploader
        // has files to walk — same tree the real single-process encode
        // produces.
        for (const variant of input.variants as ResolvedHlsVariant[]) {
          const outputDir = path.join(input.hlsDir, variant.name);
          fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(
            path.join(outputDir, 'playlist.m3u8'),
            `#EXTM3U\n#variant ${variant.name}\n`,
            'utf8',
          );
          fs.writeFileSync(
            path.join(outputDir, 'seg_000.ts'),
            'segdata',
            'utf8',
          );
        }
      }),
      writeMasterPlaylist: jest.fn(async (input) => {
        fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
        fs.writeFileSync(input.outputPath, '#EXTM3U\nMASTER\n', 'utf8');
      }),
    } as any;

    service = new TranscodingService(r2, ffmpeg);
  });

  it('downloads the source, encodes every variant, writes master + uploads everything (Req 8.4, 8.5)', async () => {
    const result = await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    // Source fetched once.
    expect(r2.getObjectReadStream).toHaveBeenCalledWith(SOURCE_KEY);

    // Probe ran on the local copy.
    expect(ffmpeg.probe).toHaveBeenCalledTimes(1);

    // One single-process ladder encode covering every variant (2K
    // source → all four apply because none up-scales).
    expect(ffmpeg.transcodeAllVariants).toHaveBeenCalledTimes(1);
    const variantNames = (
      ffmpeg.transcodeAllVariants.mock.calls[0]![0]!
        .variants as ResolvedHlsVariant[]
    ).map((v) => v.name);
    expect(variantNames.sort()).toEqual(
      [...HLS_VARIANTS.map((v) => v.name)].sort(),
    );

    // Master playlist was rendered.
    expect(ffmpeg.writeMasterPlaylist).toHaveBeenCalledTimes(1);

    // Uploads cover: 4 variant playlists + 4 variant segments + 1 master.
    expect(r2.putObject).toHaveBeenCalledTimes(9);
    const uploadedKeys = r2.putObject.mock.calls.map((c) => c[0]);
    const expectedBase = `media/${OWNER_ID}/hls/${ASSET_ID}`;
    expect(uploadedKeys).toContain(`${expectedBase}/master.m3u8`);
    for (const v of HLS_VARIANTS) {
      expect(uploadedKeys).toContain(
        `${expectedBase}/${v.name}/playlist.m3u8`,
      );
    }

    // Result reports the master manifest key + duration.
    expect(result.hlsManifestKey).toBe(`${expectedBase}/master.m3u8`);
    expect(result.durationMs).toBe(60_000);
    expect(result.variants.map((v) => v.name)).toEqual(
      HLS_VARIANTS.map((v) => v.name),
    );
  });

  it('skips up-scaling when the source is smaller than the top variant (Req 8.4)', async () => {
    ffmpeg.probe.mockResolvedValueOnce({
      durationMs: 30_000,
      width: 854,
      height: 480,
      color: PROBE_COLOR,
    });

    await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    // Only the 480p variant applies for a 480p source — it's the ladder's
    // smallest rung now that 240p is gone.
    const names = (
      ffmpeg.transcodeAllVariants.mock.calls[0]![0]!
        .variants as ResolvedHlsVariant[]
    ).map((v) => v.name);
    expect(names.sort()).toEqual(['480p']);
  });

  it('renders the full ladder when probe yields zero dimensions', async () => {
    ffmpeg.probe.mockResolvedValueOnce({
      durationMs: 0,
      width: 0,
      height: 0,
      color: PROBE_COLOR,
    });

    await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    expect(
      ffmpeg.transcodeAllVariants.mock.calls[0]![0]!.variants,
    ).toHaveLength(4);
  });

  it('cleans up the temp working directory after success', async () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) =>
      n.includes('edubridge-transcode'),
    );

    await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    const after = fs.readdirSync(os.tmpdir()).filter((n) =>
      n.includes('edubridge-transcode'),
    );
    // No new edubridge-transcode-* directories left behind.
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it('cleans up the temp working directory after failure', async () => {
    ffmpeg.transcodeAllVariants.mockRejectedValueOnce(
      new Error('encoder boom'),
    );

    await expect(service.run(ASSET_ID, SOURCE_KEY, OWNER_ID)).rejects.toThrow(
      /encoder boom/,
    );

    // Tmp dir for this specific asset id should be gone.
    const dirs = fs.readdirSync(os.tmpdir()).filter((n) =>
      n.includes(`edubridge-transcode-${ASSET_ID}`),
    );
    expect(dirs).toEqual([]);
  });

  it('throws when no variants apply (impossible for the static ladder, defensive)', async () => {
    // Force pickVariants to return [] by stubbing it.
    jest.spyOn(service, 'pickVariants').mockReturnValueOnce([]);
    ffmpeg.probe.mockResolvedValueOnce({
      durationMs: 0,
      width: 100,
      height: 50,
      color: PROBE_COLOR,
    });

    await expect(service.run(ASSET_ID, SOURCE_KEY, OWNER_ID)).rejects.toThrow(
      /No applicable variants/,
    );
  });

  describe('pickVariants', () => {
    it('returns the whole ladder for a 2K source', () => {
      expect(service.pickVariants(2560, 1440).map((v) => v.name)).toEqual([
        '480p',
        '720p',
        '1080p',
        '1440p',
      ]);
    });

    it('caps delivery at 2K for larger sources', () => {
      // 4K in, 2K out: the ladder's top rung is the delivery ceiling, so
      // nothing above it is ever produced or served.
      const picked = service.pickVariants(3840, 2160);
      const top = picked[picked.length - 1]!;
      expect(top.outputWidth).toBe(2560);
      expect(top.outputHeight).toBe(1440);
    });

    it('stops at the rung that reproduces a 1080p source natively', () => {
      // The 1440p rung would have to upscale, so it collapses onto 1080p
      // and is dropped rather than re-encoding the same picture twice.
      expect(service.pickVariants(1920, 1080).map((v) => v.name)).toEqual([
        '480p',
        '720p',
        '1080p',
      ]);
    });

    it('drops higher renditions for smaller sources', () => {
      expect(service.pickVariants(1280, 720).map((v) => v.name)).toEqual([
        '480p',
        '720p',
      ]);
      // 480p is the ladder's smallest rung, so anything at or below it
      // collapses onto a single native-size rendition.
      expect(service.pickVariants(640, 360).map((v) => v.name)).toEqual([
        '480p',
      ]);
    });

    it('returns full ladder when probe failed (zero dims)', () => {
      expect(service.pickVariants(0, 0).length).toBe(4);
    });

    it('fits landscape sources to the ladder without letterboxing', () => {
      const dims = service
        .pickVariants(1920, 1080)
        .map((v) => `${v.outputWidth}x${v.outputHeight}`);
      expect(dims).toEqual(['854x480', '1280x720', '1920x1080']);
    });

    it('transposes the ladder for portrait sources (Req 8.4)', () => {
      // A phone recording must keep its full width at each rung; fitting
      // it into the landscape box would render "1080p" as 608x1080.
      const picked = service.pickVariants(1080, 1920);
      expect(picked.map((v) => `${v.outputWidth}x${v.outputHeight}`)).toEqual([
        '480x854',
        '720x1280',
        '1080x1920',
      ]);
    });

    it('preserves a non-16:9 aspect ratio instead of padding to the box', () => {
      const [smallest] = service.pickVariants(640, 480);
      expect(smallest!.outputWidth / smallest!.outputHeight).toBeCloseTo(
        640 / 480,
        2,
      );
    });

    it('emits only even dimensions (libx264 yuv420p requirement)', () => {
      for (const variant of service.pickVariants(1001, 563)) {
        expect(variant.outputWidth % 2).toBe(0);
        expect(variant.outputHeight % 2).toBe(0);
      }
    });
  });

  describe('buildHlsBaseKey', () => {
    it('builds keys under media/<owner>/hls/<assetId>', () => {
      expect(service.buildHlsBaseKey(OWNER_ID, ASSET_ID)).toBe(
        `media/${OWNER_ID}/hls/${ASSET_ID}`,
      );
    });
  });
});
