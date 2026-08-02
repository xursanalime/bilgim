import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import {
  ResolvedHlsVariant,
  HLS_CRF,
  HLS_KEYFRAME_INTERVAL_SECONDS,
  HLS_SEGMENT_DURATION_SECONDS,
  HLS_VARIANT_PLAYLIST_FILENAME,
  h264CodecString,
} from '../media.types';
import { FfmpegRunner } from './ffmpeg.runner';

/**
 * How the source's colour is to be interpreted. Carried from the probe
 * into the encode so the renditions describe themselves the same way the
 * source does — see `colorArgs` for why this is not cosmetic.
 */
export interface VideoColorInfo {
  /** `tv` (limited) or `pc` (full). */
  range: string;
  /** Matrix coefficients, e.g. `bt709`. */
  space: string;
  primaries: string;
  /** Transfer characteristics (ffmpeg's `-color_trc`). */
  transfer: string;
}

/**
 * High-level fact about the source video probed via `ffprobe`. We only
 * care about duration; resolution-aware decisions (e.g. skipping a 1080p
 * variant for a 480p source) live in the transcoding service so it can
 * be unit-tested without ffprobe in the loop.
 */
export interface VideoProbeResult {
  /** Duration in milliseconds (rounded). May be 0 when probing fails. */
  durationMs: number;
  /** Best-effort source dimensions; either present together or both 0. */
  width: number;
  height: number;
  /** Source colour description, normalised and defaulted. */
  color: VideoColorInfo;
}

export interface TranscodeVariantInput {
  /** Local path to the source file already downloaded from R2. */
  inputPath: string;
  /** Destination directory for the variant's playlist + .ts segments. */
  outputDir: string;
  /** Variant ladder entry to render, with output dimensions resolved. */
  variant: ResolvedHlsVariant;
  /** Source colour description; omitted means "leave untagged". */
  color?: VideoColorInfo;
}

export interface TranscodeAllVariantsInput {
  /** Local path to the source file already downloaded from R2. */
  inputPath: string;
  /** Parent directory; each variant gets a `<hlsDir>/<variant.name>` subdir. */
  hlsDir: string;
  /** Variant ladder entries to render, in ladder order. */
  variants: readonly ResolvedHlsVariant[];
  /** Source colour description; omitted means "leave untagged". */
  color?: VideoColorInfo;
}

export interface MasterPlaylistInput {
  /** Variants that successfully rendered. Order is preserved. */
  variants: ResolvedHlsVariant[];
  /** Destination path for `master.m3u8`. */
  outputPath: string;
}

/**
 * FfmpegService — narrowly scoped wrapper that knows the exact ffmpeg /
 * ffprobe arguments needed to produce HLS variants for the platform.
 *
 * The service is intentionally _stateless_ — it neither opens R2 sockets
 * nor touches Prisma. That separation lets us unit-test it with a
 * mocked FfmpegRunner and keeps the transcoding processor free of
 * ffmpeg argument trivia.
 *
 * Configuration is read from env:
 *   - `FFMPEG_PATH` (default `ffmpeg`)
 *   - `FFPROBE_PATH` (default `ffprobe`)
 *
 * Both default to whatever is on `$PATH`, which is what the production
 * worker container ships.
 */
