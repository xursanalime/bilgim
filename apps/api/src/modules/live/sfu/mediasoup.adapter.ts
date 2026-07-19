import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import {
  CreateWebRtcTransportOptions,
  MediasoupPort,
  SfuConsumerHandle,
  SfuProducerHandle,
  SfuRouterHandle,
  SfuWebRtcTransportHandle,
  SfuWorkerHandle,
} from './mediasoup.port';

/**
 * MediasoupAdapter — production implementation of `MediasoupPort` that
 * wraps the `mediasoup` npm package.
 *
 * Why lazy-require?
 *  - `mediasoup` ships a prebuilt C++ worker binary. In some test /
 *    CI environments that binary cannot be loaded (for example, jest's
 *    sandbox or musl-only containers without the prebuilt asset). The
 *    `MediaSoupModule` in those environments wires the fake adapter in
 *    place, so this file's `require('mediasoup')` MUST never run at
 *    import time — only inside `createWorker`.
 *  - Lazy-require also defers the worker-binary download until the
 *    first live session starts, keeping API cold-start time predictable.
 *
 * Internal state:
 *  - `workers` / `routers` / `transports` / `producers` / `consumers`
 *    maps store the live mediasoup objects keyed by their id. We only
 *    expose ids and serializable parameter blobs through the port —
 *    never the raw mediasoup object. This boundary is what lets the
 *    rest of the system stay test-friendly.
 */
@Injectable()
export class MediasoupAdapter implements MediasoupPort, OnModuleDestroy {
  private readonly logger = new Logger(MediasoupAdapter.name);

  /** Lazily-loaded mediasoup module reference. Populated on first use. */
  // We keep this typed as `any` because importing the real `mediasoup`
  // type at module load time would defeat the lazy-require above; the
  // adapter is the only place in the codebase that should know the
  // concrete shape of these objects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mediasoup: any | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly workers = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly routers = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly transports = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly producers = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly consumers = new Map<string, any>();

  /** Stable id we attach to each worker (mediasoup uses pid which can collide across restarts). */
  private workerSeq = 0;

  constructor(private readonly config: ConfigService) {}

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async onModuleDestroy(): Promise<void> {
    // On graceful shutdown, close every worker. mediasoup cascades the
    // close down to routers/transports/producers/consumers — we just
    // need to release the C++ subprocesses.
    for (const [id, worker] of this.workers) {
      try {
        await worker.close();
      } catch (err) {
        this.logger.warn(
          `Failed to close mediasoup worker ${id}: ${(err as Error).message}`,
        );
      }
    }
    this.workers.clear();
    this.routers.clear();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }

  // ------------------------------------------------------------------
  // MediasoupPort impl
  // ------------------------------------------------------------------

  async createWorker(): Promise<SfuWorkerHandle> {
    const ms = this.loadMediasoup();
    const rtcMinPort = Number(this.config.get('SFU_RTC_PORT_MIN') ?? 40000);
    const rtcMaxPort = Number(this.config.get('SFU_RTC_PORT_MAX') ?? 40100);

    const worker = await ms.createWorker({
      logLevel: 'warn',
      rtcMinPort,
      rtcMaxPort,
    });

    const id = `worker_${++this.workerSeq}`;
    this.workers.set(id, worker);

    // If the worker dies (mediasoup's recommended pattern), drop it
    // from our map so callers see a clean error on next use rather
    // than silently re-using a dead handle.
    worker.on('died', (err: Error) => {
      this.logger.error(
        `mediasoup worker ${id} died (${err?.message ?? 'unknown'})`,
      );
      this.workers.delete(id);
    });

    return { id, pid: worker.pid };
  }

