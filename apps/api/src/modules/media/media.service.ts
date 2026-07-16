import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { MediaAsset, MediaKind, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Readable } from 'node:stream';

import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
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
 * specify one. Ten minutes keeps any leaked direct/teacher-preview link
 * short-lived while staying well below the 6h hard cap from Req 21.6.
 * Playback is unaffected: the web proxy passes its own per-request TTL
 * (expiresIn=300) and re-signs per Range request.
 */
export const MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS = 600;

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
 * Resolved protected-file stream returned by
 * {@link MediaService.openProtectedStream}. The controller mirrors these
 * fields onto the HTTP response and pipes `stream` to the client. No
 * signed/addressable storage URL is ever included (Req 4.1).
 */
export interface ProtectedStream {
  stream: Readable;
  /** Server-authoritative Download_Permission (Req 4.2 – 4.4). */
  downloadAllowed: boolean;
  /** Sanitized filename used for the `attachment` disposition. */
  fileName: string;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges: string;
  /** True when a Range request was satisfied with a partial (206) body. */
  isPartial: boolean;
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
    private readonly r2: R2Service,
    private readonly assets: MediaAssetRepository,
    private readonly access: MediaAccessService,
    @InjectQueue(QUEUE_NAMES.TRANSCODING)
    private readonly transcodingQueue: Queue,
    @Optional()
    private readonly config?: ConfigService,
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

