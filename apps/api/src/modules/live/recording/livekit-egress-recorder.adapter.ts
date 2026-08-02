import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EgressClient,
  EgressInfo,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  S3Upload,
} from 'livekit-server-sdk';

import {
  FinalizeRecordingInput,
  FinalizeRecordingResult,
  RecorderPort,
  StartRecordingInput,
  StartRecordingResult,
} from './recorder.port';

/** How often to re-poll `listEgress` while waiting for a terminal status. */
const POLL_INTERVAL_MS = 2_000;
/**
 * Max time to wait for egress to reach a terminal status during finalize.
 * `LiveService.endSession` deletes the LiveKit room right after emitting
 * `live.ended`, which causes the egress service to auto-stop the
 * room-composite recording — by the time this runs (routed through the
 * outbox poller + BullMQ) the egress is almost always already COMPLETE.
 * This bound only covers the rare case where muxing/upload is still
 * finishing.
 */
const FINALIZE_POLL_TIMEOUT_MS = 30_000;
/** `FileInfo.duration` is reported in nanoseconds. */
const NS_PER_MS = 1_000_000;

const NON_TERMINAL_STATUSES = new Set<EgressStatus>([
  EgressStatus.EGRESS_STARTING,
  EgressStatus.EGRESS_ACTIVE,
  EgressStatus.EGRESS_ENDING,
]);

/**
 * LiveKitEgressRecorderAdapter — production `RecorderPort` backed by
 * LiveKit's Room Composite Egress.
 *
 * The live SFU is LiveKit (see `sfu/livekit.service.ts`), so recording
 * is implemented via LiveKit's own Egress API rather than a raw
 * mediasoup/ffmpeg pipeline:
 *
 *  - `startRecording` starts a room-composite egress (full room video +
 *    audio, matching what viewers see) that streams its MP4 output
 *    directly to the R2 bucket via egress's built-in S3-compatible
 *    upload target. The `egressId` is persisted as `recorderRef`.
 *  - `finalizeRecording` stops the egress (idempotent — a no-op if it
 *    already stopped when the room closed) and polls `listEgress` until
 *    it reaches a terminal status, then reports the uploaded object key
 *    + size + duration back to `RecordingService`.
 */
