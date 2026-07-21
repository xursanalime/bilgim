import { Readable } from 'node:stream';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Hard caps imposed by S3 / R2 on multipart uploads.
 *
 *  - A single multipart upload may have at most 10 000 parts.
 *  - Each part must be ≥ 5 MiB except for the final part.
 *  - Maximum object size is 5 TiB.
 *
 * Parts are 1-indexed (1 .. 10 000).
 */
export const R2_MAX_PARTS = 10_000;
export const R2_MIN_PART_NUMBER = 1;

/** Default TTL applied to presigned part-upload URLs. */
export const R2_DEFAULT_PART_URL_TTL_SECONDS = 60 * 60; // 1 hour
/** Hard cap on signed URL TTL — Req 21.6 says at most 6 hours. */
export const R2_MAX_SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;

export interface SignedPartUrl {
  partNumber: number;
  url: string;
}

export interface CompletePartInput {
  partNumber: number;
  /** ETag returned by R2 from the part PUT. May or may not include quotes. */
  etag: string;
}

/**
 * R2Service — thin wrapper around the AWS S3 SDK targeted at Cloudflare R2.
 *
 * R2 is S3-compatible, so we use `@aws-sdk/client-s3` with a custom
 * `endpoint` derived from `R2_ACCOUNT_ID`. The client is configured for
 * `region: 'auto'` (R2 ignores region) and `forcePathStyle: true` because
 * R2 routes by path, not virtual-host.
 *
 * This service is the single chokepoint for R2 multipart upload calls so
 * the higher-level MediaService stays free of SDK details.
 */