    // Persist completion metadata + status flip.
    const updated = await this.assets.transitionStatus(
      asset.id,
      'UPLOADING',
      'UPLOADED',
      {
        metadata: {
          ...(this.coerceJsonObject(asset.metadata) ?? {}),
          multipart: {
            ...meta,
            completedAt: new Date().toISOString(),
            etag: result.etag ?? null,
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
    //
    // On a local single-box / dev deployment there is no ffmpeg worker,
    // so transcoding is disabled. In that case we skip the queue and flip
    // the asset straight to READY (no hlsManifestKey) so the player serves
    // the original file progressively via the same-origin media proxy.
    if (asset.kind === 'VIDEO') {
      if (this.isTranscodingAvailable()) {
        await this.enqueueTranscodingJob(asset.id);
      } else {
        await this.markVideoReadyProgressive(asset.id);
      }
    }

    const url = await this.r2.signObjectGet(asset.originalKey, MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS);
    return { assetId: asset.id, status: 'UPLOADED', key: asset.originalKey, url };
  }

  /**
   * Whether HLS transcoding is available in this deployment.
   *
   * Disabled when `STORAGE_DRIVER=local` (single-box / dev media server
   * with no ffmpeg worker) or when `MEDIA_TRANSCODING_ENABLED=false`.
   * Defaults to enabled when no config is injected (e.g. unit tests),
   * preserving the existing enqueue-transcode behavior.
   */
  private isTranscodingAvailable(): boolean {
    if (!this.config) {
      return true;
    }
    const storageDriver = (
      this.config.get<string>('STORAGE_DRIVER') ?? 'r2'
    ).toLowerCase();
    if (storageDriver === 'local') {
      return false;
    }
    return this.config.get<boolean>('MEDIA_TRANSCODING_ENABLED') !== false;
  }

  /**
   * Transition an UPLOADED VIDEO asset straight to READY for progressive
   * playback of the original file (no HLS). Used when transcoding is not
   * available (local single-box deployment). Mirrors how the transcode
   * processor marks READY but deliberately leaves `hlsManifestKey` unset
   * so playback falls back to the original/progressive descriptor.
   */
  private async markVideoReadyProgressive(assetId: string): Promise<void> {
    try {
      const flipped = await this.assets.transitionStatus(
        assetId,
        'UPLOADED',
        'READY',
      );
      if (flipped === 0) {
        this.logger.warn(
          `MediaAsset ${assetId}: could not mark READY (progressive) — status changed concurrently`,
        );
        return;
      }
      this.logger.log(
        `Marked video asset ${assetId} READY for progressive playback (transcoding disabled)`,
      );
    } catch (error) {
      // Don't fail the upload — the asset is already UPLOADED and playable
      // via the FAILED/UPLOADED fallback path in getPlaybackUrls.
      this.logger.error(
        `Failed to mark video asset ${assetId} READY (progressive): ${(error as Error).message}`,
      );
    }
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

    // Studentlar dars materiallarini (PDF, IMAGE, AUDIO, DOC va h.k.)
    // yuklab ola olmaydi. FAQAT dars bilan bog'liq assetlar uchun blok —
    // chat xabarlaridagi rasmlar bundan mustasno (ular chat ishtirokchilari
    // o'zaro ulashar, egallash huquqi bor).
    if (actor.role === 'STUDENT' && asset.kind !== 'VIDEO') {
      const isLessonMaterial = await this.access.hasLessonReference(asset.id);
      if (isLessonMaterial) {
        throw new ForbiddenException({
          code: 'MEDIA_DOWNLOAD_FORBIDDEN',
          message: 'Students are not allowed to download lesson materials',
        });
      }
    }

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

    // HLS path: VIDEO + manifest key present → sign master + variants.
    if (asset.kind === 'VIDEO' && asset.hlsManifestKey) {
      const manifestKey = asset.hlsManifestKey;
      const manifestUrl = await this.r2.signObjectGet(manifestKey, ttl);
      const variantPairs = await Promise.all(
        HLS_VARIANTS.map(async (variant) => {
          const key = deriveHlsVariantKey(manifestKey, variant.name);
          const url = await this.r2.signObjectGet(key, ttl);
          return { variant: variant.name, key, url };
        }),
      );

      const urls: PlaybackUrl[] = [
        { role: 'manifest', key: manifestKey, url: manifestUrl },
        ...variantPairs.map<PlaybackUrl>((v) => ({
          role: 'variant',
          key: v.key,
          url: v.url,
          variant: v.variant,
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
  // Protected gated streaming (content-protection-backend Req 4.1 – 4.4)
  // ------------------------------------------------------------------

  /**
   * Open a byte stream for a protected file, enforcing entitlement and
   * Download_Permission server-side (Req 4.1 – 4.4 / Property 3).
   *
   * The caller (controller) receives a ready-to-pipe stream plus the
   * headers it must mirror. Critically, the underlying R2 object key is
   * NEVER turned into a signed/addressable URL — bytes are proxied
   * through the API so a learner can never bypass the access check by
   * resharing a storage link (Req 4.1).
   *
   * `Content-Disposition` is decided here from server state only:
   *   - `downloadAllowed === false` → caller must serve `inline`.
   *   - `downloadAllowed === true`  → caller may serve `attachment`.
   * Any client-provided download flag is ignored (Req 4.4).
   */
  async openProtectedStream(
    actor: MediaAccessActor,
    assetId: string,
    range?: string,
  ): Promise<ProtectedStream> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }

    // Entitlement + Download_Permission, resolved entirely server-side.
    const { downloadAllowed } = await this.access.resolveStreamAccess(
      actor,
      asset,
    );

    if (asset.status === 'UPLOADING') {
      throw new ConflictException({
        code: 'MEDIA_NOT_READY',
        message: 'Media asset is still uploading',
      });
    }
    if (!asset.originalKey) {
      throw new ConflictException({
        code: 'MEDIA_KEY_MISSING',
        message: 'MediaAsset has no R2 object key to stream',
      });
    }

    const object = await this.r2.getObjectStream(asset.originalKey, range);

    const result: ProtectedStream = {
      stream: object.body,
      downloadAllowed,
      fileName: this.resolveFileName(asset),
      contentType:
        object.contentType ?? asset.contentType ?? 'application/octet-stream',
      acceptRanges: object.acceptRanges,
      isPartial: object.isPartial,
    };
    if (typeof object.contentLength === 'number') {
      result.contentLength = object.contentLength;
    }
    if (object.contentRange !== undefined) {
      result.contentRange = object.contentRange;
    }
    return result;
  }

  /**
   * Derive a human-friendly download filename for the asset, preferring
   * the original upload name recorded in multipart metadata and falling
   * back to the tail of the R2 key.
   */
  private resolveFileName(asset: MediaAsset): string {
    const meta = this.coerceJsonObject(asset.metadata);
    const multipart = meta?.multipart as Record<string, unknown> | undefined;
    const fromMeta =
      multipart && typeof multipart.fileName === 'string'
        ? multipart.fileName
        : undefined;
    const fromKey = asset.originalKey?.split('/').pop();
    return this.sanitizeFileName(fromMeta || fromKey || 'file');
  }



  /**
   * HLS segment uchun qisqa muddatli (60s) imzolangan URL qaytaradi.
   *
   * `seg` formati: `<variantName>/<segmentFilename>` masalan: `720p/segment001.ts`
   *
   * Xavfsizlik:
   *  - Asset `hlsManifestKey` dan olingan directory bilan seg path tekshiriladi
   *  - Faqat asset ga ruxsati bor foydalanuvchi segment URL olishi mumkin
   *  - TTL: 60 soniya
   */
  async getHlsSegmentUrl(
    actor: MediaAccessActor,
    assetId: string,
    seg: string,
  ): Promise<{ url: string }> {
    const asset = await this.assets.findById(assetId);
    if (!asset) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Media asset not found' });
    }
    if (!asset.hlsManifestKey) {
      throw new ConflictException({ code: 'MEDIA_NOT_READY', message: 'Asset has no HLS manifest' });
    }

    // Ruxsatni tekshirish
    await this.access.assertCanRead(actor, asset);

    // Segment key = manifest directory + / + seg
    const manifestDir = asset.hlsManifestKey.substring(
      0,
      asset.hlsManifestKey.lastIndexOf('/'),
    );
    const segmentKey = `${manifestDir}/${seg}`;

    // Path traversal oldini olish — segment key manifest dir ichida bo'lishi shart
    if (!segmentKey.startsWith(manifestDir + '/')) {
      throw new BadRequestException({ code: 'INVALID_SEGMENT', message: 'Invalid segment path' });
    }

    // 60 soniya — segmentni yuklab olish uchun yetarli
    const url = await this.r2.signObjectGet(segmentKey, 60);
    return { url };
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
