export { MediaModule } from './media.module';
export { MediaService, MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS } from './media.service';
export type {
  MediaPlaybackResponse,
  PlaybackUrl,
  UploadAborted,
  UploadCompleted,
  UploadInitiated,
} from './media.service';
export {
  MediaAccessService,
  type MediaAccessActor,
} from './media-access.service';
export { MediaAssetsController } from './media-assets.controller';
export { MediaAssetRepository } from './repositories/media-asset.repository';
export { InitUploadSchema, type InitUploadDto } from './dto/init-upload.dto';
export {
  CompleteUploadSchema,
  type CompleteUploadDto,
} from './dto/complete-upload.dto';
export {
  ALLOWED_MIME_BY_KIND,
  HLS_VARIANTS,
  HLS_VARIANT_PLAYLIST_FILENAME,
  HLS_SEGMENT_DURATION_SECONDS,
  MEDIA_DEFAULT_PART_SIZE_BYTES,
  MEDIA_KIND_VALUES,
  MEDIA_MAX_SIZE_BYTES,
  MEDIA_UPLOAD_ORPHAN_TTL_HOURS,
  VIDEO_TRANSCODE_BACKOFF_DELAY_MS,
  VIDEO_TRANSCODE_JOB_NAME,
  VIDEO_TRANSCODE_MAX_ATTEMPTS,
  deriveHlsVariantKey,
  type HlsVariant,
  type MediaKindLiteral,
} from './media.types';
export { FfmpegRunner, SpawnFfmpegRunner } from './transcoding/ffmpeg.runner';
export type { FfmpegExecResult } from './transcoding/ffmpeg.runner';
export { FfmpegService } from './transcoding/ffmpeg.service';
export type {
  VideoProbeResult,
  TranscodeVariantInput,
  MasterPlaylistInput,
} from './transcoding/ffmpeg.service';
export { TranscodingService } from './transcoding/transcoding.service';
export type { TranscodingResult } from './transcoding/transcoding.service';
export { VideoTranscodeProcessor } from './transcoding/transcode.processor';
export type {
  VideoTranscodeJob,
  VideoTranscodeResult,
} from './transcoding/transcode.processor';
