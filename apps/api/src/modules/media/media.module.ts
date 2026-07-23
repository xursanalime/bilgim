import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { R2Module } from '../../infra/r2/r2.module';
import { MediaAccessService } from './media-access.service';
import { MediaAssetsController } from './media-assets.controller';
import { MediaPublicController } from './media-public.controller';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaAssetRepository } from './repositories/media-asset.repository';
import { FfmpegRunner, SpawnFfmpegRunner } from './transcoding/ffmpeg.runner';
import { FfmpegService } from './transcoding/ffmpeg.service';
import { TranscodingService } from './transcoding/transcoding.service';
import { VideoTranscodeProcessor } from './transcoding/transcode.processor';

/**
 * MediaModule — owns MediaAsset and the R2 multipart upload lifecycle
 * (Req 8.1, 8.2, 8.6, 8.7, 8.8) plus playback URL signing (Req 8.3, 21.6)
 * plus the video transcoding pipeline (Req 8.3, 8.4, 8.5).
 *
 * Imports:
 *   - R2Module — provides the singleton S3-compatible client.
 *   - BullMqModule (registered globally in `app.module`) — provides the
 *     `transcoding` queue used by `MediaService.completeUpload` to fan
 *     work out to `VideoTranscodeProcessor`.
 *
 * Owns its own PrismaClient (matching the pattern of Auth/Catalog/etc.).
 * Exports MediaService so future modules — Catalog (lesson attachments),
 * Live (recording finalizer), Homework (submission attachments) — can
 * read MediaAsset metadata without re-implementing it.
 *
 * Transcoding wiring:
 *   - `FfmpegRunner` is bound to `SpawnFfmpegRunner` by default. Tests
 *     swap in a fake via `Test.createTestingModule` overrides so they
 *     never touch the system ffmpeg binary.
 *   - `FfmpegService` is the thin wrapper around the runner; it knows
 *     the encoder flags but no business logic.
 *   - `TranscodingService` orchestrates download → encode → upload.
 *   - `VideoTranscodeProcessor` is the BullMQ consumer.
 */
@Module({
  imports: [ConfigModule, R2Module],
  controllers: [MediaController, MediaAssetsController, MediaPublicController],
  providers: [
    MediaService,
    MediaAccessService,
    MediaAssetRepository,
    { provide: FfmpegRunner, useClass: SpawnFfmpegRunner },
    FfmpegService,
    TranscodingService,
    VideoTranscodeProcessor,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [MediaService, MediaAccessService, MediaAssetRepository],
})
export class MediaModule {}
