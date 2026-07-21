/**
 * Shared types and constants for the Media module.
 *
 * The MIME allow-list (Req 8.7) is co-located with the kind→mime mapping so
 * the service can validate that a teacher uploading `kind=PDF` is actually
 * sending a PDF, not (say) `application/octet-stream`.
 */

/** Mirrors the Prisma `MediaKind` enum. */
export const MEDIA_KIND_VALUES = [
  'VIDEO',
  'AUDIO',
  'IMAGE',
  'PDF',
  'DOC',
  'SHEET',
  'OTHER',
] as const;

export type MediaKindLiteral = (typeof MEDIA_KIND_VALUES)[number];

/**
 * Allowed MIME types per `MediaKind` (Req 8.7).
 *
 * Each value is a list of exact MIME types. We intentionally keep the list
 * small and explicit — wildcards (`image/*`) would let a malicious client
 * smuggle exotic SVGs / TIFFs through the upload path.
 */
export const ALLOWED_MIME_BY_KIND: Record<MediaKindLiteral, readonly string[]> =
  {
    VIDEO: [
      'video/mp4',
      'video/quicktime', // .mov
      'video/webm',
      'video/x-matroska', // .mkv (kept for teacher uploads pre-transcode)
    ],
    AUDIO: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm'],
    IMAGE: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    PDF: ['application/pdf'],
    DOC: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    SHEET: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    OTHER: [],
  } as const;

/** Cap on stored MediaAsset size — 5 GiB. */
export const MEDIA_MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Recommended part size for client uploads — 8 MiB. Below the 5 MiB R2
 * minimum the upload would be rejected, and 8 MiB gives reasonable parallelism
 * while keeping the part count bounded.
 */
export const MEDIA_DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;

/**
 * After 24 hours an UPLOADING MediaAsset is considered orphaned (Req 8.6).
 * The cleanup cron uses this constant — exposed here so tests can assert
 * the same window the production code does.
 */
export const MEDIA_UPLOAD_ORPHAN_TTL_HOURS = 24;

// ============================================================
// Video transcoding (Req 8.3, 8.4, 8.5)
// ============================================================

/** BullMQ job name pushed onto the `transcoding` queue when an UPLOADED VIDEO is ready to be processed. */
export const VIDEO_TRANSCODE_JOB_NAME = 'video.transcode';

/**
 * Per-renditon configuration for HLS variants (Req 8.4).
 *
 * Bitrates and resolutions follow Apple's recommended HLS authoring
 * specification (https://developer.apple.com/documentation/http_live_streaming).
 * The `bandwidth` field in the master playlist combines video + audio
 * bitrates plus a small overhead for muxing.
 */
export interface HlsVariant {
  /** Short label used in directory names and master playlist (e.g. `720p`). */
  readonly name: string;
  /** Output width in pixels. */
  readonly width: number;
  /** Output height in pixels. */
  readonly height: number;
  /** Video bitrate in kilobits/sec. */
  readonly videoBitrateKbps: number;
  /** Audio bitrate in kilobits/sec. */
  readonly audioBitrateKbps: number;
}

/**
 * Default HLS variant ladder (Req 8.4). Ordered by ascending bitrate so
 * the master playlist lists the lowest variant first (better startup
 * latency on poor connections).
 */
export const HLS_VARIANTS: readonly HlsVariant[] = [
  {
    name: '240p',
    width: 426,
    height: 240,
    videoBitrateKbps: 400,
    audioBitrateKbps: 64,
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    videoBitrateKbps: 1000,
    audioBitrateKbps: 96,
  },
  {
    name: '720p',
    width: 1280,
    height: 720,
    videoBitrateKbps: 2500,
    audioBitrateKbps: 128,
  },
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 5000,
    audioBitrateKbps: 192,
  },
] as const;

/** HLS segment duration in seconds. 6s gives a good tradeoff between startup latency and segment count. */
export const HLS_SEGMENT_DURATION_SECONDS = 6;

/** BullMQ retry budget for the transcoding queue. Aligned with the platform default but pinned here for clarity. */
export const VIDEO_TRANSCODE_MAX_ATTEMPTS = 3;

/**
 * Backoff for transcoding retries. Each retry waits longer because
 * transient failures (R2 throttling, ephemeral worker host issues)
 * usually recover within seconds, while persistent failures (corrupt
 * source) won't recover at all and we want to surface them quickly.
 */
export const VIDEO_TRANSCODE_BACKOFF_DELAY_MS = 5_000;

/**
 * Filename used for each variant playlist relative to the variant directory.
 * Kept as a single constant so the transcoder writer and the playback URL
 * builder agree on the convention without sharing implementation details.
 */
export const HLS_VARIANT_PLAYLIST_FILENAME = 'playlist.m3u8';

/**
 * Derive the R2 key of a variant playlist from the master HLS manifest key.
 *
 * Convention agreed with the transcoding worker (Task 11.2):
 *   master:  `<dir>/master.m3u8`  →  `dir = parent of the master file`.
 *   variant: `<dir>/<variantName>/playlist.m3u8`
 *
 * Edge cases:
 *  - If `manifestKey` has no `/` (top-level master file), the variant
 *    directory is the variant name itself.
 *  - The function is purely string-based — it never touches R2.
 */
export function deriveHlsVariantKey(
  manifestKey: string,
  variantName: string,
): string {
  if (!manifestKey || manifestKey.length === 0) {
    throw new Error('manifestKey is required');
  }
  if (!variantName || variantName.length === 0) {
    throw new Error('variantName is required');
  }
  const lastSlash = manifestKey.lastIndexOf('/');
  const dir = lastSlash >= 0 ? manifestKey.slice(0, lastSlash) : '';
  const prefix = dir.length > 0 ? `${dir}/` : '';
  return `${prefix}${variantName}/${HLS_VARIANT_PLAYLIST_FILENAME}`;
}
