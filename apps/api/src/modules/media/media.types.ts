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
 * explicit rather than wildcards (`image/*`) — a malicious client could
 * otherwise smuggle an exotic/dangerous subtype through the upload path.
 * `image/svg+xml` is deliberately never listed: an SVG can carry inline
 * `<script>`, so serving one back with the asset's own content-type would
 * hand a chat attachment a stored-XSS vector.
 *
 * `OTHER` covers "send any kind of file" (chat attachments — Telegram-style
 * messaging expects PDFs, archives, plain text, presentations, etc. to all
 * be sendable, not just the five original kinds this list started with).
 * It intentionally still excludes `application/octet-stream`: browsers and
 * OS file pickers fall back to that generic type for *anything*
 * unrecognized, including executables, so accepting it here would be
 * accepting arbitrary binaries with no AV scanning in front of them yet
 * (tracked for the media-security follow-up, alongside forcing
 * `Content-Disposition: attachment` on non-preview kinds). The filename
 * extension blocklist in `assertSafeFileExtension` is the defense-in-depth
 * backstop for this list regardless.
 */
export const ALLOWED_MIME_BY_KIND: Record<MediaKindLiteral, readonly string[]> =
  {
    VIDEO: [
      'video/mp4',
      'video/quicktime', // .mov
      'video/webm',
      'video/x-matroska', // .mkv (kept for teacher uploads pre-transcode)
      'video/x-msvideo', // .avi
      'video/3gpp', // mobile-recorded clips
      'video/mpeg',
    ],
    AUDIO: [
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/ogg',
      'audio/webm', // voice messages (MediaRecorder default)
      'audio/aac',
      'audio/x-m4a',
      'audio/flac',
    ],
    IMAGE: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/heic', // iPhone default photo format
      'image/heif',
      'image/bmp',
    ],
    PDF: ['application/pdf'],
    DOC: [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/rtf',
    ],
    SHEET: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    OTHER: [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-7z-compressed',
      'application/vnd.rar',
      'application/x-rar-compressed',
      'application/x-tar',
      'application/gzip',
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/json',
    ],
  } as const;

/**
 * Filename extensions rejected regardless of `kind`/declared content-type —
 * the last line of defense once `OTHER` accepts arbitrary-looking files. A
 * client controls both the filename and the declared MIME type, so this
 * check exists specifically for the case where the two disagree with the
 * actual bytes (e.g. `invoice.pdf.exe`, or a `.js`/`.jar` renamed to slip
 * past a naive check). Checked against the *whole* lowercased filename so
 * a double extension like `invoice.pdf.exe` is still caught by `.exe`.
 */
export const BLOCKED_FILE_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1', '.jar', '.apk', '.ipa',
  '.dmg', '.app', '.deb', '.rpm', '.sh', '.bash', '.dll', '.sys', '.lnk',
  '.reg', '.scf', '.hta', '.cpl', '.gadget', '.msc',
] as const;

/** True when `fileName` ends in a blocked extension (case-insensitive). */
export function hasBlockedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return BLOCKED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

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
 *
 * `width` / `height` describe the *landscape* bounding box of each rung.
 * They are not the literal output dimensions: `resolveVariantDimensions`
 * fits the source into this box while preserving its aspect ratio (and
 * transposes the box for portrait sources), so a 1080x1920 phone video
 * renders as 1080x1920 at the `1080p` rung rather than being squeezed
 * into a 1920x1080 letterbox.
 */
export const HLS_VARIANTS: readonly HlsVariant[] = [
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
  {
    name: '1440p',
    width: 2560,
    height: 1440,
    videoBitrateKbps: 9000,
    audioBitrateKbps: 192,
  },
] as const;

/**
 * The ladder's top rung doubles as the platform's delivery ceiling.
 *
 * `resolveVariantDimensions` never upscales, so a source at or below 2K
 * is reproduced at its own resolution and anything larger (4K phone
 * footage) is downscaled to fit this rung — nothing is delivered above
 * it. Raising the ceiling is a matter of appending a rung here; every
 * other part of the pipeline reads the ladder.
 */
export const HLS_MAX_VARIANT = HLS_VARIANTS[HLS_VARIANTS.length - 1]!;

/**
 * A ladder rung with its literal output dimensions resolved against a
 * specific source. `outputWidth`/`outputHeight` are what ffmpeg scales to
 * and what the master playlist advertises as `RESOLUTION`.
 */
export interface ResolvedHlsVariant extends HlsVariant {
  readonly outputWidth: number;
  readonly outputHeight: number;
}

