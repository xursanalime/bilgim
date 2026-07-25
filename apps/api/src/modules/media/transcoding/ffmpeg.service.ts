import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import {
  HlsVariant,
  HLS_SEGMENT_DURATION_SECONDS,
  HLS_VARIANT_PLAYLIST_FILENAME,
} from '../media.types';
import { FfmpegRunner } from './ffmpeg.runner';

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
}

export interface TranscodeVariantInput {
  /** Local path to the source file already downloaded from R2. */
  inputPath: string;
  /** Destination directory for the variant's playlist + .ts segments. */
  outputDir: string;
  /** Variant ladder entry to render. */
  variant: HlsVariant;
}

export interface MasterPlaylistInput {
  /** Variants that successfully rendered. Order is preserved. */
  variants: HlsVariant[];
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
   */
  private static readonly ENCODE_THREAD_COUNT = 2;

  constructor(
    private readonly runner: FfmpegRunner,
    config: ConfigService,
  ) {
    this.ffmpegBinary = config.get<string>('FFMPEG_PATH') ?? 'ffmpeg';
    this.ffprobeBinary = config.get<string>('FFPROBE_PATH') ?? 'ffprobe';
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
      return { durationMs: 0, width: 0, height: 0 };
    }
    return this.parseProbeOutput(result.stdout);
  }

  /**
   * Render a single HLS variant. The output is a self-contained directory
   * containing `index.m3u8` + `seg_*.ts` segment files.
   *
   * Encoding flags:
   *   - `-c:v libx264` — universally supported by HLS.js / Safari.
   *   - `-profile:v main`, `-preset veryfast` — keeps GOPs aligned and
   *     latency reasonable.
   *   - `-b:v` / `-maxrate` / `-bufsize` — capped CBR-ish bitrate to keep
   *     the bandwidth declaration honest.
   *   - `-hls_time {seg}` and `-hls_playlist_type vod` — VOD playlist.
   *   - `-g 2*fps` — keyframe every 2× the segment length (default fps
   *     preserved from input).
   */
  async transcodeVariant(input: TranscodeVariantInput): Promise<void> {
    const { variant, inputPath, outputDir } = input;
    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, HLS_VARIANT_PLAYLIST_FILENAME);
    const segmentPattern = path.join(outputDir, 'seg_%03d.ts');

    const videoBitrate = `${variant.videoBitrateKbps}k`;
    const audioBitrate = `${variant.audioBitrateKbps}k`;
    const maxRate = `${Math.round(variant.videoBitrateKbps * 1.07)}k`;
    const bufSize = `${variant.videoBitrateKbps * 2}k`;

    const args = [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `scale=w=${variant.width}:h=${variant.height}:force_original_aspect_ratio=decrease,pad=${variant.width}:${variant.height}:(ow-iw)/2:(oh-ih)/2`,
      '-c:v',
      'libx264',
      '-threads',
      String(FfmpegService.ENCODE_THREAD_COUNT),
      '-profile:v',
      'main',
      '-preset',
      'veryfast',
      '-b:v',
      videoBitrate,
      '-maxrate',
      maxRate,
      '-bufsize',
      bufSize,
      '-c:a',
      'aac',
      '-b:a',
      audioBitrate,
      '-ac',
      '2',
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
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${v.width}x${v.height},CODECS="avc1.4d401f,mp4a.40.2"`,
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

  /** Last 4KiB of an ffmpeg log — keeps error messages bounded. */
  private tail(s: string): string {
    if (s.length <= 4096) return s;
    return `…${s.slice(s.length - 4096)}`;
  }

  /**
   * Extract `durationMs`, width and height from ffprobe JSON output.
   * Tolerant of partial / missing fields; never throws.
   */
  private parseProbeOutput(stdout: string): VideoProbeResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return { durationMs: 0, width: 0, height: 0 };
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

    return { durationMs, width, height };
  }
}