@Injectable()
export class R2Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID') ?? 'local-dev';
    const accessKeyId =
      this.config.get<string>('R2_ACCESS_KEY_ID') ?? 'local-dev';
    const secretAccessKey =
      this.config.get<string>('R2_SECRET_ACCESS_KEY') ?? 'local-dev';
    this.bucket =
      this.config.get<string>('R2_BUCKET_NAME') ?? 'edubridge-media';

    // Allow tests / local emulation (MinIO) to override the endpoint.
    const overrideEndpoint = this.config.get<string>('R2_PUBLIC_URL');
    this.endpoint =
      overrideEndpoint && overrideEndpoint.length > 0
        ? overrideEndpoint
        : `https://${accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.shouldAutoCreateBucket()) return;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      const code =
        (error as { name?: string; Code?: string }).name ??
        (error as { Code?: string }).Code;

      // In local dev, an ECONNREFUSED should not crash the entire app during bootstrap.
      // We log it as a warning and continue.
      if ((error as any).code === 'ECONNREFUSED') {
        this.logger.warn(
          `Could not connect to R2 at ${this.endpoint}. Storage features will be unavailable.`,
        );
        return;
      }

      if (status !== 404 && code !== 'NotFound' && code !== 'NoSuchBucket') {
        throw error;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created local media bucket "${this.bucket}"`);
    }
  }

  onModuleDestroy(): void {
    // Free the underlying HTTP agent so Jest exits cleanly.
    this.client.destroy();
  }

  /** Bucket name surfaced for repository-level logging / diagnostics. */
  getBucket(): string {
    return this.bucket;
  }

  // ---------------------------------------------------------------
  // Multipart upload primitives
  // ---------------------------------------------------------------

  /**
   * Begin a multipart upload and return the `uploadId` issued by R2.
   *
   * The `key` is the object key; `contentType` is recorded so R2 returns
   * the correct `Content-Type` on download.
   */
  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const response = await this.client.send(command);
    if (!response.UploadId) {
      throw new Error('R2 did not return an UploadId for CreateMultipartUpload');
    }
    return response.UploadId;
  }

  /**
   * Pre-sign an UploadPart request so the client can `PUT` directly to R2.
   *
   * `expiresIn` is clamped to [1 minute, 6 hours] per Req 21.6.
   */
  async signUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number = R2_DEFAULT_PART_URL_TTL_SECONDS,
  ): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < R2_MIN_PART_NUMBER) {
      throw new Error(`partNumber must be an integer ≥ ${R2_MIN_PART_NUMBER}`);
    }
    if (partNumber > R2_MAX_PARTS) {
      throw new Error(`partNumber ${partNumber} exceeds R2 cap of ${R2_MAX_PARTS}`);
    }
    const ttl = Math.min(
      Math.max(60, expiresInSeconds),
      R2_MAX_SIGNED_URL_TTL_SECONDS,
    );
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttl });
  }

  /**
   * Pre-sign a batch of UploadPart URLs in `[1, partsCount]`. Returns an
   * array sorted by ascending `partNumber`.
   */
  async signUploadPartBatch(
    key: string,
    uploadId: string,
    partsCount: number,
    expiresInSeconds: number = R2_DEFAULT_PART_URL_TTL_SECONDS,
  ): Promise<SignedPartUrl[]> {
    if (!Number.isInteger(partsCount) || partsCount < 1) {
      throw new Error('partsCount must be a positive integer');
    }
    if (partsCount > R2_MAX_PARTS) {
      throw new Error(
        `partsCount ${partsCount} exceeds R2 cap of ${R2_MAX_PARTS}`,
      );
    }
    const promises: Promise<SignedPartUrl>[] = [];
    for (let n = 1; n <= partsCount; n++) {
      promises.push(
        this.signUploadPart(key, uploadId, n, expiresInSeconds).then(
          (url): SignedPartUrl => ({ partNumber: n, url }),
        ),
      );
    }
    return Promise.all(promises);
  }

  /**
   * Finalize a multipart upload. R2 stitches the parts and persists the
   * object atomically. Parts are normalized: ETag quoted and sorted by
   * ascending part number, as required by the S3 contract.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletePartInput[],
  ): Promise<{ key: string; location: string | undefined; etag: string | undefined }> {
    if (parts.length === 0) {
      throw new Error('completeMultipartUpload requires at least one part');
    }

    const sorted: CompletedPart[] = [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => ({
        PartNumber: p.partNumber,
        ETag: this.normalizeEtag(p.etag),
      }));

    // Detect duplicate part numbers up front — R2 returns a 400 otherwise
    // with a much less helpful error.
    const seen = new Set<number>();
    for (const p of sorted) {
      if (seen.has(p.PartNumber!)) {
        throw new Error(`Duplicate partNumber ${p.PartNumber}`);
      }
      seen.add(p.PartNumber!);
    }

    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    });
    const response = await this.client.send(command);
    return {
      key,
      location: response.Location,
      etag: response.ETag,
    };
  }

  /**
   * Abort an in-flight multipart upload and tell R2 to discard any
   * already-uploaded parts. Idempotent — a missing upload is treated as
   * already-aborted.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'NoSuchUpload') {
        this.logger.debug(
          `abortMultipartUpload: upload ${uploadId} for ${key} already gone`,
        );
        return;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------
  // Read helpers (used by GET /media/assets/:id and worker tasks)
  // ---------------------------------------------------------------

  /** Pre-sign a GET URL scoped to a single object. */
  async signObjectGet(
    key: string,
    expiresInSeconds: number = R2_DEFAULT_PART_URL_TTL_SECONDS,
  ): Promise<string> {
    const ttl = Math.min(
      Math.max(60, expiresInSeconds),
      R2_MAX_SIGNED_URL_TTL_SECONDS,
    );
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttl });
  }

  /** HEAD probe — returns true when the object exists in the bucket. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'NotFound' || code === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Download an object's full body as a Buffer. Used by the transcoding
   * worker to pull the source video onto the local disk before invoking
   * ffmpeg. For very large sources the worker should prefer streaming
   * (getObjectReadStream).
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`R2 GetObject(${key}) returned no body`);
    }
    // The AWS SDK's response.Body is a `StreamingBlobPayloadOutputTypes`
    // — Node streams support `transformToByteArray()` since v3.
    const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (typeof body.transformToByteArray !== 'function') {
      throw new Error(
        `R2 GetObject(${key}) body is not a streamable payload`,
      );
    }
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Returns a Readable stream for the object's body. Preferred for
   * processing large objects (e.g. video files) without loading them
   * entirely into memory.
   */
  async getObjectReadStream(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`R2 GetObject(${key}) returned no body`);
    }
    return response.Body as Readable;
  }

  /**
   * Upload a single object in one shot. Used by the transcoding worker
   * to push HLS manifests + segment files back to R2. Multipart is not
   * worth the complexity for a 6-second video segment.
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  /**
   * Ensure ETags are wrapped in double quotes — S3/R2 requires the quoted
   * form on `CompleteMultipartUpload`. Clients sometimes strip them when
   * round-tripping through their own state, so we add them back.
   */
  private normalizeEtag(etag: string): string {
    const trimmed = etag.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed;
    }
    return `"${trimmed}"`;
  }

  private shouldAutoCreateBucket(): boolean {
    const nodeEnv = this.config.get<string>('NODE_ENV') ?? 'development';
    if (nodeEnv !== 'development') return false;
    return (
      this.endpoint.startsWith('http://localhost') ||
      this.endpoint.startsWith('http://127.0.0.1')
    );
  }
}