/**
 * x264 constant-quality target used for every rung.
 *
 * The ladder's `videoBitrateKbps` is applied as a VBV *cap* (`-maxrate`)
 * rather than an average target (`-b:v`). With a hard average, easy
 * content (a mostly-static classroom shot) is inflated to the target and
 * hard content is starved at exactly the same number — quality swings
 * with the footage. With CRF + cap, ffmpeg spends only what the picture
 * needs and the cap still keeps the advertised BANDWIDTH honest.
 *
 * 21 is a notch above x264's default 23: visually near-transparent at
 * these resolutions while still well under the per-rung cap for typical
 * lesson footage.
 */
export const HLS_CRF = 21;

/**
 * Round to an even integer ≥ 2. libx264 with yuv420p chroma subsampling
 * requires even dimensions, and odd values make ffmpeg fail the encode.
 */
function toEvenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Fit a source frame into a ladder rung, preserving aspect ratio.
 *
 * Two rules matter here, and both exist because the platform's videos are
 * overwhelmingly phone recordings:
 *
 *  - **The box is transposed for portrait sources.** A rung means "N
 *    pixels on the short side", the way every consumer platform defines
 *    quality labels. Fitting a 1080x1920 source into a literal 1920x1080
 *    box would scale it down to 607x1080 — a 44% linear resolution loss
 *    on a video the ladder claims to render at "1080p".
 *  - **Never upscale.** A 640x480 source at the 1080p rung stays 640x480;
 *    inventing pixels only costs bitrate. `pickVariants` then drops the
 *    duplicate rungs this produces.
 *
 * When the probe failed (`sourceWidth`/`sourceHeight` are 0) we fall back
 * to the rung's own box, which is the best guess available.
 */
export function resolveVariantDimensions(
  sourceWidth: number,
  sourceHeight: number,
  variant: HlsVariant,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: variant.width, height: variant.height };
  }

  const isPortrait = sourceHeight > sourceWidth;
  const boxWidth = isPortrait ? variant.height : variant.width;
  const boxHeight = isPortrait ? variant.width : variant.height;

  const scale = Math.min(
    boxWidth / sourceWidth,
    boxHeight / sourceHeight,
    1, // never upscale
  );

  return {
    width: toEvenDimension(sourceWidth * scale),
    height: toEvenDimension(sourceHeight * scale),
  };
}

/**
 * RFC 6381 codec string for an H.264 rendition of the given size.
 *
 * Players treat the master playlist's `CODECS` as a promise and check it
 * against what they can decode — hls.js runs it through
 * `MediaSource.isTypeSupported` and silently discards rungs that come
 * back unsupported. A single hard-coded value cannot describe a ladder
 * that spans 240p to 1440p: declaring a level below what the stream
 * actually needs makes strict players reject a rendition they were about
 * to play, and the level required scales with frame size.
 *
 * The form is `avc1.PPCCLL` — profile_idc, constraint flags, level_idc,
 * each two hex digits. Levels are chosen by pixel count (so portrait and
 * landscape of the same rung agree) and with headroom for 60 fps, which
 * needs a level higher than the same resolution at 30.
 */
export function h264CodecString(width: number, height: number): string {
  const pixels = width * height;
  let level: number;
  if (pixels <= 414_720) {
    level = 0x1e; // 3.0
  } else if (pixels <= 921_600) {
    level = 0x1f; // 3.1 — 720p
  } else if (pixels <= 2_073_600) {
    level = 0x2a; // 4.2 — 1080p60
  } else if (pixels <= 3_686_400) {
    level = 0x33; // 5.1 — 1440p60
  } else {
    level = 0x34; // 5.2 — beyond the ladder's ceiling; defensive
  }
  // 0x64 = High profile, no constraint flags set.
  return `avc1.64${'00'}${level.toString(16).padStart(2, '0')}`;
}

/** HLS segment duration in seconds. 6s gives a good tradeoff between startup latency and segment count. */
export const HLS_SEGMENT_DURATION_SECONDS = 6;

/**
 * Forced keyframe interval in seconds. Must divide
 * `HLS_SEGMENT_DURATION_SECONDS` so the HLS muxer can cut segments on
 * exact boundaries.
 *
 * Without a forced interval x264 only emits keyframes on scene cuts,
 * which leaves them many seconds apart — a short clip then encodes to a
 * single giant segment (no bitrate switching possible) and the player
 * can only seek at those sparse keyframes. 2s keeps seeking responsive
 * and matches Apple's HLS authoring guidance.
 */
export const HLS_KEYFRAME_INTERVAL_SECONDS = 2;

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