@Injectable()
export class LiveKitEgressRecorderAdapter implements RecorderPort {
  private readonly logger = new Logger(LiveKitEgressRecorderAdapter.name);
  private readonly egressClient: EgressClient;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const livekitUrl = this.configService.get<string>('LIVEKIT_API_URL', 'http://localhost:7880');
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY', 'devkey');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET', 'secret');

    this.egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
    this.bucket = this.configService.get<string>('R2_BUCKET_NAME') ?? 'edubridge-media';
  }

  async startRecording(input: StartRecordingInput): Promise<StartRecordingResult> {
    // Idempotency: if an egress is already running for this room (e.g. a
    // retried `live.started` job), reuse it instead of starting a
    // duplicate recording.
    const active = await this.egressClient.listEgress({ roomName: input.roomId, active: true });
    const running = active.find((e) => NON_TERMINAL_STATUSES.has(e.status));
    if (running) {
      this.logger.debug(
        `startRecording: reusing active egress ${running.egressId} for room=${input.roomId} session=${input.sessionId}`,
      );
      return { recorderRef: running.egressId };
    }

    const filepath = this.buildObjectKey(input.lessonId, input.sessionId);
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: { case: 's3', value: this.buildS3Upload() },
    });

    const info = await this.egressClient.startRoomCompositeEgress(
      input.roomId,
      { file: output },
      {
        audioOnly: false,
        videoOnly: false,
        // High-quality preset (1920x1080, 30fps, 4500kbps) — matches the
        // room's own capture default (see LiveRoom.tsx's videoCaptureDefaults).
        encodingOptions: EncodingOptionsPreset.H264_1080P_30,
        // LiveKit's default recorder template (unset `layout`) uses an
        // even grid, giving screen share the same small tile as every
        // camera. `speaker` instead auto-promotes any active screen-share
        // track to the main view (falling back to the active speaker when
        // no one is sharing) — the right default for a lesson recording,
        // where slides/whiteboard content matters more than an equal grid.
        layout: 'speaker',
      },
    );

    this.logger.log(
      `Started room-composite egress ${info.egressId} for session=${input.sessionId} ` +
        `room=${input.roomId} key=${filepath}`,
    );
    return { recorderRef: info.egressId };
  }

  async finalizeRecording(input: FinalizeRecordingInput): Promise<FinalizeRecordingResult> {
    const egressId = input.recorderRef;

    let info = await this.fetchEgressInfo(egressId);
    if (!info) {
      return { failure: `egress ${egressId} not found` };
    }

    if (NON_TERMINAL_STATUSES.has(info.status)) {
      try {
        await this.egressClient.stopEgress(egressId);
      } catch (error) {
        // Already stopped (e.g. room close beat us to it) — fine, the
        // poll below will observe the terminal status either way.
        this.logger.debug(
          `finalizeRecording: stopEgress(${egressId}) no-op/failed: ${(error as Error).message}`,
        );
      }
      info = await this.waitForTerminal(egressId);
    }

    if (!info || NON_TERMINAL_STATUSES.has(info.status)) {
      return {
        failure: `egress ${egressId} did not reach a terminal state within ${FINALIZE_POLL_TIMEOUT_MS}ms`,
      };
    }

    if (info.status === EgressStatus.EGRESS_FAILED || info.status === EgressStatus.EGRESS_ABORTED) {
      return { failure: info.error || `egress ${egressId} ended with status ${EgressStatus[info.status]}` };
    }

    const file = info.fileResults[0];
    if (!file || !file.filename) {
      return { failure: `egress ${egressId} completed without a file result` };
    }

    return {
      uploadedKey: file.filename,
      contentType: 'video/mp4',
      sizeBytes: Number(file.size),
      durationMs: Math.round(Number(file.duration) / NS_PER_MS),
    };
  }

  private async fetchEgressInfo(egressId: string): Promise<EgressInfo | null> {
    const results = await this.egressClient.listEgress({ egressId });
    return results[0] ?? null;
  }

  private async waitForTerminal(
    egressId: string,
    timeoutMs: number = FINALIZE_POLL_TIMEOUT_MS,
  ): Promise<EgressInfo | null> {
    const deadline = Date.now() + timeoutMs;
    let info = await this.fetchEgressInfo(egressId);
    while (info && NON_TERMINAL_STATUSES.has(info.status) && Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      info = await this.fetchEgressInfo(egressId);
    }
    return info;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mirrors `R2Service`'s credential resolution so egress uploads land in
   * the same bucket. Endpoint prefers `R2_EGRESS_URL` — the Egress
   * *container's* view of the storage endpoint, which differs from
   * `R2_PUBLIC_URL` (the API-process/host view) in local dev where Egress
   * runs inside the Compose network (see env.schema.ts for why).
   */
  private buildS3Upload(): S3Upload {
    const accountId = this.configService.get<string>('R2_ACCOUNT_ID') ?? 'local-dev';
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID') ?? 'local-dev';
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY') ?? 'local-dev';
    const overrideEndpoint =
      this.configService.get<string>('R2_EGRESS_URL') ??
      this.configService.get<string>('R2_PUBLIC_URL');
    const endpoint =
      overrideEndpoint && overrideEndpoint.length > 0
        ? overrideEndpoint
        : `https://${accountId}.r2.cloudflarestorage.com`;

    return new S3Upload({
      accessKey: accessKeyId,
      secret: secretAccessKey,
      bucket: this.bucket,
      endpoint,
      region: 'auto',
      forcePathStyle: true,
    });
  }

  /**
   * Deterministic R2 object key for a session's recording. Mirrors
   * `MediaService.buildObjectKey`'s `media/{...}/{yyyy}/{mm}/...` shape
   * so live recordings live alongside uploaded media.
   */
  private buildObjectKey(lessonId: string, sessionId: string): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `media/live-recordings/${lessonId}/${year}/${month}/${sessionId}.mp4`;
  }
}