@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly ffmpegBinary: string;
  private readonly ffprobeBinary: string;

  /**
   * x264's default `-threads 0` (auto) sizes its thread pool off
   * `/proc/cpuinfo`, which in containerized hosts (Railway, etc.) reports
   * the *host's* full core count rather than the container's cgroup CPU
   * share. Each thread allocates its own frame + lookahead buffers, so on
   * a many-core host this can multiply libx264's memory footprint well
   * past the container's memory limit and get the encode SIGKILLed by the
   * OOM killer mid-run (observed: `threads=34` on a 1080p encode, process
   * killed with zero frames emitted). Pinning a small, fixed thread count
   * keeps memory use predictable regardless of what the host exposes.
   * Overridable via `FFMPEG_ENCODE_THREADS` — see env.schema.ts.
   */
  private readonly encodeThreadCount: number;

  constructor(
    private readonly runner: FfmpegRunner,
    config: ConfigService,
  ) {
    this.ffmpegBinary = config.get<string>('FFMPEG_PATH') ?? 'ffmpeg';
    this.ffprobeBinary = config.get<string>('FFPROBE_PATH') ?? 'ffprobe';
    this.encodeThreadCount = config.get<number>('FFMPEG_ENCODE_THREADS') ?? 2;
  }

  /**
   * Probe the source video for duration + dimensions. ffprobe with
   * `-show_format` + `-show_streams` returns enough JSON to recover the
   * bits we need; on failure we return zero values rather than throwing,
   * because a missing duration is recoverable (we just don't record it).
   */
  async probe(inputPath: string): Promise<VideoProbeResult> {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ];
    const result = await this.runner.run(this.ffprobeBinary, args);
    if (result.exitCode !== 0) {
      this.logger.warn(
        `ffprobe exited ${result.exitCode} for ${inputPath}: ${this.tail(result.stderr)}`,
      );
      return FfmpegService.emptyProbe();
    }
    return this.parseProbeOutput(result.stdout);
  }

  /**
   * Render a single HLS variant. The output is a self-contained directory
   * containing `index.m3u8` + `seg_*.ts` segment files.
   *
   * Encoding flags are shared with the ladder path — see `encodeArgs`.
   */
  async transcodeVariant(input: TranscodeVariantInput): Promise<void> {
    const { variant, inputPath, outputDir, color } = input;
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, HLS_VARIANT_PLAYLIST_FILENAME);
    const segmentPattern = path.join(outputDir, 'seg_%03d.ts');

    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      this.scaleFilter(variant),
      ...this.encodeArgs(variant, color),
      '-hls_time',
      String(HLS_SEGMENT_DURATION_SECONDS),
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      segmentPattern,
      playlistPath,
    ];

    const result = await this.runner.run(this.ffmpegBinary, args);
    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg variant ${variant.name} failed (exit ${result.exitCode}): ${this.tail(result.stderr)}`,
      );
    }
  }

  /**
   * Render the whole ladder in a single ffmpeg process.
   *
   * The source is decoded once and `split` into one branch per variant,
   * instead of spawning a process per variant that each re-decodes the
   * file from scratch. Measured on a 20s 1080x1920 source with the
   * 4-entry ladder: 24.0s -> 20.4s wall clock, and 56.8s -> 49.8s of CPU
   * time — the CPU saving is what matters under concurrent load, since
   * the worker no longer pays for four decodes of the same input.
   *
   * Output is byte-identical in structure to the per-variant path: each
   * variant still gets its own `<name>/index.m3u8` + `seg_*.ts` tree, so
   * `writeMasterPlaylist` and the R2 upload are unchanged.
   *
   * Encoding flags per variant are the same as the single-variant path;
   * see `encodeArgs` for what each one is for.
   */
  async transcodeAllVariants(input: TranscodeAllVariantsInput): Promise<void> {
    const { inputPath, hlsDir, variants, color } = input;
    if (variants.length === 0) {
      throw new Error('transcodeAllVariants called with an empty ladder');
    }

    // A single decode feeds every branch.
    const filterParts: string[] = [
      `[0:v]split=${variants.length}${variants
        .map((_, i) => `[v${i}]`)
        .join('')}`,
    ];
    for (const [i, variant] of variants.entries()) {
      filterParts.push(`[v${i}]${this.scaleFilter(variant)}[o${i}]`);
    }

    const args: string[] = [
      // Bounds the *decoder*. ffmpeg scopes an option to the next file it
      // sees, so this one — placed before `-i` — never reached the
      // encoders; each output carries its own `-threads` via `encodeArgs`.
      // Left global it silently bound output 0 alone, and the remaining
      // rungs ran at x264's host-derived default: precisely the OOM the
      // pinning exists to prevent, multiplied by the ladder's height.
      '-threads',
      String(this.encodeThreadCount),
      '-y',
      '-i',
      inputPath,
      '-filter_complex',
      filterParts.join(';'),
    ];

    for (const [i, variant] of variants.entries()) {
      const outputDir = path.join(hlsDir, variant.name);
      fs.mkdirSync(outputDir, { recursive: true });

      args.push(
        '-map',
        `[o${i}]`,
        '-map',
        '0:a?',
        ...this.encodeArgs(variant, color),
        '-hls_time',
        String(HLS_SEGMENT_DURATION_SECONDS),
        '-hls_playlist_type',
        'vod',
        '-hls_segment_filename',
        path.join(outputDir, 'seg_%03d.ts'),
        path.join(outputDir, HLS_VARIANT_PLAYLIST_FILENAME),
      );
    }

    const result = await this.runner.run(this.ffmpegBinary, args);
    if (result.exitCode !== 0) {
      throw new Error(
        `ffmpeg ladder encode failed (exit ${result.exitCode}): ${this.tail(result.stderr)}`,
      );
    }
  }

  /**
   * Build the HLS master playlist that references each variant's child
   * playlist by relative path (`./{variant.name}/index.m3u8`).
   *
   * This is plain text generation — no need to involve ffmpeg.
   */
  async writeMasterPlaylist(input: MasterPlaylistInput): Promise<void> {
    const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const v of input.variants) {
      const totalKbps = v.videoBitrateKbps + v.audioBitrateKbps;
      const bandwidth = Math.round(totalKbps * 1000);
      const codec = h264CodecString(v.outputWidth, v.outputHeight);
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${v.outputWidth}x${v.outputHeight},CODECS="${codec},mp4a.40.2"`,
      );
      lines.push(`${v.name}/${HLS_VARIANT_PLAYLIST_FILENAME}`);
    }
    lines.push('');
    fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
    fs.writeFileSync(input.outputPath, lines.join('\n'), 'utf8');
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Scale filter for one rung.
   *
   * The dimensions are already resolved against the source's aspect ratio
   * (`resolveVariantDimensions`), so this is a plain resize with no
   * letterbox `pad`. Padding used to bake black bars into every rendition
   * of a non-16:9 source: the bars consumed the same bitrate budget as the
   * picture and the picture itself lost resolution to make room for them.
   *
   * `flags=lanczos` replaces ffmpeg's default bicubic. Downscaling is
   * where most of the perceived sharpness is lost, and lanczos preserves
   * fine detail (text on a whiteboard, faces at a distance) noticeably
   * better for a negligible CPU cost.
   */
  private scaleFilter(variant: ResolvedHlsVariant): string {
    return `scale=w=${variant.outputWidth}:h=${variant.outputHeight}:flags=lanczos`;
  }

  /**
   * Codec + rate-control flags shared by both encode paths.
   *
   *   - `-c:v libx264` / `-profile:v high` / `-pix_fmt yuv420p` —
   *     universally decodable by hls.js and Safari. High profile adds the
   *     8x8 transform that `main` lacks, which is worth several percent
   *     of bitrate at the same quality — it matters most at the top of
   *     the ladder, where a 1440p rendition would otherwise be the first
   *     to run into its VBV cap. It must stay in sync with the profile
   *     `h264CodecString` advertises. The explicit pixel format matters
   *     for 10-bit or 4:2:2 phone footage, which the profile cannot
   *     represent.
   *   - `-preset fast` — one step up from `veryfast`. At a fixed quality
   *     target the slower preset simply spends fewer bits for the same
   *     picture, which is exactly the headroom we want under the cap.
   *   - `-crf` + `-maxrate`/`-bufsize` — constant quality with a VBV cap
   *     instead of a fixed average bitrate; see `HLS_CRF`.
   *   - `-force_key_frames` + `-sc_threshold 0` — a keyframe exactly
   *     every `HLS_KEYFRAME_INTERVAL_SECONDS`, and no extra ones on
   *     scene cuts. The muxer can only split on keyframes, so this is
   *     what makes segments land on real boundaries and keeps seeking
   *     granular; the expression form is used because it does not need
   *     the source fps. Every variant gets the same cut points, which
   *     is what lets the player switch between them mid-stream.
   *   - colour tags — see `colorArgs`.
   */
  private encodeArgs(
    variant: ResolvedHlsVariant,
    color?: VideoColorInfo,
  ): string[] {
    return [
      '-c:v',
      'libx264',
      '-threads',
      String(this.encodeThreadCount),
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'fast',
      '-crf',
      String(HLS_CRF),
      '-maxrate',
      `${variant.videoBitrateKbps}k`,
      '-bufsize',
      `${variant.videoBitrateKbps * 2}k`,
      '-force_key_frames',
      `expr:gte(t,n_forced*${HLS_KEYFRAME_INTERVAL_SECONDS})`,
      '-sc_threshold',
      '0',
      ...this.colorArgs(color),
      '-c:a',
      'aac',
      '-b:a',
      `${variant.audioBitrateKbps}k`,
      '-ac',
      '2',
    ];
  }

  /**
   * Stamp the source's colour description onto the rendition.
   *
   * These are tagging options, not conversion options — they only write
   * the values into the H.264 SPS. That is the point: when a stream
   * carries no colour description, players fall back to guessing from the
   * frame size, Rec.601 for SD and Rec.709 for HD. A 1080p source
   * downscaled to the 240p rung therefore flips from 709 to 601 and comes
   * out visibly washed out, with the same clip looking correct at 720p.
   * Tagging every rung with the source's own values keeps all of them
   * consistent with the original.
   */
  private colorArgs(color?: VideoColorInfo): string[] {
    if (!color) return [];
    return [
      '-color_range',
      color.range,
      '-colorspace',
      color.space,
      '-color_primaries',
      color.primaries,
      '-color_trc',
      color.transfer,
    ];
  }

  /** Last 4KiB of an ffmpeg log — keeps error messages bounded. */
  private tail(s: string): string {
    if (s.length <= 4096) return s;
    return `…${s.slice(s.length - 4096)}`;
  }

  /**
   * Extract `durationMs`, width, height and colour description from
   * ffprobe JSON output. Tolerant of partial / missing fields; never
   * throws.
   */
  private parseProbeOutput(stdout: string): VideoProbeResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return FfmpegService.emptyProbe();
    }

    const format = parsed.format as { duration?: string } | undefined;
    const durationSec = format?.duration ? Number(format.duration) : NaN;
    const durationMs = Number.isFinite(durationSec)
      ? Math.round(durationSec * 1000)
      : 0;

    const streams = Array.isArray(parsed.streams)
      ? (parsed.streams as Array<Record<string, unknown>>)
      : [];
    const video = streams.find((s) => s.codec_type === 'video');
    const width = typeof video?.width === 'number' ? video.width : 0;
    const height = typeof video?.height === 'number' ? video.height : 0;

    return { durationMs, width, height, color: this.parseColor(video, height) };
  }

  /**
   * Recover the colour description of the video stream, falling back to
   * the same size-based convention players use when a stream is untagged
   * (Rec.709 for HD, Rec.601 for SD). Deriving the fallback rather than
   * leaving it empty is what keeps a downscaled rendition looking like
   * its source — see `colorArgs`.
   *
   * Probed values are matched against an allow-list: they end up in an
   * ffmpeg argv, and an unrecognised string would either abort the encode
   * or, worse, be interpreted as something else entirely.
   */
  private parseColor(
    video: Record<string, unknown> | undefined,
    height: number,
  ): VideoColorInfo {
    const isHd = height >= 720;
    const fallback: VideoColorInfo = isHd
      ? {
          range: 'tv',
          space: 'bt709',
          primaries: 'bt709',
          transfer: 'bt709',
        }
      : {
          range: 'tv',
          space: 'smpte170m',
          primaries: 'smpte170m',
          transfer: 'smpte170m',
        };

    const pick = (value: unknown, allowed: ReadonlySet<string>, def: string) =>
      typeof value === 'string' && allowed.has(value) ? value : def;

    const range =
      typeof video?.color_range === 'string'
        ? FfmpegService.COLOR_RANGE_ALIASES[video.color_range] ??
          fallback.range
        : fallback.range;

    return {
      range,
      space: pick(video?.color_space, FfmpegService.COLOR_SPACES, fallback.space),
      primaries: pick(
        video?.color_primaries,
        FfmpegService.COLOR_PRIMARIES,
        fallback.primaries,
      ),
      transfer: pick(
        video?.color_transfer,
        FfmpegService.COLOR_TRANSFERS,
        fallback.transfer,
      ),
    };
  }

  /** Probe result used whenever ffprobe gives us nothing usable. */
  private static emptyProbe(): VideoProbeResult {
    return {
      durationMs: 0,
      width: 0,
      height: 0,
      color: {
        range: 'tv',
        space: 'bt709',
        primaries: 'bt709',
        transfer: 'bt709',
      },
    };
  }

  /** ffprobe reports `tv`/`pc`; older builds say `limited`/`full`. */
  private static readonly COLOR_RANGE_ALIASES: Record<string, string> = {
    tv: 'tv',
    limited: 'tv',
    pc: 'pc',
    full: 'pc',
  };

  private static readonly COLOR_SPACES: ReadonlySet<string> = new Set([
    'bt709',
    'bt470bg',
    'smpte170m',
    'smpte240m',
    'bt2020nc',
    'bt2020c',
    'fcc',
    'ycgco',
  ]);

  private static readonly COLOR_PRIMARIES: ReadonlySet<string> = new Set([
    'bt709',
    'bt470m',
    'bt470bg',
    'smpte170m',
    'smpte240m',
    'film',
    'bt2020',
    'smpte428',
    'smpte431',
    'smpte432',
  ]);

  private static readonly COLOR_TRANSFERS: ReadonlySet<string> = new Set([
    'bt709',
    'gamma22',
    'gamma28',
    'smpte170m',
    'smpte240m',
    'linear',
    'log',
    'log_sqrt',
    'iec61966_2_4',
    'bt1361',
    'iec61966_2_1',
    'bt2020_10',
    'bt2020_12',
    'smpte2084',
    'smpte428',
    'arib-std-b67',
  ]);
}
