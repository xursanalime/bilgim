import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  CreateWebRtcTransportOptions,
  MEDIASOUP_PORT,
  MediasoupPort,
  SfuConsumerHandle,
  SfuProducerHandle,
  SfuRouterHandle,
  SfuWebRtcTransportHandle,
} from './mediasoup.port';

/**
 * In-memory state for one live room. Keyed by `lessonId` inside
 * `SfuService.rooms`.
 *
 * We intentionally keep this in-memory rather than in Redis: a router
 * is bound to a single SFU process (the C++ worker), so the room state
 * only makes sense on the same host that owns the worker. The live
 * gateway's pod-affinity rule ensures all signalling for a given
 * `lessonId` lands on the same instance.
 *
 * If we ever scale to a fleet of SFU pods, this map becomes the index
 * "is this lesson's router on me?" and the discovery layer routes
 * traffic appropriately.
 */
export interface SfuRoom {
  /** Lesson the room belongs to (1:1 with mediasoup router). */
  readonly lessonId: string;
  /** Worker that hosts the router. */
  readonly workerId: string;
  /** Router id returned by the SFU. */
  readonly routerId: string;
  /** Full router handle for clients that need RTP capabilities. */
  readonly router: SfuRouterHandle;
  /** All transports the room has handed out, keyed by transport id. */
  readonly transports: Map<string, SfuWebRtcTransportHandle>;
  /** All producers (teacher uploads), keyed by producer id. */
  readonly producers: Map<string, SfuProducerHandle>;
  /** All consumers (viewer downloads), keyed by consumer id. */
  readonly consumers: Map<string, SfuConsumerHandle>;
  /** Wallclock when `ensureRoomForLesson` first created the router. */
  readonly createdAt: Date;
}

/**
 * Public snapshot returned to callers — a `SfuRoom` minus the mutable
 * `Map`s, so the live gateway / controller can read state without
 * accidentally mutating it.
 */
export interface SfuRoomSnapshot {
  readonly lessonId: string;
  readonly workerId: string;
  readonly routerId: string;
  readonly rtpCapabilities: unknown;
  readonly producerCount: number;
  readonly consumerCount: number;
  readonly transportCount: number;
  readonly createdAt: Date;
}

/**
 * SfuService — high-level orchestrator on top of `MediasoupPort`.
 *
 * Responsibilities:
 *  - Keep in-memory state of which `lessonId` owns which mediasoup
 *    router/worker/transports/producers/consumers (Req 9.1).
 *  - Hand out RTP capabilities so the client can negotiate with the
 *    SFU (Req 9.4: enrolment-gated transport creation lives in
 *    `LiveGateway`, not here).
 *  - Provide idempotent `ensureRoomForLesson` and `closeRoom` so the
 *    `LiveSession` state machine can retry safely (Req 9.6, 9.8).
 *
 * Concurrency note:
 *  - `ensureRoomForLesson` may be called from multiple sockets at once
 *    (teacher + first student joining simultaneously). We dedupe with
 *    a per-lesson promise cache so only one router is ever created per
 *    `lessonId` even under contention. This is the in-process analogue
 *    of the partial-unique constraint that exists in the DB layer.
 */
@Injectable()
export class SfuService {
  private readonly logger = new Logger(SfuService.name);

  /** Mutable room state — one entry per active live lesson. */
  private readonly rooms = new Map<string, SfuRoom>();

  /** In-flight router-creation promises, keyed by lessonId. */
  private readonly pendingEnsures = new Map<string, Promise<SfuRoom>>();

  /**
   * Worker pool. The first call to `ensureRoomForLesson` lazily spawns
   * a worker; subsequent calls reuse it round-robin. mediasoup's own
   * docs recommend ~250 consumers per worker, so for v1 a single
   * worker per pod is enough — we leave the array open for future
   * fan-out without changing the public API.
   */
  private readonly workers: string[] = [];
  private nextWorkerIndex = 0;

  constructor(
    @Inject(MEDIASOUP_PORT) private readonly port: MediasoupPort,
  ) {}

  // ------------------------------------------------------------------
  // Room lifecycle
  // ------------------------------------------------------------------

  /**
   * Ensure a router exists for `lessonId`. If a room already exists,
   * returns it; otherwise creates a worker (if needed), a router, and
   * caches the result.
   *
   * Idempotent under concurrency — multiple callers awaiting on the
   * same lesson share the same in-flight promise (Req 9.1, 9.2).
   */
  async ensureRoomForLesson(lessonId: string): Promise<SfuRoomSnapshot> {
    const room = await this.ensureRoomInternal(lessonId);
    return this.toSnapshot(room);
  }

  /**
   * Read-only accessor. Returns `null` if no room exists yet.
   */
  getRoomForLesson(lessonId: string): SfuRoomSnapshot | null {
    const room = this.rooms.get(lessonId);
    return room ? this.toSnapshot(room) : null;
  }

  /**
   * Close the room for a lesson. Idempotent — closing a non-existent
   * room is a no-op so `LiveModule.endSession` can retry safely
   * (Req 9.5, 9.6, 9.8).
   */
  async closeRoom(lessonId: string): Promise<void> {
    const room = this.rooms.get(lessonId);
    if (!room) {
      return;
    }
    try {
      await this.port.closeRouter(room.routerId);
    } catch (err) {
      // We log but don't rethrow — the live session must always reach
      // a terminal state (Req 9.8). Logging gives ops a signal to
      // investigate rather than silently leaking.
      this.logger.warn(
        `closeRouter failed for lesson ${lessonId}: ${(err as Error).message}`,
      );
    }
    this.rooms.delete(lessonId);
  }

  // ------------------------------------------------------------------
  // Transport / Producer / Consumer
  // ------------------------------------------------------------------

