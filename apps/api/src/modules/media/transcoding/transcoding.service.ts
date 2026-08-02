import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pipeline } from 'node:stream/promises';

import { R2Service } from '../../../infra/r2/r2.service';
import {
  ResolvedHlsVariant,
  HLS_VARIANTS,
  resolveVariantDimensions,
} from '../media.types';
import { FfmpegService } from './ffmpeg.service';

export interface TranscodingResult {
  /** R2 key of the master `.m3u8` (e.g. `media/.../hls/master.m3u8`). */
  hlsManifestKey: string;
  /** Variants actually rendered (filtered against source resolution). */
  variants: ResolvedHlsVariant[];
  /** Source duration in milliseconds, or 0 when probe failed. */
  durationMs: number;
}

/**
 * TranscodingService — orchestrates the per-asset transcoding pipeline:
 *
 *   1. Download the source from R2 to a temp directory.
 *   2. Probe duration / dimensions with ffprobe.
 *   3. For every applicable variant in the ladder, invoke ffmpeg to emit
 *      a self-contained HLS sub-folder.
 *   4. Write the master playlist that references each variant.
 *   5. Upload manifests + segments back to R2 under
 *      `media/<owner>/<assetId>/hls/...`.
 *   6. Return the master manifest key so the worker can persist it on
 *      the MediaAsset row.
 *
 * The service deliberately writes everything to a unique temp directory
 * and cleans it up in `finally` — that way a partial failure doesn't
 * leave gigabytes of half-encoded files behind on the worker.
 *
 * It is **stateless** (no DB / queue access) so the BullMQ processor
 * can drive it and it stays trivially testable.
 */
@Injectable()
export class TranscodingService {
  private readonly logger = new Logger(TranscodingService.name);

  constructor(
    private readonly r2: R2Service,
    private readonly ffmpeg: FfmpegService,
  ) {}

  /**
   * Run the full pipeline for one asset.
   *
   * @param assetId UUID of the MediaAsset; used to build R2 output keys.
   * @param sourceKey R2 key of the original upload (`MediaAsset.originalKey`).
   * @param ownerUserId Owner of the asset; used as a path component for
   *                    consistency with `MediaService.buildObjectKey`.
   */
  async run(
    assetId: string,
    sourceKey: string,
    ownerUserId: string,
  ): Promise<TranscodingResult> {
    const workDir = this.makeWorkDir(assetId);
    const sourcePath = path.join(workDir, 'source');

    try {
      // 1) Download source to local disk
      this.logger.debug(`download r2://${sourceKey} → ${sourcePath}`);
      const sourceStream = await this.r2.getObjectReadStream(sourceKey);
      await pipeline(sourceStream, fs.createWriteStream(sourcePath));

      // 2) Probe duration / dimensions
      const probe = await this.ffmpeg.probe(sourcePath);
      this.logger.debug(
        `probe duration=${probe.durationMs}ms resolution=${probe.width}x${probe.height}`,
      );

      // 3) Pick variants — never upscale beyond the source resolution.
      const variants = this.pickVariants(probe.width, probe.height);
      this.logger.debug(
        `ladder=[${variants
          .map((v) => `${v.name}:${v.outputWidth}x${v.outputHeight}`)
          .join(',')}]`,
      );
      if (variants.length === 0) {
        throw new Error(
          `No applicable variants for source resolution ${probe.width}x${probe.height}`,
        );
      }

      // 4) Render the whole ladder in one ffmpeg process — the source is
      //    decoded once and split across variants rather than re-decoded
      //    per variant. See `FfmpegService.transcodeAllVariants`.
      const hlsDir = path.join(workDir, 'hls');
      fs.mkdirSync(hlsDir, { recursive: true });
      await this.ffmpeg.transcodeAllVariants({
        inputPath: sourcePath,
        hlsDir,
        variants,
        color: probe.color,
      });

      // 5) Master playlist
      const masterPath = path.join(hlsDir, 'master.m3u8');
      await this.ffmpeg.writeMasterPlaylist({
        outputPath: masterPath,
        variants,
      });

      // 6) Upload everything to R2
      const baseKey = this.buildHlsBaseKey(ownerUserId, assetId);
      const manifestKey = `${baseKey}/master.m3u8`;
      await this.uploadHlsTree(hlsDir, baseKey);

      this.logger.log(
        `Transcoding complete asset=${assetId} variants=[${variants.map((v) => v.name).join(',')}] manifest=${manifestKey}`,
      );

      return {
        hlsManifestKey: manifestKey,
        variants,
        durationMs: probe.durationMs,
      };
    } finally {
      this.cleanupWorkDir(workDir);
    }
  }

  // ------------------------------------------------------------------
  // Helpers (exposed for unit testing)
  // ------------------------------------------------------------------

  /**
   * Resolve the static ladder against the source's intrinsic resolution.
   *
   * Each rung is fitted to the source's aspect ratio (see
   * `resolveVariantDimensions`), then rungs that resolve to the same
   * output size as the rung below are dropped: once a rung reaches the
   * source's native resolution, every higher rung would re-encode the
   * exact same picture at a bigger bitrate cap for no visible gain. A
   * 640x480 source therefore renders `240p` + `480p` and stops, instead
   * of paying for three identical 640x480 encodes.
   *
   * When the probe fails (`width=0`) every rung resolves to its own box
   * and the full ladder is kept, so downstream playback isn't degraded.
   */
  pickVariants(
    sourceWidth: number,
    sourceHeight: number,
  ): ResolvedHlsVariant[] {
    const picked: ResolvedHlsVariant[] = [];
    for (const variant of HLS_VARIANTS) {
      const { width, height } = resolveVariantDimensions(
        sourceWidth,
        sourceHeight,
        variant,
      );
      const previous = picked[picked.length - 1];
      if (previous?.outputWidth === width && previous?.outputHeight === height) {
        continue;
      }
      picked.push({ ...variant, outputWidth: width, outputHeight: height });
    }
    return picked;
  }

  /**
   * Build the R2 key prefix for the HLS tree of `assetId`.
   * Format: `media/<owner>/hls/<assetId>`.
   */
  buildHlsBaseKey(ownerUserId: string, assetId: string): string {
    return `media/${ownerUserId}/hls/${assetId}`;
  }

  /**
   * Recursively upload everything under `localDir` to R2 under
   * `<baseKey>/...`. Content-Type is inferred from extension.
   */
  private async uploadHlsTree(
    localDir: string,
    baseKey: string,
  ): Promise<void> {
    const entries = this.walk(localDir);
    for (const entry of entries) {
      const relative = path.relative(localDir, entry).replace(/\\/g, '/');
      const key = `${baseKey}/${relative}`;
      const stream = fs.createReadStream(entry);
      const contentType = this.inferContentType(entry);
      // AWS SDK v3 PutObject accepts Readable streams.
      await this.r2.putObject(key, stream as any, contentType);
    }
  }

  /** Depth-first list of regular files under `dir`. */
  private walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        out.push(...this.walk(full));
      } else if (stat.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  private inferContentType(file: string): string {
    if (file.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (file.endsWith('.ts')) return 'video/MP2T';
    return 'application/octet-stream';
  }

  private makeWorkDir(assetId: string): string {
    const dir = path.join(
      os.tmpdir(),
      `edubridge-transcode-${assetId}-${process.pid}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private cleanupWorkDir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `Failed to clean up workDir ${dir}: ${(err as Error).message}`,
      );
    }
  }
}
