import type { MediaAsset, Prisma } from '@prisma/client';

import { MediaAssetRepository } from './media-asset.repository';

/**
 * Unit tests for {@link MediaAssetRepository}.
 *
 * The repository is a thin Prisma wrapper, so the tests focus on:
 *  - The shape of arguments passed to Prisma (where clauses, status filters,
 *    metadata layout) — these are part of the public contract relied upon
 *    by the orphan-cleanup cron, MediaService, and the transcoding worker.
 *  - The atomic transition semantics of `transitionStatus` (concurrent
 *    complete + abort lost-update detection).
 *
 * Strategy: stub the `mediaAsset` delegate on a fake PrismaClient. We do
 * not exercise Prisma's runtime; that's covered by integration tests in
 * a real DB.
 */
describe('MediaAssetRepository', () => {
  let prisma: {
    mediaAsset: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let repo: MediaAssetRepository;

  const ASSET_ID = '11111111-1111-1111-1111-111111111111';
  const OWNER_ID = '22222222-2222-2222-2222-222222222222';

  const buildRow = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
    ({
      id: ASSET_ID,
      ownerUserId: OWNER_ID,
      kind: 'VIDEO',
      status: 'UPLOADING',
      bytes: BigInt(1024),
      contentType: 'video/mp4',
      originalKey: 'media/owner/video/2025/01/abc.mp4',
      hlsManifestKey: null,
      thumbnailKey: null,
      durationMs: null,
      metadata: {},
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides,
    }) as unknown as MediaAsset;

  beforeEach(() => {
    prisma = {
      mediaAsset: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    repo = new MediaAssetRepository(prisma as any);
  });

  // ----------------------------------------------------------------
  // Reads
  // ----------------------------------------------------------------

  describe('findById', () => {
    it('queries by primary key and returns the row', async () => {
      const row = buildRow();
      prisma.mediaAsset.findUnique.mockResolvedValue(row);

      const result = await repo.findById(ASSET_ID);

      expect(result).toBe(row);
      expect(prisma.mediaAsset.findUnique).toHaveBeenCalledWith({
        where: { id: ASSET_ID },
      });
    });

    it('returns null when the asset does not exist', async () => {
      prisma.mediaAsset.findUnique.mockResolvedValue(null);
      await expect(repo.findById(ASSET_ID)).resolves.toBeNull();
    });
  });

  describe('findByIdForOwner', () => {
    it('scopes the lookup to the owning user', async () => {
      const row = buildRow();
      prisma.mediaAsset.findFirst.mockResolvedValue(row);

      const result = await repo.findByIdForOwner(ASSET_ID, OWNER_ID);

      expect(result).toBe(row);
      expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
        where: { id: ASSET_ID, ownerUserId: OWNER_ID },
      });
    });

    it('returns null when the row exists but is owned by someone else', async () => {
      // Prisma returns null on a where-mismatch; the repo just propagates it.
      prisma.mediaAsset.findFirst.mockResolvedValue(null);
      await expect(
        repo.findByIdForOwner(ASSET_ID, 'different-owner'),
      ).resolves.toBeNull();
    });
  });

  describe('findStaleUploads', () => {
    it('queries for UPLOADING rows older than the cutoff, sorted oldest-first', async () => {
      const cutoff = new Date('2025-01-02T00:00:00Z');
      const rows = [buildRow({ id: 'a' } as any), buildRow({ id: 'b' } as any)];
      prisma.mediaAsset.findMany.mockResolvedValue(rows);

      const result = await repo.findStaleUploads(cutoff);

      expect(result).toBe(rows);
      expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith({
        where: {
          status: 'UPLOADING',
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    });

    it('returns an empty array when there are no stale uploads', async () => {
      prisma.mediaAsset.findMany.mockResolvedValue([]);
      const result = await repo.findStaleUploads(new Date());
      expect(result).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // Writes
  // ----------------------------------------------------------------

  describe('createUploading', () => {
    it('creates a row in UPLOADING status with multipart metadata under metadata.multipart', async () => {
      const created = buildRow();
      prisma.mediaAsset.create.mockResolvedValue(created);

      const result = await repo.createUploading({
        ownerUserId: OWNER_ID,
        kind: 'VIDEO',
        contentType: 'video/mp4',
        sizeBytes: 1024,
        originalKey: 'media/owner/video/2025/01/abc.mp4',
        uploadId: 'r2-upload-id',
        partsCount: 4,
        fileName: 'lecture.mp4',
      });

      expect(result).toBe(created);
      expect(prisma.mediaAsset.create).toHaveBeenCalledTimes(1);

      const args = prisma.mediaAsset.create.mock.calls[0][0];
      expect(args.data.ownerUserId).toBe(OWNER_ID);
      expect(args.data.kind).toBe('VIDEO');
      expect(args.data.status).toBe('UPLOADING');
      expect(args.data.contentType).toBe('video/mp4');
      expect(args.data.originalKey).toBe('media/owner/video/2025/01/abc.mp4');

      // sizeBytes must be marshalled to BigInt for the bytes column.
      expect(args.data.bytes).toBe(BigInt(1024));

      // Multipart bookkeeping is namespaced under metadata.multipart so it
      // doesn't collide with transcoder metadata written later.
      expect(args.data.metadata).toEqual({
        multipart: {
          uploadId: 'r2-upload-id',
          partsCount: 4,
          fileName: 'lecture.mp4',
        },
      });
    });

    it('preserves arbitrary file names verbatim (the service is responsible for sanitization)', async () => {
      prisma.mediaAsset.create.mockResolvedValue(buildRow());

      await repo.createUploading({
        ownerUserId: OWNER_ID,
        kind: 'PDF',
        contentType: 'application/pdf',
        sizeBytes: 64,
        originalKey: 'media/owner/pdf/2025/01/file.pdf',
        uploadId: 'u',
        partsCount: 1,
        fileName: 'A book — chapter 1 (final).pdf',
      });

      const args = prisma.mediaAsset.create.mock.calls[0][0];
      const meta = args.data.metadata as { multipart: { fileName: string } };
      expect(meta.multipart.fileName).toBe('A book — chapter 1 (final).pdf');
    });
  });

  describe('transitionStatus', () => {
    it('issues a conditional updateMany filtered by id+from and returns the affected count', async () => {
      prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });

      const count = await repo.transitionStatus(
        ASSET_ID,
        'UPLOADING',
        'UPLOADED',
      );

      expect(count).toBe(1);
      expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: ASSET_ID, status: 'UPLOADING' },
        data: { status: 'UPLOADED' },
      });
    });

    it('returns 0 when no row matches (lost-update race detection)', async () => {
      // updateMany returns count: 0 when the from-status no longer matches —
      // this is the signal the service uses to throw 409 Conflict.
      prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });

      const count = await repo.transitionStatus(
        ASSET_ID,
        'UPLOADING',
        'UPLOADED',
      );

      expect(count).toBe(0);
    });

    it('forwards extraData fields alongside the status change', async () => {
      prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });

      const extra: Prisma.MediaAssetUpdateInput = {
        hlsManifestKey: 'media/owner/hls/abc/master.m3u8',
        durationMs: 60_000,
      };
      await repo.transitionStatus(
        ASSET_ID,
        'UPLOADED',
        'READY',
        extra,
      );

      const args = prisma.mediaAsset.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ id: ASSET_ID, status: 'UPLOADED' });
      expect(args.data).toEqual({
        hlsManifestKey: 'media/owner/hls/abc/master.m3u8',
        durationMs: 60_000,
        status: 'READY',
      });
    });

    it('extraData cannot override the target status — to wins over from', async () => {
      prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });

      // Even if a caller bug includes a stale `status` in extraData, the
      // explicit `to` argument is applied last and wins.
      await repo.transitionStatus(
        ASSET_ID,
        'UPLOADING',
        'FAILED',
        { status: 'READY' } as any,
      );

      const args = prisma.mediaAsset.updateMany.mock.calls[0][0];
      expect(args.data.status).toBe('FAILED');
    });
  });

  describe('updateMetadata', () => {
    it('overwrites the metadata column for the given asset', async () => {
      prisma.mediaAsset.update.mockResolvedValue(buildRow());

      const meta: Prisma.JsonObject = {
        completion: { etag: '"abc"', completedAt: '2025-01-01T00:00:00Z' },
      };
      await repo.updateMetadata(ASSET_ID, meta);

      expect(prisma.mediaAsset.update).toHaveBeenCalledWith({
        where: { id: ASSET_ID },
        data: { metadata: meta },
      });
    });

    it('does not return the updated row to callers (fire-and-forget contract)', async () => {
      prisma.mediaAsset.update.mockResolvedValue(buildRow());
      const result = await repo.updateMetadata(ASSET_ID, {});
      expect(result).toBeUndefined();
    });
  });
});