  /**
   * Create a WebRTC transport on the lesson's router. Caller is
   * responsible for handing the returned ICE/DTLS params back to the
   * client.
   */
  async createTransport(
    lessonId: string,
    options?: CreateWebRtcTransportOptions,
  ): Promise<SfuWebRtcTransportHandle> {
    const room = this.requireRoom(lessonId);
    const transport = await this.port.createWebRtcTransport(
      room.routerId,
      options,
    );
    room.transports.set(transport.id, transport);
    return transport;
  }

  /**
   * Complete the DTLS handshake for a transport that was previously
   * created via `createTransport`.
   */
  async connectTransport(
    lessonId: string,
    transportId: string,
    dtlsParameters: unknown,
  ): Promise<void> {
    const room = this.requireRoom(lessonId);
    if (!room.transports.has(transportId)) {
      throw new NotFoundException({
        code: 'SFU_TRANSPORT_NOT_FOUND',
        message: `Transport ${transportId} not found in lesson ${lessonId}`,
      });
    }
    await this.port.connectTransport(transportId, dtlsParameters);
  }

  /**
   * Add a Producer (typically the teacher's audio + video tracks).
   *
   * Verifies the producer's transport belongs to the lesson — this
   * blocks a malicious client from attaching media to someone else's
   * room.
   */
  async addProducer(
    lessonId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
  ): Promise<SfuProducerHandle> {
    const room = this.requireRoom(lessonId);
    if (!room.transports.has(transportId)) {
      throw new NotFoundException({
        code: 'SFU_TRANSPORT_NOT_FOUND',
        message: `Transport ${transportId} not found in lesson ${lessonId}`,
      });
    }
    const producer = await this.port.createProducer(
      transportId,
      kind,
      rtpParameters,
    );
    room.producers.set(producer.id, producer);
    return producer;
  }

  /**
   * Add a Consumer for a viewer. The viewer's transport plus the
   * source producer must both belong to this lesson; otherwise we
   * reject with `SFU_TRANSPORT_NOT_FOUND` / `SFU_PRODUCER_NOT_FOUND`.
   */
  async addConsumer(
    lessonId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<SfuConsumerHandle> {
    const room = this.requireRoom(lessonId);
    if (!room.transports.has(transportId)) {
      throw new NotFoundException({
        code: 'SFU_TRANSPORT_NOT_FOUND',
        message: `Transport ${transportId} not found in lesson ${lessonId}`,
      });
    }
    if (!room.producers.has(producerId)) {
      throw new NotFoundException({
        code: 'SFU_PRODUCER_NOT_FOUND',
        message: `Producer ${producerId} not found in lesson ${lessonId}`,
      });
    }
    const consumer = await this.port.createConsumer(
      transportId,
      producerId,
      rtpCapabilities,
    );
    room.consumers.set(consumer.id, consumer);
    return consumer;
  }

  async resumeConsumer(lessonId: string, consumerId: string): Promise<void> {
    const room = this.requireRoom(lessonId);
    if (!room.consumers.has(consumerId)) {
      throw new NotFoundException({
        code: 'SFU_CONSUMER_NOT_FOUND',
        message: `Consumer ${consumerId} not found in lesson ${lessonId}`,
      });
    }
    await this.port.resumeConsumer(consumerId);
  }

    /**
    * Producers currently active in a room. Used by the gateway when a
    ...

   * new viewer joins to spin up consumers for everything in flight.
   */
  listProducers(lessonId: string): SfuProducerHandle[] {
    const room = this.requireRoom(lessonId);
    return Array.from(room.producers.values());
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private requireRoom(lessonId: string): SfuRoom {
    const room = this.rooms.get(lessonId);
    if (!room) {
      throw new ConflictException({
        code: 'SFU_ROOM_NOT_OPEN',
        message: `No active SFU room for lesson ${lessonId}`,
      });
    }
    return room;
  }

  /**
   * Ensure the room, with deduped concurrent calls.
   */
  private async ensureRoomInternal(lessonId: string): Promise<SfuRoom> {
    const existing = this.rooms.get(lessonId);
    if (existing) {
      return existing;
    }
    const inFlight = this.pendingEnsures.get(lessonId);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<SfuRoom> => {
      const workerId = await this.pickWorkerId();
      const router = await this.port.createRouter(workerId);
      const room: SfuRoom = {
        lessonId,
        workerId,
        routerId: router.id,
        router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        createdAt: new Date(),
      };
      this.rooms.set(lessonId, room);
      return room;
    })();

    this.pendingEnsures.set(lessonId, promise);
    try {
      return await promise;
    } finally {
      this.pendingEnsures.delete(lessonId);
    }
  }

  /**
   * Round-robin worker picker. Spawns the first worker on demand so
   * boot time isn't paying the SFU initialisation cost.
   */
  private async pickWorkerId(): Promise<string> {
    if (this.workers.length === 0) {
      const worker = await this.port.createWorker();
      this.workers.push(worker.id);
      return worker.id;
    }
    const id = this.workers[this.nextWorkerIndex % this.workers.length];
    this.nextWorkerIndex += 1;
    if (!id) {
      // Should never happen — the array length check above guarantees
      // an entry exists. The guard is here purely to satisfy
      // `noUncheckedIndexedAccess`.
      throw new Error('SFU worker pool is empty after pick');
    }
    return id;
  }

  private toSnapshot(room: SfuRoom): SfuRoomSnapshot {
    return {
      lessonId: room.lessonId,
      workerId: room.workerId,
      routerId: room.routerId,
      rtpCapabilities: room.router.rtpCapabilities,
      producerCount: room.producers.size,
      consumerCount: room.consumers.size,
      transportCount: room.transports.size,
      createdAt: room.createdAt,
    };
  }
}
