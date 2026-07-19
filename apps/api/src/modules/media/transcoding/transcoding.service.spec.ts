import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { R2Service } from '../../../infra/r2/r2.service';
import { HLS_VARIANTS, HlsVariant } from '../media.types';
import { FfmpegService } from './ffmpeg.service';
import { TranscodingService } from './transcoding.service';

/**
 * Unit tests for TranscodingService — exercise the orchestration logic
 * without invoking ffmpeg or touching R2.
 *
 * Strategy:
 *   - Stub `R2Service.getObjectBuffer` / `putObject` with jest mocks.
 *   - Stub `FfmpegService` so that `transcodeVariant` writes a dummy
 *     `playlist.m3u8` + a `seg_000.ts` into the variant directory the
 *     service hands it. That mirrors the real layout enough to assert
 *     the upload set covers manifests + segments + master playlist.
 */
describe('TranscodingService', () => {
  const ASSET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OWNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const SOURCE_KEY = 'media/owner/video/2025/01/source.mp4';

  let r2: jest.Mocked<R2Service>;
  let ffmpeg: jest.Mocked<FfmpegService>;
  let service: TranscodingService;

  beforeEach(() => {
    r2 = {
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-mp4')),
      putObject: jest.fn().mockResolvedValue(undefined),
    } as any;

    ffmpeg = {
      probe: jest
        .fn()
        .mockResolvedValue({ durationMs: 60_000, width: 1920, height: 1080 }),
      transcodeVariant: jest.fn(async (input) => {
        // Write a dummy playlist + segment so the uploader has files to walk.
        fs.mkdirSync(input.outputDir, { recursive: true });
        fs.writeFileSync(
          path.join(input.outputDir, 'playlist.m3u8'),
          `#EXTM3U\n#variant ${input.variant.name}\n`,
          'utf8',
        );
        fs.writeFileSync(
          path.join(input.outputDir, 'seg_000.ts'),
          'segdata',
          'utf8',
        );
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
    expect(r2.getObjectBuffer).toHaveBeenCalledWith(SOURCE_KEY);

    // Probe ran on the local copy.
    expect(ffmpeg.probe).toHaveBeenCalledTimes(1);

    // One transcodeVariant call per variant in the ladder (1080p source
    // → all four variants apply because none up-scales).
    expect(ffmpeg.transcodeVariant).toHaveBeenCalledTimes(4);
    const variantNames = ffmpeg.transcodeVariant.mock.calls.map(
      (c) => (c[0].variant as HlsVariant).name,
    );
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
    });

    await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    // Only 240p + 480p variants apply for a 480p source.
    const names = ffmpeg.transcodeVariant.mock.calls.map(
      (c) => (c[0].variant as HlsVariant).name,
    );
    expect(names.sort()).toEqual(['240p', '480p']);
  });

  it('renders the full ladder when probe yields zero dimensions', async () => {
    ffmpeg.probe.mockResolvedValueOnce({
      durationMs: 0,
      width: 0,
      height: 0,
    });

    await service.run(ASSET_ID, SOURCE_KEY, OWNER_ID);

    expect(ffmpeg.transcodeVariant).toHaveBeenCalledTimes(4);
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
    ffmpeg.transcodeVariant.mockRejectedValueOnce(new Error('encoder boom'));

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
    });

    await expect(service.run(ASSET_ID, SOURCE_KEY, OWNER_ID)).rejects.toThrow(
      /No applicable variants/,
    );
  });

  describe('pickVariants', () => {
    it('returns full ladder for 1080p+ sources', () => {
      expect(service.pickVariants(1920, 1080).length).toBe(4);
    });

    it('drops higher renditions for smaller sources', () => {
      expect(service.pickVariants(1280, 720).map((v) => v.name)).toEqual([
        '240p',
        '480p',
        '720p',
      ]);
      expect(service.pickVariants(640, 360).map((v) => v.name)).toEqual([
        '240p',
      ]);
    });

    it('returns full ladder when probe failed (zero dims)', () => {
      expect(service.pickVariants(0, 0).length).toBe(4);
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
