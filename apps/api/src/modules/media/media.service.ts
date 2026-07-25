import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { MediaAsset, MediaKind, Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';

import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { TokensService } from '../auth/tokens.service';
import {
  R2Service,
  R2_DEFAULT_PART_URL_TTL_SECONDS,
  R2_MAX_SIGNED_URL_TTL_SECONDS,
  type SignedPartUrl,
} from '../../infra/r2/r2.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import {
  ALLOWED_MIME_BY_KIND,
  HLS_VARIANT_PLAYLIST_FILENAME,
  HLS_VARIANTS,
  MEDIA_DEFAULT_PART_SIZE_BYTES,
  MEDIA_MAX_SIZE_BYTES,
  MEDIA_UPLOAD_ORPHAN_TTL_HOURS,
  VIDEO_TRANSCODE_BACKOFF_DELAY_MS,
  VIDEO_TRANSCODE_JOB_NAME,
  VIDEO_TRANSCODE_MAX_ATTEMPTS,
  deriveHlsVariantKey,
  type MediaKindLiteral,
} from './media.types';
import { MediaAccessService, type MediaAccessActor } from './media-access.service';
import { MediaAssetRepository } from './repositories/media-asset.repository';

export interface UploadInitiated {
  assetId: string;
  uploadId: string;
  key: string;
  partUrls: SignedPartUrl[];
  expiresInSeconds: number;
  partSizeBytes: number;
}

export interface UploadCompleted {
  assetId: string;
  status: 'UPLOADED';
  key: string;
  url: string;
}

export interface UploadAborted {
  assetId: string;
  status: 'FAILED';
}

/**
 * Default TTL applied to playback signed URLs when the caller does not
 * specify one. Three hours gives long live-watching sessions room to
 * breathe without forcing a refresh, while staying well below the 6h
 * hard cap from Req 21.6.
 */
export const MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS = 3 * 60 * 60;

/**
 * One signed URL entry returned in a playback response — either the
 * master HLS manifest (`role: 'manifest'`), a per-variant playlist
 * (`role: 'variant'`), or the original asset key for non-HLS media
 * (`role: 'original'`).
 */
export interface PlaybackUrl {
  /** What this URL points at — drives how the player consumes it. */
  role: 'manifest' | 'variant' | 'original';
  /** R2 object key that was signed. Useful for diagnostics. */
  key: string;
  /** Presigned GET URL with TTL ≤ 6h (Req 21.6). */
  url: string;
  /** Variant label (`240p`, `480p`, …) when role === 'variant'. */
  variant?: string;
}

/**
 * Response body of `GET /media/assets/:id/url`.
 *
 *  - For HLS-ready video (`hlsManifestKey` set) the response includes
 *    the master manifest URL plus signed URLs for every variant
 *    playlist. The player can stitch them itself.
 *  - For everything else (PDF, image, raw video while transcoding) we
 *    sign the original key.
 *  - `expiresAt` matches the TTL we applied when signing.
 */
export interface MediaPlaybackResponse {
  assetId: string;
  kind: MediaKindLiteral;
  status: string;
  /** Best URL for a generic player to start with. */
  url: string;
  /** When `kind=VIDEO` and the asset is READY this is `manifest`. */
  type: 'manifest' | 'variant' | 'original';
  /** All signed URLs — manifest + variants (HLS) or just the original. */
  urls: PlaybackUrl[];
  expiresInSeconds: number;
  expiresAt: string;
}

interface MultipartMetadata {
  uploadId: string;
  partsCount: number;
  fileName?: string;
}