  async createRouter(workerId: string): Promise<SfuRouterHandle> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`SFU worker ${workerId} not found`);
    }

    // Default mediaCodecs cover the common audio/video use cases for
    // a teacher-broadcast scenario. SVC / advanced codecs can be added
    // later without changing the port surface.
    const router = await worker.createRouter({
      mediaCodecs: this.getDefaultMediaCodecs(),
    });

    const id = router.id ?? `router_${randomUUID()}`;
    this.routers.set(id, router);
    return {
      id,
      workerId,
      rtpCapabilities: router.rtpCapabilities,
    };
  }

  async createWebRtcTransport(
    routerId: string,
    options: CreateWebRtcTransportOptions = {},
  ): Promise<SfuWebRtcTransportHandle> {
    const router = this.routers.get(routerId);
    if (!router) {
      throw new Error(`SFU router ${routerId} not found`);
    }

    const announcedIp = String(
      this.config.get('SFU_ANNOUNCED_IP') ?? '127.0.0.1',
    );
    const transport = await router.createWebRtcTransport({
      listenIps:
        options.listenIps && options.listenIps.length > 0
          ? options.listenIps
          : [{ ip: '0.0.0.0', announcedIp }],
      enableUdp: options.enableUdp ?? true,
      enableTcp: options.enableTcp ?? true,
      preferUdp: options.preferUdp ?? true,
      initialAvailableOutgoingBitrate:
        options.initialAvailableOutgoingBitrate ?? 1_000_000,
      appData: options.appData ?? {},
    });

    const id = transport.id ?? `transport_${randomUUID()}`;
    this.transports.set(id, transport);

    return {
      id,
      routerId,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  async connectTransport(
    transportId: string,
    dtlsParameters: unknown,
  ): Promise<void> {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`SFU transport ${transportId} not found`);
    }
    // mediasoup is idempotent here: a second `connect` with the same
    // params is a no-op, with different params throws — that's the
    // behaviour we want callers to see.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await transport.connect({ dtlsParameters: dtlsParameters as any });
  }

  async createProducer(
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
  ): Promise<SfuProducerHandle> {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`SFU transport ${transportId} not found`);
    }
    const producer = await transport.produce({
      kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rtpParameters: rtpParameters as any,
    });
    const id = producer.id ?? `producer_${randomUUID()}`;
    this.producers.set(id, producer);
    return { id, transportId, kind };
  }

  async createConsumer(
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<SfuConsumerHandle> {
    const transport = this.transports.get(transportId);
    if (!transport) {
      throw new Error(`SFU transport ${transportId} not found`);
    }
    if (!this.producers.has(producerId)) {
      throw new Error(`SFU producer ${producerId} not found`);
    }
    const consumer = await transport.consume({
      producerId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rtpCapabilities: rtpCapabilities as any,
      // We start consumers paused so the client has a chance to bind
      // its <video> element before media starts flowing — standard
      // mediasoup pattern.
      paused: true,
    });
    const id = consumer.id ?? `consumer_${randomUUID()}`;
    this.consumers.set(id, consumer);
    return {
      id: consumer.id,
      transportId,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    };
    }

    async resumeConsumer(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) return;
    await consumer.resume();
    }

    async closeRouter(routerId: string): Promise<void> {

    const router = this.routers.get(routerId);
    if (!router) {
      // Idempotent — calling close on an unknown router is a no-op.
      return;
    }
    try {
      await router.close();
    } catch (err) {
      this.logger.warn(
        `mediasoup router ${routerId} close raised: ${(err as Error).message}`,
      );
    }
    this.routers.delete(routerId);

    // mediasoup cascades close to children, so prune our local maps too.
    for (const [tid, t] of this.transports) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((t as any).router?.id === routerId || (t as any).routerId === routerId) {
        this.transports.delete(tid);
      }
    }
    for (const [pid, p] of this.producers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((p as any).closed) {
        this.producers.delete(pid);
      }
    }
    for (const [cid, c] of this.consumers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((c as any).closed) {
        this.consumers.delete(cid);
      }
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Lazily load the `mediasoup` package. Throws a clear error if the
   * native bindings are unavailable so the operator can fall back to
   * the test fake or fix the host.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private loadMediasoup(): any {
    if (this.mediasoup) {
      return this.mediasoup;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      this.mediasoup = require('mediasoup');
      return this.mediasoup;
    } catch (err) {
      throw new Error(
        `mediasoup native bindings unavailable: ${(err as Error).message}. ` +
          'Use the in-memory fake adapter for tests or install the prebuilt ' +
          'mediasoup-worker for this platform.',
      );
    }
  }

  /**
   * Default media codecs for new routers. Opus + VP8 + H264 covers the
   * mainstream browser matrix without negotiating SVC. Tuned per the
   * mediasoup official examples.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDefaultMediaCodecs(): any[] {
    return [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ];
  }
}
