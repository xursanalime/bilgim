/**
 * MediasoupPort — a thin port (interface) that abstracts the mediasoup
 * native bindings so the rest of the live-streaming code can be tested
 * without spawning the C++ worker.
 *
 * Why a port?
 *  - mediasoup ships a prebuilt native worker binary; the bindings cannot
 *    run inside a unit-test sandbox (no UDP, no fork, no native libs in
 *    some CI images). Tests must use a fake.
 *  - Keeping the boundary narrow (Worker → Router → Transport → Producer
 *    → Consumer) lets us swap in a deterministic fake while exercising
 *    `SfuService` end-to-end (Req 9.1, 9.2, 9.3).
 *
 * Design rules:
 *  1. **Identifiers, not objects.** Every method accepts/returns string
 *     ids. The adapter holds the live mediasoup objects in private
 *     `Map`s keyed by id; consumers never see the raw bindings. This
 *     keeps the port serializable and makes the in-memory room state in
 *     `SfuService` trivially serialisable too.
 *  2. **Loosely-typed payloads.** `rtpCapabilities`, `rtpParameters`,
 *     `dtlsParameters`, `iceCandidates`, etc. are typed as `unknown`
 *     here. The adapter forwards them as-is to mediasoup. The live
 *     gateway is responsible for relaying these blobs to/from the
 *     mediasoup-client running in the browser. Treating them as opaque
 *     means the port never needs to be regenerated when mediasoup adds
 *     a new field.
 *  3. **Async everywhere.** Even bookkeeping operations are async so
 *     swapping in a remote SFU (e.g. process-isolated worker) later is
 *     a non-event.
 */

/** Worker handle — one mediasoup C++ subprocess. */
export interface SfuWorkerHandle {
  /** mediasoup-assigned pid (real adapter) or stable monotonic id (fake). */
  readonly pid: number;
  /** Stable identifier the rest of the system uses to refer to this worker. */
  readonly id: string;
}

/** Router handle — one isolated RTP routing context (one room). */
export interface SfuRouterHandle {
  readonly id: string;
  readonly workerId: string;
  /** Capabilities the client must echo when creating Producers/Consumers. */
  readonly rtpCapabilities: unknown;
}

/** WebRTC transport handle — one ICE+DTLS pipe to a single endpoint. */
export interface SfuWebRtcTransportHandle {
  readonly id: string;
  readonly routerId: string;
  /** Sent to the client to bootstrap mediasoup-client's transport. */
  readonly iceParameters: unknown;
  readonly iceCandidates: unknown;
  readonly dtlsParameters: unknown;
  /** Optional SCTP — we never use DataChannel in this app but the
   * client lib may inspect it. The adapter passes whatever mediasoup
   * returned, which is `undefined` when SCTP is disabled. */
  readonly sctpParameters?: unknown;
}

/** Producer handle — one inbound media stream from a teacher (or, rarely, a student). */
export interface SfuProducerHandle {
  readonly id: string;
  readonly transportId: string;
  readonly kind: 'audio' | 'video';
}

/** Consumer handle — one outbound media stream forwarded to a viewer. */
export interface SfuConsumerHandle {
  readonly id: string;
  readonly transportId: string;
  readonly producerId: string;
  readonly kind: 'audio' | 'video';
  /** RTP params the client passes back to mediasoup-client `consume()`. */
  readonly rtpParameters: unknown;
  /** mediasoup consumer.type — 'simple' | 'simulcast' | 'svc'. */
  readonly type: string;
  /** Whether the upstream producer is currently paused — the client
   * usually mirrors this state until it receives the first packet. */
  readonly producerPaused: boolean;
}

/**
 * Options for `createWebRtcTransport`. Names mirror mediasoup's
 * `Router.createWebRtcTransport` so the adapter can pass them through
 * directly. Keep this list short — anything we don't actively need is
 * left to mediasoup defaults to avoid a churn-y interface.
 */
export interface CreateWebRtcTransportOptions {
  /** Public IPs / announced IP pairs used for SDP candidates. Defaults
   * are read from env (`SFU_ANNOUNCED_IP`) by the adapter when omitted. */
  listenIps?: ReadonlyArray<{ ip: string; announcedIp?: string }>;
  enableUdp?: boolean;
  enableTcp?: boolean;
  preferUdp?: boolean;
  /** Initial bitrate for the transport's adaptive bitrate logic. */
  initialAvailableOutgoingBitrate?: number;
  /** Free-form metadata stored on the transport's `appData`. */
  appData?: Record<string, unknown>;
}

/**
 * MediasoupPort — the contract every SFU implementation (real or fake)
 * must satisfy.
 *
 * Lifecycle assumed by `SfuService`:
 *
 *   createWorker
 *      └─ createRouter            (one per lesson room)
 *           ├─ createWebRtcTransport (per peer, per direction)
 *           │    ├─ connectTransport
 *           │    ├─ createProducer
 *           │    └─ createConsumer
 *           └─ closeRouter           (room teardown)
 *
 * All methods are idempotent in the sense that closing an already-closed
 * resource is not an error — implementations should swallow such calls.
 * That guarantees `SfuService.closeRoom(lessonId)` can be retried.
 */
export interface MediasoupPort {
  /**
   * Spawn a mediasoup worker. The real adapter starts a C++ subprocess
   * with the configured RTC port range; the fake just hands back an
   * incrementing id.
   */
  createWorker(): Promise<SfuWorkerHandle>;

  /**
   * Create a router (room) on the given worker.
   * @throws if `workerId` is unknown.
   */
  createRouter(workerId: string): Promise<SfuRouterHandle>;

  /**
   * Create a WebRTC transport on the given router.
   * @throws if `routerId` is unknown.
   */
  createWebRtcTransport(
    routerId: string,
    options?: CreateWebRtcTransportOptions,
  ): Promise<SfuWebRtcTransportHandle>;

  /**
   * Complete the DTLS handshake on a transport. Called after the client
   * has sent its DTLS fingerprint via `transport.dtlsParameters`.
   * @throws if `transportId` is unknown.
   */
  connectTransport(
    transportId: string,
    dtlsParameters: unknown,
  ): Promise<void>;

  /**
   * Create a Producer on a transport. The teacher's UI calls this once
   * per local track (audio + video). Mediasoup hands us back the
   * server-side producer id which we must broadcast to consumers.
   */
  createProducer(
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
  ): Promise<SfuProducerHandle>;

  /**
   * Create a Consumer on a transport. Each viewer creates a Consumer
   * per Producer they want to receive. The returned `rtpParameters`
   * are sent back to the client so it can build its local mediasoup
   * Consumer.
   */
  createConsumer(
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<SfuConsumerHandle>;
/**
 * Resume a consumer that was started in the paused state.
 */
resumeConsumer(consumerId: string): Promise<void>;

/**
 * Close the router. All children (transports, producers, consumers)
...

   * are closed by mediasoup as a side-effect — the adapter mirrors
   * that behaviour by purging its internal maps.
   *
   * MUST be idempotent — calling on an already-closed router is a
   * no-op so `SfuService.closeRoom` can retry safely.
   */
  closeRouter(routerId: string): Promise<void>;
}

/**
 * DI token for the port. Using a token (string) instead of the
 * interface symbol lets us register it as a Nest provider with
 * `{ provide: MEDIASOUP_PORT, useClass/useValue: ... }`.
 */
export const MEDIASOUP_PORT = Symbol('MediasoupPort');
