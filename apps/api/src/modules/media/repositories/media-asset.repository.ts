import { Injectable } from '@nestjs/common';
import {
  AssetStatus,
  MediaAsset,
  MediaKind,
  Prisma,
  PrismaClient,
} from '@prisma/client';

/**
 * MediaAssetRepository — Prisma-based CRUD for the `MediaAsset` table.
 *
 * The MediaAsset row is created in `UPLOADING` status when a multipart
 * upload is initiated and transitioned to `UPLOADED` on `complete`. The
 * orphan-cleanup cron later flips long-stuck UPLOADING rows to FAILED.
 *
 * Multipart upload state (`uploadId`, `partsCount`) is persisted inside the
 * `metadata` JSON column — there is no dedicated column on the model, so
 * we keep the structure under the namespaced `multipart` key to avoid
 * colliding with transcoder metadata written later.
 */
@Injectable()
export class MediaAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async findById(id: string): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findUnique({ where: { id } });
  }

  async findByIdForOwner(
    id: string,
    ownerUserId: string,
  ): Promise<MediaAsset | null> {
    return this.prisma.mediaAsset.findFirst({
      where: { id, ownerUserId },
    });
  }

  /** All UPLOADING rows that have been stuck longer than `cutoff`. */
  async findStaleUploads(
    cutoff: Date,
    opts: { take?: number } = {},
  ): Promise<MediaAsset[]> {
    // Pagination cap (Task 24.2): the cleanup cron processes one
    // batch per tick — capping at 100 keeps each tick bounded and
    // avoids R2 rate-limit issues during a backfill.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    return this.prisma.mediaAsset.findMany({
      where: {
        status: 'UPLOADING',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  // ------------------------------------------------------------------
  // Writes
  // ------------------------------------------------------------------

  /**
   * Create an UPLOADING MediaAsset for `ownerUserId`. The R2 `uploadId`,
   * planned part count and the resolved object key are stashed in
   * `metadata.multipart` so `complete`/`abort` can reuse them without
   * re-querying R2.
   */
  async createUploading(input: {
    ownerUserId: string;
    kind: MediaKind;
    contentType: string;
    sizeBytes: number;
    originalKey: string;
    uploadId: string;
    partsCount: number;
    fileName: string;
  }): Promise<MediaAsset> {
    const metadata: Prisma.JsonObject = {
      multipart: {
        uploadId: input.uploadId,
        partsCount: input.partsCount,
        fileName: input.fileName,
      },
    };

    return this.prisma.mediaAsset.create({
      data: {
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        status: 'UPLOADING',
        bytes: BigInt(input.sizeBytes),
        contentType: input.contentType,
        originalKey: input.originalKey,
        metadata,
      },
    });
  }

  /**
   * Atomically transition a MediaAsset from `from` to `to`. Returns the
   * count of affected rows so the service layer can detect lost-update
   * races (concurrent complete + abort) and respond with 409.
   */
  async transitionStatus(
    id: string,
    from: AssetStatus,
    to: AssetStatus,
    extraData: Prisma.MediaAssetUpdateInput = {},
  ): Promise<number> {
    const result = await this.prisma.mediaAsset.updateMany({
      where: { id, status: from },
      data: { ...extraData, status: to },
    });
    return result.count;
  }

  /** Update arbitrary metadata — e.g. recording the completion ETag. */
  async updateMetadata(
    id: string,
    metadata: Prisma.JsonObject,
  ): Promise<void> {
    await this.prisma.mediaAsset.update({
      where: { id },
      data: { metadata },
    });
  }
}
