import { ConflictException, NotFoundException } from '@nestjs/common';

import { MediaService } from './media.service';
import { MediaAccessService } from './media-access.service';
import { MediaAssetRepository } from './repositories/media-asset.repository';
import { R2Service } from '../../infra/r2/r2.service';
import { HLS_VARIANTS, deriveHlsVariantKey } from './media.types';

/**
 * Unit tests for `MediaService.getPlaybackUrls` — Task 11.3.
 *
 * Validates Requirements 8.3, 8.7, 8.8, 21.6:
 *  - HLS-ready video returns a master manifest URL plus one signed URL
 *    per variant playlist (Req 8.3, 8.4).
 *  - Non-HLS assets fall back to the original key (Req 8.7).
 *  - All TTLs are clamped to ≤ 6 hours (Req 21.6).
 *  - Authorization is delegated to MediaAccessService (Req 8.8) — the
 *    service NEVER signs anything before that check completes.
 *  - UPLOADING / FAILED rows return 409 (no playback URL).
 */
describe('MediaService.getPlaybackUrls', () => {
  const ownerId = '11111111-1111-1111-1111-111111111111';
  const studentId = 'student-1';
  const assetId = 'asset-1';

  let r2: jest.Mocked<R2Service>;
  let assets: jest.Mocked<MediaAssetRepository>;
  let access: jest.Mocked<MediaAccessService>;
  let tokens: { generateMediaStreamToken: jest.Mock; verifyMediaStreamToken: jest.Mock };
  let service: MediaService;

  const baseAsset = (overrides: any = {}) => ({
    id: assetId,
    ownerUserId: ownerId,
    kind: 'VIDEO',
    status: 'READY',
    bytes: BigInt(2048),
    contentType: 'video/mp4',
    originalKey: 'media/owner/video/2025/01/abc-original.mp4',
    hlsManifestKey: 'media/owner/video/2025/01/abc-original/master.m3u8',
    thumbnailKey: null,
    durationMs: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    r2 = {
      getBucket: jest.fn().mockReturnValue('edubridge-media'),
      createMultipartUpload: jest.fn(),
      signUploadPart: jest.fn(),
      signUploadPartBatch: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      signObjectGet: jest
        .fn()
        .mockImplementation(async (key: string) => `https://r2/sign/${key}`),
      objectExists: jest.fn(),
    } as any;

    assets = {
      findById: jest.fn(),
      findByIdForOwner: jest.fn(),
      findStaleUploads: jest.fn(),
      createUploading: jest.fn(),
      transitionStatus: jest.fn(),
      updateMetadata: jest.fn(),
    } as any;

    access = {
      assertCanRead: jest.fn().mockResolvedValue(undefined),
    } as any;

    const transcodingQueue = { add: jest.fn() } as any;

    // Playback signing needs a token minter and the API base URL; the prisma
    // client is only touched by the public-cover path, which these specs do
    // not exercise.
    tokens = {
      generateMediaStreamToken: jest.fn().mockResolvedValue('stream-token'),
      verifyMediaStreamToken: jest.fn(),
    } as any;
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:4000'),
    } as any;

    service = new MediaService(
      {} as any,
      r2,
      assets,
      access,
      tokens as any,
      config,
      transcodingQueue,
    );
  });

  // -------------------------------------------------------------------
  // HLS-ready video
  // -------------------------------------------------------------------
  describe('HLS playback (Req 8.3, 8.4)', () => {
    it('returns the master manifest plus every HLS variant playlist', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
      );

      // Manifest first, then one per variant.
      expect(result.type).toBe('manifest');
      expect(result.urls).toHaveLength(1 + HLS_VARIANTS.length);

      const manifestEntry = result.urls.find((u) => u.role === 'manifest');
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry!.key).toBe(baseAsset().hlsManifestKey);
      expect(result.url).toBe(manifestEntry!.url);

      // Playback goes through the API's own stream proxy carrying a
      // short-lived media token — a raw presigned R2 URL would be a bearer
      // token for the object that survives being copied out of the player.
      for (const variant of HLS_VARIANTS) {
        const expectedKey = deriveHlsVariantKey(
          baseAsset().hlsManifestKey,
          variant.name,
        );
        const entry = result.urls.find(
          (u) => u.role === 'variant' && u.variant === variant.name,
        );
        expect(entry).toBeDefined();
        expect(entry!.key).toBe(expectedKey);
        expect(entry!.url).toBe(
          `http://localhost:4000/api/v1/media/stream/${assetId}` +
            `/hls/${variant.name}/playlist.m3u8?token=stream-token`,
        );
      }

      expect(result.urls.every((u) => !u.url.includes('r2/sign'))).toBe(true);
    });

    it('falls back to the original key when hlsManifestKey is null', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({ status: 'UPLOADED', hlsManifestKey: null }) as any,
      );

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
      );

      expect(result.type).toBe('original');
      expect(result.urls).toHaveLength(1);
      const first = result.urls[0]!;
      expect(first.role).toBe('original');
      expect(first.key).toBe(baseAsset().originalKey);
    });
  });

  // -------------------------------------------------------------------
  // Non-video assets
  // -------------------------------------------------------------------
  describe('non-HLS playback', () => {
    it('signs the original key for PDFs', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({
          kind: 'PDF',
          contentType: 'application/pdf',
          hlsManifestKey: null,
          originalKey: 'media/owner/pdf/2025/01/x.pdf',
        }) as any,
      );

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
      );

      expect(result.type).toBe('original');
      expect(result.urls).toHaveLength(1);
      expect(result.urls[0]!.url).toMatch(/x\.pdf$/);
    });
  });

  // -------------------------------------------------------------------
  // Authorization (Req 8.8)
  // -------------------------------------------------------------------
  describe('authorization (Req 8.8)', () => {
    it('delegates to MediaAccessService.assertCanRead before minting a token', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);

      await service.getPlaybackUrls(
        { sub: studentId, role: 'STUDENT' },
        assetId,
      );

      expect(access.assertCanRead).toHaveBeenCalledTimes(1);
      // The credential that unlocks playback is now the stream token, not an
      // R2 signature — so that is what must not be produced before the access
      // check has run.
      const accessOrder = access.assertCanRead.mock.invocationCallOrder[0]!;
      const tokenOrder = (tokens.generateMediaStreamToken as jest.Mock).mock
        .invocationCallOrder[0]!;
      expect(accessOrder).toBeLessThan(tokenOrder);
    });

    it('does not sign anything when the access check throws', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);
      access.assertCanRead.mockRejectedValue(
        new Error('MEDIA_ACCESS_DENIED'),
      );

      await expect(
        service.getPlaybackUrls(
          { sub: 'random-student', role: 'STUDENT' },
          assetId,
        ),
      ).rejects.toThrow();

      expect(r2.signObjectGet).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // TTL clamp (Req 21.6)
  // -------------------------------------------------------------------
  describe('signed URL TTL (Req 21.6)', () => {
    it('clamps the requested TTL to the 6h hard cap', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
        24 * 60 * 60, // 24h — above the cap
      );

      expect(result.expiresInSeconds).toBeLessThanOrEqual(6 * 60 * 60);
      // Every sign call is ≤ 6h.
      for (const call of r2.signObjectGet.mock.calls) {
        const ttl = call[1];
        expect(typeof ttl).toBe('number');
        expect(ttl as number).toBeLessThanOrEqual(6 * 60 * 60);
      }
    });

    it('passes the clamped TTL through to R2.signObjectGet', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
        15 * 60, // 15m — under the cap
      );

      expect(result.expiresInSeconds).toBe(15 * 60);
      for (const call of r2.signObjectGet.mock.calls) {
        expect(call[1]).toBe(15 * 60);
      }
    });

    it('reports an `expiresAt` ISO timestamp consistent with `expiresInSeconds`', async () => {
      assets.findById.mockResolvedValue(baseAsset() as any);

      const before = Date.now();
      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
        300,
      );
      const after = Date.now();

      const expiresAtMs = new Date(result.expiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 300_000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 300_000 + 5);
    });
  });

  // -------------------------------------------------------------------
  // Status guards
  // -------------------------------------------------------------------
  describe('status guards', () => {
    it('returns 404 MEDIA_NOT_FOUND when no row matches the id', async () => {
      assets.findById.mockResolvedValue(null);

      await expect(
        service.getPlaybackUrls({ sub: ownerId, role: 'TEACHER' }, assetId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(access.assertCanRead).not.toHaveBeenCalled();
    });

    it('returns 409 MEDIA_NOT_READY for UPLOADING assets', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({ status: 'UPLOADING' }) as any,
      );

      await expect(
        service.getPlaybackUrls({ sub: ownerId, role: 'TEACHER' }, assetId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(r2.signObjectGet).not.toHaveBeenCalled();
    });

    it('returns 409 MEDIA_FAILED for FAILED non-video assets', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({ status: 'FAILED', kind: 'IMAGE' }) as any,
      );

      await expect(
        service.getPlaybackUrls({ sub: ownerId, role: 'TEACHER' }, assetId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(r2.signObjectGet).not.toHaveBeenCalled();
    });

    it('falls back to the original object when video transcoding failed', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({
          status: 'FAILED',
          kind: 'VIDEO',
          hlsManifestKey: null,
          originalKey: 'media/source.mp4',
        }) as any,
      );
      r2.signObjectGet.mockResolvedValue('https://signed/source.mp4');

      const result = await service.getPlaybackUrls(
        { sub: ownerId, role: 'TEACHER' },
        assetId,
      );

      expect(result).toMatchObject({
        status: 'FAILED',
        type: 'original',
        url: 'https://signed/source.mp4',
      });
    });

    it('returns 409 MEDIA_KEY_MISSING when the asset has no R2 key (data corruption guard)', async () => {
      assets.findById.mockResolvedValue(
        baseAsset({
          status: 'UPLOADED',
          hlsManifestKey: null,
          originalKey: null,
        }) as any,
      );

      await expect(
        service.getPlaybackUrls({ sub: ownerId, role: 'TEACHER' }, assetId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MEDIA_KEY_MISSING' }),
      });
    });
  });
});

describe('deriveHlsVariantKey', () => {
  it('places the variant directory next to the master manifest', () => {
    const key = deriveHlsVariantKey('a/b/c/master.m3u8', '720p');
    expect(key).toBe('a/b/c/720p/playlist.m3u8');
  });

  it('handles a top-level master file', () => {
    const key = deriveHlsVariantKey('master.m3u8', '480p');
    expect(key).toBe('480p/playlist.m3u8');
  });

  it('throws on empty inputs', () => {
    expect(() => deriveHlsVariantKey('', '720p')).toThrow();
    expect(() => deriveHlsVariantKey('a/master.m3u8', '')).toThrow();
  });
});