/**
 * MediaService — owns the upload lifecycle for `MediaAsset`.
 *
 * Lifecycle (Req 8.1, 8.2, 8.6, 8.7):
 *
 *  1. `initiateUpload`  — UPLOADING row + R2 CreateMultipartUpload + signed
 *                         per-part PUT URLs.
 *  2. `completeUpload`  — verify part numbers, R2 CompleteMultipartUpload,
 *                         transition to UPLOADED.
 *  3. `abortUpload`     — R2 AbortMultipartUpload + transition to FAILED.
 *  4. cleanup cron      — `findStaleUploads(now-24h)` → abort + FAILED
 *                         (driven by `MediaCleanupTask`).
 *
 * Authorization is enforced strictly per-owner: only the user that
 * initiated the upload may complete or abort it. Cross-owner access is
 * rejected with `MEDIA_NOT_OWNER` (403).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly r2: R2Service,
    private readonly assets: MediaAssetRepository,
    private readonly access: MediaAccessService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.TRANSCODING)
    private readonly transcodingQueue: Queue,
  ) {}

  // ------------------------------------------------------------------
  // Initiate (Req 8.1)
  // ------------------------------------------------------------------

  /**
   * Begin a multipart upload owned by `ownerUserId`.
   *
   * Server-side validation (defense in depth — the DTO already enforces
   * ranges, but the service re-checks):
   *  - `contentType` must appear in `ALLOWED_MIME_BY_KIND[kind]` (Req 8.7)
   *  - `sizeBytes ≤ 5 GiB`
   *  - `partsCount` consistent with `sizeBytes` (≤ ceil(size / 5 MiB) +1
   *    so the client cannot request 10k empty signed URLs).
   */
  async initiateUpload(
    ownerUserId: string,
    dto: InitUploadDto,
  ): Promise<UploadInitiated> {
    this.assertContentTypeAllowed(dto.kind, dto.contentType);
    this.assertPartsCountSane(dto.sizeBytes, dto.partsCount);

    const sanitizedFileName = this.sanitizeFileName(dto.fileName);
    const key = this.buildObjectKey(ownerUserId, dto.kind, sanitizedFileName);

    const uploadId = await this.r2.createMultipartUpload(key, dto.contentType);
    let asset: MediaAsset;
    try {
      asset = await this.assets.createUploading({
        ownerUserId,
        kind: dto.kind as MediaKind,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        originalKey: key,
        uploadId,
        partsCount: dto.partsCount,
        fileName: sanitizedFileName,
      });
    } catch (error) {
      // If we cannot persist the row, the multipart upload would be
      // unreachable. Best-effort cleanup so R2 doesn't accrue orphans.
      this.logger.warn(
        `Failed to persist MediaAsset for upload ${uploadId}; aborting at R2`,
      );
      await this.r2.abortMultipartUpload(key, uploadId).catch((abortErr) => {
        this.logger.error(
          `Cleanup AbortMultipartUpload failed for ${key} (${uploadId}): ${(abortErr as Error).message}`,
        );
      });
      throw error;
    }

    const partUrls = await this.r2.signUploadPartBatch(
      key,
      uploadId,
      dto.partsCount,
      R2_DEFAULT_PART_URL_TTL_SECONDS,
    );

    return {
      assetId: asset.id,
      uploadId,
      key,
      partUrls,
      expiresInSeconds: R2_DEFAULT_PART_URL_TTL_SECONDS,
      partSizeBytes: MEDIA_DEFAULT_PART_SIZE_BYTES,
    };
  }

  // ------------------------------------------------------------------
  // Complete (Req 8.2)
  // ------------------------------------------------------------------

  /**
   * Finalize the multipart upload and transition the row UPLOADING →
   * UPLOADED. Idempotent: if the asset is already UPLOADED with the same
   * key the call returns the existing row instead of failing — this
   * matches retry semantics on the client side.
   */
  async completeUpload(
    ownerUserId: string,
    assetId: string,
    dto: CompleteUploadDto,
  ): Promise<UploadCompleted> {
    const asset = await this.requireOwnedAsset(ownerUserId, assetId);

    if (asset.status === 'UPLOADED' || asset.status === 'TRANSCODING' ||
        asset.status === 'READY') {
      // Already finalized — return the same response so client retries
      // converge instead of throwing.
      const url = await this.r2.signObjectGet(asset.originalKey ?? '', MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS);
      return {
        assetId: asset.id,
        status: 'UPLOADED',
        key: asset.originalKey ?? '',
        url,
      };
    }
    if (asset.status !== 'UPLOADING') {
      throw new ConflictException({
        code: 'MEDIA_INVALID_STATUS',
        message: `Cannot complete upload from status ${asset.status}`,
      });
    }

    const meta = this.requireMultipartMetadata(asset);
    if (!asset.originalKey) {
      throw new ConflictException({
        code: 'MEDIA_KEY_MISSING',
        message: 'MediaAsset has no R2 object key',
      });
    }

    // Validate that part numbers are within the planned range and unique.
    this.assertPartsMatchPlan(dto, meta.partsCount);

    const result = await this.r2.completeMultipartUpload(
      asset.originalKey,
      meta.uploadId,
      dto.parts,
    );

    // Reconcile the declared size against reality. `sizeBytes` from
    // `initiateUpload` is caller-supplied and the presigned part URLs
    // place no limit on the body, so until now a client could declare
    // 1 MB and store 5 GB — the platform cap was advisory only, and the
    // `bytes` column (used for quota and billing views) was whatever the
    // client said. Over the hard cap the asset is failed rather than
    // published; the orphan-cleanup cron reclaims the R2 object.
    const actualBytes = await this.r2.getObjectSize(asset.originalKey);
    if (actualBytes !== null && actualBytes > MEDIA_MAX_SIZE_BYTES) {
      await this.assets.transitionStatus(asset.id, 'UPLOADING', 'FAILED', {
        bytes: BigInt(actualBytes),
      });
      throw new BadRequestException({
        code: 'MEDIA_SIZE_EXCEEDED',
        message: `Uploaded object is ${actualBytes} bytes, above the ${MEDIA_MAX_SIZE_BYTES} byte cap`,
      });
    }

    // Persist completion metadata + status flip.
    const updated = await this.assets.transitionStatus(
      asset.id,
      'UPLOADING',
      'UPLOADED',
      {
        // Record the measured size, not the declared one.
        ...(actualBytes !== null ? { bytes: BigInt(actualBytes) } : {}),
        metadata: {
          ...(this.coerceJsonObject(asset.metadata) ?? {}),
          multipart: {
            ...meta,
            completedAt: new Date().toISOString(),
            etag: result.etag ?? null,
            declaredBytes: asset.bytes ? Number(asset.bytes) : null,
            actualBytes,
          },
        },
      },
    );

    if (updated === 0) {
      // Concurrent abort happened first.
      throw new ConflictException({
        code: 'MEDIA_CONCURRENT_TRANSITION',
        message: 'Upload was aborted concurrently',
      });
    }

    // Req 8.3: VIDEO uploads kick off the BullMQ transcoding pipeline as
    // soon as the multipart finalization succeeds. Failure to enqueue is
    // not fatal — the worker / orphan cron will pick the asset up again.
    if (asset.kind === 'VIDEO') {
      await this.enqueueTranscodingJob(asset.id);
    }

    const url = await this.r2.signObjectGet(asset.originalKey, MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS);
    return { assetId: asset.id, status: 'UPLOADED', key: asset.originalKey, url };
  }

  /**
   * Enqueue a BullMQ `video.transcode` job for an UPLOADED VIDEO asset
   * (Req 8.3). Idempotent: BullMQ dedupes on `jobId = assetId`, so a
   * retry of `completeUpload` (or the cleanup cron) will not double-
   * schedule the work.
   */
  private async enqueueTranscodingJob(assetId: string): Promise<void> {
    try {
      await this.transcodingQueue.add(
        VIDEO_TRANSCODE_JOB_NAME,
        { assetId },
        {
          jobId: assetId,
          attempts: VIDEO_TRANSCODE_MAX_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: VIDEO_TRANSCODE_BACKOFF_DELAY_MS,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
      this.logger.log(
        `Enqueued video.transcode job for asset ${assetId}`,
      );
    } catch (error) {
      // Don't fail the upload because the queue is unhappy — the asset
      // is already UPLOADED and the worker / cleanup task can retry.
      this.logger.error(
        `Failed to enqueue video.transcode for asset ${assetId}: ${(error as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Abort (Req 8.6)
  // ------------------------------------------------------------------

  /**
   * Cancel an in-flight upload. Idempotent — calling abort on a row that
   * has already been transitioned to FAILED is a no-op.
   */
  async abortUpload(
    ownerUserId: string,
    assetId: string,
  ): Promise<UploadAborted> {
    const asset = await this.requireOwnedAsset(ownerUserId, assetId);

    if (asset.status === 'FAILED') {
      return { assetId: asset.id, status: 'FAILED' };
    }
    if (asset.status !== 'UPLOADING') {
      throw new ConflictException({
        code: 'MEDIA_INVALID_STATUS',
        message: `Cannot abort upload in status ${asset.status}`,
      });
    }

    const meta = this.requireMultipartMetadata(asset);
    if (asset.originalKey) {
      await this.r2.abortMultipartUpload(asset.originalKey, meta.uploadId);
    }

    const flipped = await this.assets.transitionStatus(
      asset.id,
      'UPLOADING',
      'FAILED',
    );
    if (flipped === 0) {
      // Race with a concurrent complete — we already aborted the R2
      // upload, but the row is no longer UPLOADING. Treat as idempotent.
      this.logger.warn(
        `MediaAsset ${asset.id}: status changed concurrently during abort`,
      );
    }

    return { assetId: asset.id, status: 'FAILED' };
  }

  // ------------------------------------------------------------------
  // Read (used by GET /media/assets/:id once that endpoint lands)
  // ------------------------------------------------------------------

  async getAssetForOwner(
    ownerUserId: string,
    assetId: string,
  ): Promise<MediaAsset> {
    return this.requireOwnedAsset(ownerUserId, assetId);
  }

  /**
   * Get metadata for a MediaAsset.
   */
  async getAssetMetadata(userId: string, assetId: string) {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }

    // Check if the user has access to read this asset.
    await this.access.assertCanRead({ sub: userId, role: '' }, asset);

    const meta = this.coerceJsonObject(asset.metadata);
    const multipart = meta?.multipart as Record<string, any> | undefined;
    const fileName = multipart?.fileName || asset.originalKey?.split('/').pop() || 'file';

    return {
      id: asset.id,
      kind: asset.kind,
      fileName,
      sizeBytes: asset.bytes ? Number(asset.bytes) : 0,
      contentType: asset.contentType,
      status: asset.status,
    };
  }

  /**
   * Resolve a fresh signed GET URL for a PUBLIC, unauthenticated image
   * proxy (`GET /media/public/:id`, Task 5/6 — "Mening maktabim" cover
   * photos).
   *
   * This is the only media read path that skips
   * `MediaAccessService.assertCanRead`, so what counts as "public" has to
   * be positively established, not assumed. Two conditions, both required:
   *
   *   1. `kind === 'IMAGE'` — paid video/document content always stays
   *      behind the authenticated `/media/assets/:id/url` path.
   *   2. The asset is **actually referenced by a public-facing field**
   *      (`TeacherProfile.coverUrl` / `Course.coverUrl`).
   *
   * Condition 2 is the important one. Narrowing to `kind === 'IMAGE'` and
   * relying on the asset id being an unguessable UUID published *every*
   * image in the database at a stable URL — including student homework
   * photo submissions and DM attachments — to anyone who ever saw the id.
   * Asset ids are not secrets: they are returned by ordinary API
   * responses, and they leak through logs and `Referer` headers.
   *
   * `TeacherProfile.coverUrl` stores the STABLE proxy URL
   * (`{API_URL}/api/v1/media/public/{assetId}`), never the signed URL
   * itself — the signed URL is re-issued on every request here, so the
   * stored value never expires even though each underlying signature does.
   * Matching on the id substring is therefore exactly the "is this asset
   * published?" question, and it works retroactively for covers that were
   * already saved.
   */
  async getPublicImageUrl(assetId: string, expiresInSeconds: number): Promise<string> {
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.kind !== 'IMAGE' || !asset.originalKey) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Image not found.',
      });
    }
    if (asset.status !== 'UPLOADED' && asset.status !== 'READY') {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Image not found.',
      });
    }
    if (!(await this.isPubliclyReferenced(assetId))) {
      // Same 404 as "no such asset" — a distinct error would confirm that
      // a private image with this id exists.
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Image not found.',
      });
    }
    return this.r2.signObjectGet(asset.originalKey, expiresInSeconds);
  }

  /**
   * `true` when `assetId` is referenced by a field that is itself served
   * to unauthenticated visitors. See `getPublicImageUrl` for why this
   * gate exists.
   */
  private async isPubliclyReferenced(assetId: string): Promise<boolean> {
    const [teacherCover, courseCover] = await Promise.all([
      this.prisma.teacherProfile.findFirst({
        where: { coverUrl: { contains: assetId } },
        select: { userId: true },
      }),
      this.prisma.course.findFirst({
        where: { coverUrl: { contains: assetId } },
        select: { id: true },
      }),
    ]);
    return Boolean(teacherCover ?? courseCover);
  }

  // ------------------------------------------------------------------
  // Playback (Req 8.3, 8.7, 8.8, 21.6)
  // ------------------------------------------------------------------

  /**
   * Resolve a presigned playback URL for a `MediaAsset`.
   *
   * Authorization (Req 8.8): delegated to `MediaAccessService` —
   * owner OR admin OR teacher of a referencing lesson OR student with
   * an APPROVED enrollment in any group whose lesson references the
   * asset (mirrors the `LessonAccessGuard` rules from Req 6.1 – 6.6).
   *
   * Output shape:
   *  - VIDEO + `hlsManifestKey` set → master manifest URL + one signed
   *    URL per HLS variant playlist (Req 8.3, 8.4). The player consumes
   *    them as `#EXT-X-STREAM-INF` rewrites or by fetching variants on
   *    demand.
   *  - VIDEO without `hlsManifestKey` (still UPLOADED / TRANSCODING) →
   *    the original key (so the teacher can preview their upload).
   *  - Everything else (PDF, image, doc, audio) → original key.
   *
   * TTL is clamped at the R2 layer to ≤ 6h per Req 21.6. Callers may
   * pass a shorter TTL (e.g. for tightly scoped downloads). The default
   * is 3h, which fits a typical lesson watch session.
   */
  async getPlaybackUrls(
    actor: MediaAccessActor,
    assetId: string,
    expiresInSeconds: number = MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
  ): Promise<MediaPlaybackResponse> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }

    // Req 21.6: enforce the 6h cap at the service layer too. R2Service
    // also clamps internally, but echoing the actual TTL back to the
    // caller without lying is part of the contract.
    const ttl = Math.min(
      Math.max(60, Math.floor(expiresInSeconds)),
      R2_MAX_SIGNED_URL_TTL_SECONDS,
    );

    // Authorization (Req 8.8 / 21.6).
    await this.access.assertCanRead(actor, asset);

    // Only finalized assets are playable. A video can still use its
    // original MP4/WebM when optional HLS transcoding fails; the source
    // upload is already complete and remains valid in object storage.
    if (asset.status === 'UPLOADING') {
      throw new ConflictException({
        code: 'MEDIA_NOT_READY',
        message: 'Media asset is still uploading',
      });
    }
    const canUseOriginalVideo =
      asset.status === 'FAILED' &&
      asset.kind === 'VIDEO' &&
      Boolean(asset.originalKey);
    if (asset.status === 'FAILED' && !canUseOriginalVideo) {
      throw new ConflictException({
        code: 'MEDIA_FAILED',
        message: 'Media asset upload failed',
      });
    }

    const expiresAtIso = new Date(Date.now() + ttl * 1000).toISOString();

    // HLS path: VIDEO + manifest key present → stream through our own
    // proxy (see MediaStreamController), never raw presigned R2 URLs.
    //
    // Presigned R2 GET URLs put the signature in the query string. HLS
    // playback is inherently multi-hop — master.m3u8 references variant
    // playlists, each variant playlist references .ts segments — and every
    // hop is resolved by the *player* (browser/hls.js) as a relative URL
    // against the current one. Per RFC 3986 relative-reference resolution,
    // resolving a relative path against a URL drops that URL's query
    // string entirely, so a presigned master URL's signature never survives
    // to the variant/segment requests → R2 answers those with 403 and the
    // player is stuck black at 0:00. (Confirmed by hand against MinIO.)
    //
    // Fix: mint one short-lived token for this asset and hand back proxy
    // URLs on our own API. `MediaStreamController` streams each hop and
    // rewrites the relative references inside every .m3u8 it serves to
    // point back at itself with the same token — so the token (in the
    // query string of an absolute, self-referencing URL we control) rides
    // along on every hop instead of getting silently dropped.
    if (asset.kind === 'VIDEO' && asset.hlsManifestKey) {
      const manifestKey = asset.hlsManifestKey;
      const streamToken = await this.tokens.generateMediaStreamToken(asset.id, ttl);
      const proxyBase = `${this.getApiBaseUrl()}/api/v1/media/stream/${asset.id}/hls`;
      const manifestUrl = `${proxyBase}/master.m3u8?token=${encodeURIComponent(streamToken)}`;

      const urls: PlaybackUrl[] = [
        { role: 'manifest', key: manifestKey, url: manifestUrl },
        ...HLS_VARIANTS.map<PlaybackUrl>((variant) => ({
          role: 'variant',
          key: deriveHlsVariantKey(manifestKey, variant.name),
          url: `${proxyBase}/${variant.name}/playlist.m3u8?token=${encodeURIComponent(streamToken)}`,
          variant: variant.name,
        })),
      ];

      return {
        assetId: asset.id,
        kind: asset.kind as MediaKindLiteral,
        status: asset.status,
        url: manifestUrl,
        type: 'manifest',
        urls,
        expiresInSeconds: ttl,
        expiresAt: expiresAtIso,
      };
    }

    // Fallback: sign the original object key.
    if (!asset.originalKey) {
      throw new ConflictException({
        code: 'MEDIA_KEY_MISSING',
        message: 'MediaAsset has no R2 object key to sign',
      });
    }
    const url = await this.r2.signObjectGet(asset.originalKey, ttl);
    return {
      assetId: asset.id,
      kind: asset.kind as MediaKindLiteral,
      status: asset.status,
      url,
      type: 'original',
      urls: [{ role: 'original', key: asset.originalKey, url }],
      expiresInSeconds: ttl,
      expiresAt: expiresAtIso,
    };
  }

  // ------------------------------------------------------------------
  // HLS streaming proxy (consumed by MediaStreamController)
  // ------------------------------------------------------------------

  /**
   * Serve the master `.m3u8` for `GET /media/stream/:id/hls/master.m3u8`.
   * Every relative reference line (`240p/playlist.m3u8`, …) is rewritten to
   * an absolute proxy URL carrying the same stream token, so the browser's
   * next request comes back through this same authorized path instead of
   * an unsigned direct-to-R2 request (see the long comment in
   * `getPlaybackUrls` for why that's necessary).
   */
  async getHlsMasterManifest(
    assetId: string,
    token: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const manifestKey = await this.verifyStreamTokenAndLoadManifestKey(assetId, token);
    const raw = await this.r2.getObjectBuffer(manifestKey);
    const proxyBase = `${this.getApiBaseUrl()}/api/v1/media/stream/${assetId}/hls`;
    const rewritten = this.rewriteM3u8(
      raw.toString('utf-8'),
      (line) => `${proxyBase}/${line}?token=${encodeURIComponent(token)}`,
    );
    return {
      body: Buffer.from(rewritten, 'utf-8'),
      contentType: 'application/vnd.apple.mpegurl',
    };
  }

  /**
   * Serve a per-variant resource for
   * `GET /media/stream/:id/hls/:variant/:file` — either the variant's own
   * `playlist.m3u8` (rewritten the same way as the master) or one of its
   * `.ts` segments (streamed byte-for-byte). `variant` and `file` are
   * whitelisted against `HLS_VARIANTS` / a strict segment-name pattern so
   * this can never be used to read an arbitrary R2 key.
   */
  async getHlsVariantResource(
    assetId: string,
    variant: string,
    file: string,
    token: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const manifestKey = await this.verifyStreamTokenAndLoadManifestKey(assetId, token);

    if (!HLS_VARIANTS.some((v) => v.name === variant)) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Unknown HLS variant',
      });
    }
    const isPlaylist = file === HLS_VARIANT_PLAYLIST_FILENAME;
    const isSegment = /^seg_\d+\.ts$/.test(file);
    if (!isPlaylist && !isSegment) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Unknown HLS resource',
      });
    }

    const lastSlash = manifestKey.lastIndexOf('/');
    const dir = lastSlash >= 0 ? manifestKey.slice(0, lastSlash) : '';
    const targetKey = `${dir ? `${dir}/` : ''}${variant}/${file}`;
    const raw = await this.r2.getObjectBuffer(targetKey);

    if (isPlaylist) {
      const proxyBase = `${this.getApiBaseUrl()}/api/v1/media/stream/${assetId}/hls/${variant}`;
      const rewritten = this.rewriteM3u8(
        raw.toString('utf-8'),
        (line) => `${proxyBase}/${line}?token=${encodeURIComponent(token)}`,
      );
      return {
        body: Buffer.from(rewritten, 'utf-8'),
        contentType: 'application/vnd.apple.mpegurl',
      };
    }

    return { body: raw, contentType: 'video/mp2t' };
  }

  /**
   * Verify a media-stream token and confirm it matches an HLS-ready VIDEO
   * asset. This is the entire authorization boundary for the (deliberately
   * `@Public()`) `MediaStreamController` routes — no JWT/session auth is
   * checked again here since the token was only ever handed out by
   * `getPlaybackUrls`, which already ran `MediaAccessService.assertCanRead`.
   */
  private async verifyStreamTokenAndLoadManifestKey(
    assetId: string,
    token: string,
  ): Promise<string> {
    if (!token) {
      throw new ForbiddenException({
        code: 'MEDIA_STREAM_TOKEN_MISSING',
        message: 'Missing stream token',
      });
    }
    let payload: { sub: string };
    try {
      payload = await this.tokens.verifyMediaStreamToken(token);
    } catch {
      throw new ForbiddenException({
        code: 'MEDIA_STREAM_TOKEN_INVALID',
        message: 'Invalid or expired stream token',
      });
    }
    if (payload.sub !== assetId) {
      throw new ForbiddenException({
        code: 'MEDIA_STREAM_TOKEN_INVALID',
        message: 'Stream token does not match this asset',
      });
    }
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.kind !== 'VIDEO' || !asset.hlsManifestKey) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }
    return asset.hlsManifestKey;
  }

  /** Rewrite every non-comment, non-blank line of an `.m3u8` playlist. */
  private rewriteM3u8(text: string, rewriteLine: (line: string) => string): string {
    return text
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) return line;
        return rewriteLine(trimmed);
      })
      .join('\n');
  }

  /** Public origin of this API — used to build self-referencing proxy URLs. */
  private getApiBaseUrl(): string {
    const url = this.config.get<string>('API_URL') ?? 'http://localhost:4000';
    return url.replace(/\/+$/, '');
  }

  // ------------------------------------------------------------------
  // Helpers (exported for unit-testing)
  // ------------------------------------------------------------------

  /**
   * Sanitize a user-supplied filename so it is safe to embed in an R2
   * object key. Strips path separators, collapses whitespace, and limits
   * length. We never trust the original — only its sanitized form.
   */
  sanitizeFileName(fileName: string): string {
    const base = fileName
      .normalize('NFKC')
      .replace(/[\\/]+/g, '_') // path separators
      .replace(/[^A-Za-z0-9._-]+/g, '-') // anything weird
      .replace(/^[._-]+/, '') // leading dots / hyphens
      .slice(0, 100);
    return base.length > 0 ? base : 'file';
  }

  /**
   * Build a deterministic R2 object key. Format:
   *   `media/{ownerId}/{kindLower}/{yyyy}/{mm}/{uuid}-{fileName}`
   *
   * - Keying by user makes per-owner cleanup straightforward.
   * - Year/month prefix keeps directory listings small.
   * - The uuid prevents collisions between teachers sharing the same name.
   */
  buildObjectKey(
    ownerUserId: string,
    kind: MediaKindLiteral,
    sanitizedFileName: string,
    now: Date = new Date(),
  ): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const id = randomUUID();
    return `media/${ownerUserId}/${kind.toLowerCase()}/${year}/${month}/${id}-${sanitizedFileName}`;
  }

  /**
   * Cap the planned part count against the file size. We allow the client
   * to overshoot by one part to handle tail-rounding, but nothing absurd.
   */
  private assertPartsCountSane(sizeBytes: number, partsCount: number): void {
    if (sizeBytes > MEDIA_MAX_SIZE_BYTES) {
      throw new BadRequestException({
        code: 'MEDIA_FILE_TOO_LARGE',
        message: `File exceeds the ${MEDIA_MAX_SIZE_BYTES}-byte cap`,
      });
    }

    // R2 minimum part size is 5 MiB (except the final part). To prevent
    // clients from requesting an unreasonable number of small signed URLs
    // we require partsCount ≤ ceil(size / 5MiB) + 1.
    const minPartSize = 5 * 1024 * 1024;
    const maxParts = Math.ceil(sizeBytes / minPartSize) + 1;
    if (partsCount > maxParts) {
      throw new BadRequestException({
        code: 'MEDIA_PARTS_COUNT_INVALID',
        message: `partsCount ${partsCount} exceeds the maximum of ${maxParts} for ${sizeBytes} bytes`,
      });
    }
  }

  private assertContentTypeAllowed(
    kind: MediaKindLiteral,
    contentType: string,
  ): void {
    const allowed = ALLOWED_MIME_BY_KIND[kind];
    if (!allowed || allowed.length === 0) {
      throw new BadRequestException({
        code: 'MEDIA_KIND_NOT_UPLOADABLE',
        message: `Kind ${kind} cannot be uploaded directly`,
      });
    }
    if (!allowed.includes(contentType)) {
      throw new BadRequestException({
        code: 'MEDIA_CONTENT_TYPE_NOT_ALLOWED',
        message: `${contentType} is not allowed for kind ${kind}`,
      });
    }
  }

  private assertPartsMatchPlan(
    dto: CompleteUploadDto,
    plannedPartsCount: number,
  ): void {
    if (dto.parts.length > plannedPartsCount) {
      throw new BadRequestException({
        code: 'MEDIA_PARTS_OVERRUN',
        message: `Received ${dto.parts.length} parts but only ${plannedPartsCount} were planned`,
      });
    }
    const numbers = new Set<number>();
    for (const part of dto.parts) {
      if (part.partNumber < 1 || part.partNumber > plannedPartsCount) {
        throw new BadRequestException({
          code: 'MEDIA_PART_NUMBER_OUT_OF_RANGE',
          message: `partNumber ${part.partNumber} is outside [1, ${plannedPartsCount}]`,
        });
      }
      if (numbers.has(part.partNumber)) {
        throw new BadRequestException({
          code: 'MEDIA_DUPLICATE_PART_NUMBER',
          message: `Duplicate partNumber ${part.partNumber}`,
        });
      }
      numbers.add(part.partNumber);
    }
  }

  private async requireOwnedAsset(
    ownerUserId: string,
    assetId: string,
  ): Promise<MediaAsset> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({
        code: 'MEDIA_NOT_OWNER',
        message: 'You can only manage your own uploads',
      });
    }
    return asset;
  }

  private requireMultipartMetadata(asset: MediaAsset): MultipartMetadata {
    const meta = this.coerceJsonObject(asset.metadata);
    const multipart =
      meta && typeof meta === 'object'
        ? (meta as Record<string, unknown>).multipart
        : undefined;
    if (
      !multipart ||
      typeof multipart !== 'object' ||
      typeof (multipart as { uploadId?: unknown }).uploadId !== 'string' ||
      typeof (multipart as { partsCount?: unknown }).partsCount !== 'number'
    ) {
      throw new ConflictException({
        code: 'MEDIA_MULTIPART_METADATA_MISSING',
        message: 'MediaAsset is missing multipart metadata',
      });
    }
    return multipart as MultipartMetadata;
  }

  private coerceJsonObject(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonObject | null {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as Prisma.JsonObject;
    }
    return null;
  }

  /** Exposed so the cleanup cron can derive the same window the service uses. */
  static computeOrphanCutoff(now: Date = new Date()): Date {
    const ms = MEDIA_UPLOAD_ORPHAN_TTL_HOURS * 60 * 60 * 1000;
    return new Date(now.getTime() - ms);
  }
}
