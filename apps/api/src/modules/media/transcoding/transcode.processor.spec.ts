import { MediaAssetRepository } from '../repositories/media-asset.repository';
import { TranscodingService } from './transcoding.service';
import { VideoTranscodeProcessor } from './transcode.processor';

/**
 * Unit tests for VideoTranscodeProcessor — Requirements 8.3, 8.4, 8.5.
 *
 * The processor's job is to mediate between the BullMQ queue and the
 * pure-logic `TranscodingService`. We assert the state machine
 * (UPLOADED → TRANSCODING → READY / FAILED) and the retry / idempotency
 * semantics without ever invoking ffmpeg.
 */
describe('VideoTranscodeProcessor', () => {
  const ASSET_ID = '11111111-2222-3333-4444-555555555555';
  const OWNER_ID = '99999999-9999-9999-9999-999999999999';
  const SOURCE_KEY = 'media/99999999/video/2025/01/source.mp4';
  const MANIFEST_KEY = `media/${OWNER_ID}/hls/${ASSET_ID}/master.m3u8`;

  let assets: jest.Mocked<MediaAssetRepository>;
  let transcoder: jest.Mocked<TranscodingService>;
  let processor: VideoTranscodeProcessor;

  const buildAsset = (overrides: Partial<any> = {}) =>
    ({
      id: ASSET_ID,
      ownerUserId: OWNER_ID,
      kind: 'VIDEO' as const,
      status: 'UPLOADED' as const,
      bytes: BigInt(50_000_000),
      contentType: 'video/mp4',
      originalKey: SOURCE_KEY,
      hlsManifestKey: null,
      thumbnailKey: null,
      durationMs: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as any;

  beforeEach(() => {
    assets = {
      findById: jest.fn(),
      findByIdForOwner: jest.fn(),
      findStaleUploads: jest.fn(),
      createUploading: jest.fn(),
      transitionStatus: jest.fn().mockResolvedValue(1),
      updateMetadata: jest.fn(),
    } as any;

    transcoder = {
      run: jest.fn().mockResolvedValue({
        hlsManifestKey: MANIFEST_KEY,
        durationMs: 65_000,
        variants: [],
      }),
    } as any;

    processor = new VideoTranscodeProcessor(assets, transcoder);
  });

  // ------------------------------------------------------------------
  // Happy path (Req 8.3, 8.4, 8.5)
  // ------------------------------------------------------------------

  it('transitions UPLOADED → TRANSCODING → READY and persists hlsManifestKey (Req 8.5)', async () => {
    assets.findById.mockResolvedValue(buildAsset());

    const result = await processor.process({
      id: 'job-1',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    // Claim transition: UPLOADED → TRANSCODING.
    expect(assets.transitionStatus).toHaveBeenNthCalledWith(
      1,
      ASSET_ID,
      'UPLOADED',
      'TRANSCODING',
    );
    // Worker invoked TranscodingService.
    expect(transcoder.run).toHaveBeenCalledWith(
      ASSET_ID,
      SOURCE_KEY,
      OWNER_ID,
    );
    // Final transition: TRANSCODING → READY with manifest + duration.
    expect(assets.transitionStatus).toHaveBeenNthCalledWith(
      2,
      ASSET_ID,
      'TRANSCODING',
      'READY',
      expect.objectContaining({
        hlsManifestKey: MANIFEST_KEY,
        durationMs: 65_000,
      }),
    );
    expect(result).toEqual({
      assetId: ASSET_ID,
      status: 'READY',
      hlsManifestKey: MANIFEST_KEY,
      durationMs: 65_000,
    });
  });

  // ------------------------------------------------------------------
  // Idempotency (Req 8.3)
  // ------------------------------------------------------------------

  it('returns SKIPPED when the asset is already READY (idempotent retry)', async () => {
    assets.findById.mockResolvedValue(
      buildAsset({ status: 'READY', hlsManifestKey: MANIFEST_KEY }),
    );

    const result = await processor.process({
      id: 'job-replay',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(result.status).toBe('READY');
    expect(result.hlsManifestKey).toBe(MANIFEST_KEY);
    expect(assets.transitionStatus).not.toHaveBeenCalled();
    expect(transcoder.run).not.toHaveBeenCalled();
  });

  it('returns SKIPPED when the UPLOADED → TRANSCODING claim is lost', async () => {
    assets.findById.mockResolvedValue(buildAsset());
    // Another worker won the race — updateMany count is 0.
    assets.transitionStatus.mockResolvedValueOnce(0);

    const result = await processor.process({
      id: 'job-race',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(result.status).toBe('SKIPPED');
    expect(transcoder.run).not.toHaveBeenCalled();
  });

  it('re-enters processing when the asset is already TRANSCODING (post-crash retry)', async () => {
    assets.findById.mockResolvedValue(buildAsset({ status: 'TRANSCODING' }));

    const result = await processor.process({
      id: 'job-retry',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as any);

    expect(transcoder.run).toHaveBeenCalled();
    // No UPLOADED → TRANSCODING transition (already TRANSCODING).
    expect(assets.transitionStatus).toHaveBeenCalledTimes(1);
    expect(assets.transitionStatus).toHaveBeenCalledWith(
      ASSET_ID,
      'TRANSCODING',
      'READY',
      expect.any(Object),
    );
    expect(result.status).toBe('READY');
  });

  // ------------------------------------------------------------------
  // Skip / guardrails
  // ------------------------------------------------------------------

  it('skips when the asset is missing', async () => {
    assets.findById.mockResolvedValue(null);

    const result = await processor.process({
      id: 'job-missing',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(result.status).toBe('SKIPPED');
    expect(transcoder.run).not.toHaveBeenCalled();
  });

  it('skips when the asset is not a VIDEO', async () => {
    assets.findById.mockResolvedValue(buildAsset({ kind: 'PDF' }));

    const result = await processor.process({
      id: 'job-pdf',
      name: 'video.transcode',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(result.status).toBe('SKIPPED');
    expect(transcoder.run).not.toHaveBeenCalled();
  });

  it('skips when receiving an unknown job name', async () => {
    const result = await processor.process({
      id: 'job-bad',
      name: 'something.else',
      data: { assetId: ASSET_ID },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(result.status).toBe('SKIPPED');
    expect(assets.findById).not.toHaveBeenCalled();
  });

  it('throws when assetId is missing in the payload', async () => {
    await expect(
      processor.process({
        id: 'job-no-id',
        name: 'video.transcode',
        data: {},
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow(/assetId is required/);
  });

  // ------------------------------------------------------------------
  // Failure & retry semantics
  // ------------------------------------------------------------------

  it('rethrows transient failures and DOES NOT mark FAILED while retries remain', async () => {
    assets.findById.mockResolvedValue(buildAsset());
    transcoder.run.mockRejectedValueOnce(new Error('R2 timeout'));

    await expect(
      processor.process({
        id: 'job-attempt-1',
        name: 'video.transcode',
        data: { assetId: ASSET_ID },
        attemptsMade: 0, // first attempt of 3
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow(/R2 timeout/);

    // Only the claim transition happened; FAILED should NOT be set yet.
    expect(assets.transitionStatus).toHaveBeenCalledTimes(1);
    expect(assets.transitionStatus).toHaveBeenCalledWith(
      ASSET_ID,
      'UPLOADED',
      'TRANSCODING',
    );
  });

  it('marks the row FAILED on the final failed attempt', async () => {
    assets.findById.mockResolvedValue(buildAsset({ status: 'TRANSCODING' }));
    transcoder.run.mockRejectedValueOnce(new Error('encoder boom'));

    await expect(
      processor.process({
        id: 'job-attempt-3',
        name: 'video.transcode',
        data: { assetId: ASSET_ID },
        attemptsMade: 2, // 0-indexed: this is the 3rd and last attempt
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow(/encoder boom/);

    expect(assets.transitionStatus).toHaveBeenCalledWith(
      ASSET_ID,
      'TRANSCODING',
      'FAILED',
    );
  });

  it('marks FAILED when the asset has no originalKey to transcode', async () => {
    assets.findById.mockResolvedValue(buildAsset({ originalKey: null }));

    await expect(
      processor.process({
        id: 'job-no-key',
        name: 'video.transcode',
        data: { assetId: ASSET_ID },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow(/no originalKey/);

    expect(assets.transitionStatus).toHaveBeenCalledWith(
      ASSET_ID,
      'UPLOADED',
      'FAILED',
    );
  });
});
