import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MediaService } from './media.service';
import { MediaAccessService } from './media-access.service';
import { MediaAssetRepository } from './repositories/media-asset.repository';
import { R2Service, type SignedPartUrl } from '../../infra/r2/r2.service';
import { ALLOWED_MIME_BY_KIND, MEDIA_KIND_VALUES } from './media.types';

/**
 * Unit tests for MediaService — cover the multipart upload lifecycle
 * (Req 8.1, 8.2, 8.6, 8.7, 8.8) and the cross-owner authorization rules
 * the service enforces on top of the controller-level RBAC.
 */
describe('MediaService', () => {
  let mediaService: MediaService;
  let r2: jest.Mocked<R2Service>;
  let assets: jest.Mocked<MediaAssetRepository>;
  let transcodingQueue: { add: jest.Mock };

  const ownerId = '11111111-1111-1111-1111-111111111111';
  const otherOwnerId = '22222222-2222-2222-2222-222222222222';
  const assetId = '33333333-3333-3333-3333-333333333333';
  const uploadId = 'r2-upload-id';
  const objectKey = 'media/owner/video/2025/01/abc-test.mp4';

  const buildAsset = (overrides: Partial<any> = {}) => ({
    id: assetId,
    ownerUserId: ownerId,
    kind: 'VIDEO' as const,
    status: 'UPLOADING' as const,
    bytes: BigInt(1024 * 1024 * 10),
    contentType: 'video/mp4',
    originalKey: objectKey,
    hlsManifestKey: null,
    thumbnailKey: null,
    durationMs: null,
    metadata: {
      multipart: {
        uploadId,
        partsCount: 3,
        fileName: 'test.mp4',
      },
    } as Prisma.JsonObject,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    r2 = {
      getBucket: jest.fn().mockReturnValue('edubridge-media'),
      createMultipartUpload: jest.fn().mockResolvedValue(uploadId),
      signUploadPart: jest.fn(),
      signUploadPartBatch: jest.fn(),
      completeMultipartUpload: jest
        .fn()
        .mockResolvedValue({ key: objectKey, etag: '"abc"' }),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      signObjectGet: jest.fn(),
      objectExists: jest.fn(),
      // `completeUpload` re-checks the real object size against the hard cap
      // rather than trusting the byte count the client declared. `null` means
      // "size unknown", which the service treats as "do not fail the asset".
      getObjectSize: jest.fn().mockResolvedValue(null),
    } as any;

    assets = {
      findById: jest.fn(),
      findByIdForOwner: jest.fn(),
      findStaleUploads: jest.fn(),
      createUploading: jest.fn(),
      transitionStatus: jest.fn().mockResolvedValue(1),
      updateMetadata: jest.fn(),
    } as any;

    const access = {
      assertCanRead: jest.fn().mockResolvedValue(undefined),
    } as unknown as MediaAccessService;

    transcodingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as any;

    // `getPublicImageUrl` only signs an asset that is actually referenced by a
    // publicly-served field (a teacher or course cover), so it checks those
    // two tables. Both resolve truthy here — the specs that exercise the
    // public path use assets that are meant to be public.
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({ userId: ownerId }),
      },
      course: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    mediaService = new MediaService(
      prisma as any,
      r2,
      assets,
      access,
      {} as any, // TokensService — only used by the signed-stream path
      { get: jest.fn() } as any, // ConfigService — ditto
      transcodingQueue as any,
    );
  });

  // ---------------------------------------------------------------
  // initiateUpload (Req 8.1, 8.7)
  // ---------------------------------------------------------------
  describe('initiateUpload', () => {
    const baseDto = {
      fileName: 'lecture-1.mp4',
      kind: 'VIDEO' as const,
      contentType: 'video/mp4',
      sizeBytes: 50 * 1024 * 1024, // 50 MiB
      partsCount: 7,
    };

    it('creates an UPLOADING MediaAsset and returns signed part URLs (Req 8.1)', async () => {
      const created = buildAsset();
      assets.createUploading.mockResolvedValue(created);
      const partUrls: SignedPartUrl[] = Array.from({ length: 7 }, (_, i) => ({
        partNumber: i + 1,
        url: `https://r2/sign/${i + 1}`,
      }));
      r2.signUploadPartBatch.mockResolvedValue(partUrls);

      const result = await mediaService.initiateUpload(ownerId, baseDto);

      expect(r2.createMultipartUpload).toHaveBeenCalledWith(
        expect.stringContaining('media/'),
        'video/mp4',
      );
      expect(assets.createUploading).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: ownerId,
          kind: 'VIDEO',
          contentType: 'video/mp4',
          sizeBytes: baseDto.sizeBytes,
          uploadId,
          partsCount: 7,
        }),
      );
      expect(r2.signUploadPartBatch).toHaveBeenCalledWith(
        expect.stringContaining('media/'),
        uploadId,
        7,
        expect.any(Number),
      );
      expect(result.assetId).toBe(created.id);
      expect(result.uploadId).toBe(uploadId);
      expect(result.partUrls).toHaveLength(7);
      expect(result.partUrls[0]).toEqual({
        partNumber: 1,
        url: 'https://r2/sign/1',
      });
    });

    it('rejects content types not in the allow-list for the kind (Req 8.7)', async () => {
      await expect(
        mediaService.initiateUpload(ownerId, {
          ...baseDto,
          kind: 'PDF',
          contentType: 'application/x-msdownload',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(r2.createMultipartUpload).not.toHaveBeenCalled();
      expect(assets.createUploading).not.toHaveBeenCalled();
    });

    it('rejects mismatched MIME type vs kind (Req 8.7 — defense in depth)', async () => {
      // PDF kind with video/mp4 contentType — UI cannot mix them, but the
      // service must catch the case if a teacher constructs the request
      // manually.
      await expect(
        mediaService.initiateUpload(ownerId, {
          ...baseDto,
          kind: 'PDF',
          contentType: 'video/mp4',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects files larger than the platform cap (5 GiB)', async () => {
      await expect(
        mediaService.initiateUpload(ownerId, {
          ...baseDto,
          sizeBytes: 6 * 1024 * 1024 * 1024, // 6 GiB
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MEDIA_FILE_TOO_LARGE' }),
      });
      expect(r2.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects partsCount that would force sub-5MiB parts', async () => {
      // 10 MiB file but client asks for 50 parts → would create parts < 5 MiB
      // and only the last one is allowed to be smaller.
      await expect(
        mediaService.initiateUpload(ownerId, {
          ...baseDto,
          sizeBytes: 10 * 1024 * 1024,
          partsCount: 50,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MEDIA_PARTS_COUNT_INVALID',
        }),
      });
    });

    it('cleans up the R2 multipart upload if persisting the row fails', async () => {
      const dbError = new Error('db down');
      assets.createUploading.mockRejectedValue(dbError);

      await expect(mediaService.initiateUpload(ownerId, baseDto)).rejects.toBe(
        dbError,
      );

      expect(r2.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringContaining('media/'),
        uploadId,
      );
      expect(r2.signUploadPartBatch).not.toHaveBeenCalled();
    });

    it('accepts every kind in the catalog with at least one allowed MIME', () => {
      // Property-style sanity check: every kind exposed via MEDIA_KIND_VALUES
      // must either be empty (OTHER) or pass validation for at least one
      // MIME type in its allow-list.
      for (const kind of MEDIA_KIND_VALUES) {
        const allowed = ALLOWED_MIME_BY_KIND[kind];
        if (allowed.length === 0) continue;
        const sample = allowed[0];
        expect(() =>
          (mediaService as any).assertContentTypeAllowed(kind, sample),
        ).not.toThrow();
      }
    });
  });

  // ---------------------------------------------------------------
  // completeUpload (Req 8.2)
  // ---------------------------------------------------------------
  describe('completeUpload', () => {
    it('finalizes the upload and transitions UPLOADING → UPLOADED (Req 8.2)', async () => {
      assets.findById.mockResolvedValue(buildAsset());

      const result = await mediaService.completeUpload(ownerId, assetId, {
        parts: [
          { partNumber: 1, etag: 'aaa' },
          { partNumber: 2, etag: '"bbb"' }, // already-quoted
          { partNumber: 3, etag: 'ccc' },
        ],
      });

      expect(r2.completeMultipartUpload).toHaveBeenCalledWith(
        objectKey,
        uploadId,
        expect.any(Array),
      );
      expect(assets.transitionStatus).toHaveBeenCalledWith(
        assetId,
        'UPLOADING',
        'UPLOADED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            multipart: expect.objectContaining({
              uploadId,
              partsCount: 3,
            }),
          }),
        }),
      );
      expect(result.status).toBe('UPLOADED');
      expect(result.assetId).toBe(assetId);
      expect(result.key).toBe(objectKey);
    });

    it('enqueues a video.transcode job for VIDEO uploads after completion (Req 8.3)', async () => {
      assets.findById.mockResolvedValue(buildAsset({ kind: 'VIDEO' }));

      await mediaService.completeUpload(ownerId, assetId, {
        parts: [
          { partNumber: 1, etag: 'aaa' },
          { partNumber: 2, etag: 'bbb' },
          { partNumber: 3, etag: 'ccc' },
        ],
      });

      expect(transcodingQueue.add).toHaveBeenCalledTimes(1);
      const [name, payload, opts] = transcodingQueue.add.mock.calls[0];
      expect(name).toBe('video.transcode');
      expect(payload).toEqual({ assetId });
      // Idempotency: jobId must equal assetId so retries are deduped.
      expect(opts.jobId).toBe(assetId);
      expect(opts.attempts).toBeGreaterThanOrEqual(2);
      expect(opts.backoff).toMatchObject({ type: 'exponential' });
    });

    it('does NOT enqueue a transcode job for non-VIDEO uploads', async () => {
      assets.findById.mockResolvedValue(
        buildAsset({ kind: 'PDF', contentType: 'application/pdf' }),
      );

      await mediaService.completeUpload(ownerId, assetId, {
        parts: [{ partNumber: 1, etag: 'aaa' }],
      });

      expect(transcodingQueue.add).not.toHaveBeenCalled();
    });

    it('completes the upload even if enqueueing the transcode job fails', async () => {
      assets.findById.mockResolvedValue(buildAsset({ kind: 'VIDEO' }));
      transcodingQueue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await mediaService.completeUpload(ownerId, assetId, {
        parts: [
          { partNumber: 1, etag: 'a' },
          { partNumber: 2, etag: 'b' },
          { partNumber: 3, etag: 'c' },
        ],
      });

      expect(result.status).toBe('UPLOADED');
      expect(transcodingQueue.add).toHaveBeenCalledTimes(1);
    });

    it('rejects cross-owner access with MEDIA_NOT_OWNER (Req 8.8 / 17.x)', async () => {
      assets.findById.mockResolvedValue(buildAsset({ ownerUserId: otherOwnerId }));

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [{ partNumber: 1, etag: 'x' }],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(r2.completeMultipartUpload).not.toHaveBeenCalled();
      expect(assets.transitionStatus).not.toHaveBeenCalled();
    });

    it('returns 404 MEDIA_NOT_FOUND when the asset does not exist', async () => {
      assets.findById.mockResolvedValue(null);

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [{ partNumber: 1, etag: 'x' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects duplicate partNumbers', async () => {
      assets.findById.mockResolvedValue(buildAsset());

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [
            { partNumber: 1, etag: 'a' },
            { partNumber: 1, etag: 'b' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(r2.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects partNumbers outside the planned range', async () => {
      assets.findById.mockResolvedValue(buildAsset());

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [
            { partNumber: 1, etag: 'a' },
            { partNumber: 99, etag: 'b' }, // plan was 3 parts
          ],
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MEDIA_PART_NUMBER_OUT_OF_RANGE',
        }),
      });
    });

    it('is idempotent: a second complete on an already-UPLOADED asset returns success', async () => {
      assets.findById.mockResolvedValue(buildAsset({ status: 'UPLOADED' }));

      const result = await mediaService.completeUpload(ownerId, assetId, {
        parts: [{ partNumber: 1, etag: 'a' }],
      });

      expect(result.status).toBe('UPLOADED');
      expect(r2.completeMultipartUpload).not.toHaveBeenCalled();
      expect(assets.transitionStatus).not.toHaveBeenCalled();
    });

    it('throws CONFLICT when the row is in FAILED status', async () => {
      assets.findById.mockResolvedValue(buildAsset({ status: 'FAILED' }));

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [{ partNumber: 1, etag: 'a' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws CONFLICT if the transition lost the race (concurrent abort)', async () => {
      assets.findById.mockResolvedValue(buildAsset());
      assets.transitionStatus.mockResolvedValue(0); // updateMany count = 0

      await expect(
        mediaService.completeUpload(ownerId, assetId, {
          parts: [{ partNumber: 1, etag: 'a' }],
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MEDIA_CONCURRENT_TRANSITION',
        }),
      });
    });
  });

  // ---------------------------------------------------------------
  // abortUpload (Req 8.6)
  // ---------------------------------------------------------------
  describe('abortUpload', () => {
    it('aborts the R2 upload and flips the row to FAILED (Req 8.6)', async () => {
      assets.findById.mockResolvedValue(buildAsset());

      const result = await mediaService.abortUpload(ownerId, assetId);

      expect(r2.abortMultipartUpload).toHaveBeenCalledWith(objectKey, uploadId);
      expect(assets.transitionStatus).toHaveBeenCalledWith(
        assetId,
        'UPLOADING',
        'FAILED',
      );
      expect(result.status).toBe('FAILED');
    });

    it('is idempotent for an already-FAILED asset', async () => {
      assets.findById.mockResolvedValue(buildAsset({ status: 'FAILED' }));

      const result = await mediaService.abortUpload(ownerId, assetId);

      expect(result.status).toBe('FAILED');
      expect(r2.abortMultipartUpload).not.toHaveBeenCalled();
      expect(assets.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects cross-owner abort with MEDIA_NOT_OWNER', async () => {
      assets.findById.mockResolvedValue(
        buildAsset({ ownerUserId: otherOwnerId }),
      );

      await expect(mediaService.abortUpload(ownerId, assetId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(r2.abortMultipartUpload).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // getPublicImageUrl (Task 5/6 — "Mening maktabim" cover photo proxy)
  // ---------------------------------------------------------------
  describe('getPublicImageUrl', () => {
    it('returns a freshly-signed URL for an UPLOADED image asset', async () => {
      assets.findById.mockResolvedValue(
        buildAsset({ kind: 'IMAGE', status: 'UPLOADED', originalKey: 'media/owner/image/cover.jpg' }),
      );
      r2.signObjectGet.mockResolvedValue('https://r2.example/signed?x=1');

      const url = await mediaService.getPublicImageUrl(assetId, 300);

      expect(url).toBe('https://r2.example/signed?x=1');
      expect(r2.signObjectGet).toHaveBeenCalledWith('media/owner/image/cover.jpg', 300);
    });

    it('accepts a READY image asset too', async () => {
      assets.findById.mockResolvedValue(buildAsset({ kind: 'IMAGE', status: 'READY' }));
      r2.signObjectGet.mockResolvedValue('https://r2.example/signed');

      await expect(mediaService.getPublicImageUrl(assetId, 300)).resolves.toBe(
        'https://r2.example/signed',
      );
    });

    it('throws NotFoundException when the asset does not exist', async () => {
      assets.findById.mockResolvedValue(null);

      await expect(mediaService.getPublicImageUrl(assetId, 300)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(r2.signObjectGet).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a non-IMAGE asset (never proxies video/doc/audio)', async () => {
      assets.findById.mockResolvedValue(buildAsset({ kind: 'VIDEO', status: 'READY' }));

      await expect(mediaService.getPublicImageUrl(assetId, 300)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(r2.signObjectGet).not.toHaveBeenCalled();
    });

    it('throws NotFoundException while the image is still uploading', async () => {
      assets.findById.mockResolvedValue(buildAsset({ kind: 'IMAGE', status: 'UPLOADING' }));

      await expect(mediaService.getPublicImageUrl(assetId, 300)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  describe('sanitizeFileName', () => {
    it('strips path separators and disallowed characters', () => {
      expect(mediaService.sanitizeFileName('../../etc/passwd')).toBe(
        'etc_passwd',
      );
      expect(mediaService.sanitizeFileName('weird name?.mp4')).toBe(
        'weird-name-.mp4',
      );
    });

    it('returns "file" for an effectively empty input', () => {
      expect(mediaService.sanitizeFileName('...')).toBe('file');
    });

    it('truncates long filenames to ≤ 100 chars', () => {
      const long = 'a'.repeat(500) + '.mp4';
      const result = mediaService.sanitizeFileName(long);
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });

  describe('buildObjectKey', () => {
    it('embeds owner id, lower-case kind, year/month and a uuid', () => {
      const fixed = new Date('2025-03-15T00:00:00Z');
      const key = mediaService.buildObjectKey(
        ownerId,
        'VIDEO',
        'lecture.mp4',
        fixed,
      );
      expect(key).toMatch(
        /^media\/[0-9a-f-]+\/video\/2025\/03\/[0-9a-f-]+-lecture\.mp4$/,
      );
    });
  });

  describe('computeOrphanCutoff', () => {
    it('subtracts the 24h TTL window from the input timestamp (Req 8.6)', () => {
      const now = new Date('2025-04-10T12:00:00Z');
      const cutoff = MediaService.computeOrphanCutoff(now);
      expect(cutoff.toISOString()).toBe('2025-04-09T12:00:00.000Z');
    });
  });
});
