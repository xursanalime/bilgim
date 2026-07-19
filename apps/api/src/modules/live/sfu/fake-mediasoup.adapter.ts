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
 * One recorded interaction with the fake adapter. Tests assert against
 * the `calls` array to verify that `SfuService` drove the mediasoup
 * port in the right order with the right arguments — this is the
 * substitute for the missing native bindings.
 */
export interface RecordedCall {
  method: keyof MediasoupPort;
  args: unknown[];
}

/**
 * FakeMediasoupAdapter — in-memory `MediasoupPort` impl used by tests.
 *
 *  - Records every call so tests can assert order + arguments.
 *  - Returns deterministic, monotonic ids (`worker_1`, `router_1`, …)
 *    so snapshots are stable.
 *  - Stores stub objects in maps so subsequent calls can validate
 *    referential integrity (e.g. "transportId must exist before
 *    `connectTransport`").
 *  - Idempotent close — matches the real adapter's contract.
 *
 * The fake is intentionally not in `__mocks__/` because we want
 * production code (e.g. a future local-dev harness) to be able to
 * import it too. Keeping it under `sfu/` co-locates it with the port
 * it implements.
 */
export class FakeMediasoupAdapter implements MediasoupPort {
  readonly calls: RecordedCall[] = [];

  /** Deterministic counters keyed by resource type. */
  private seq = {
    worker: 0,
    router: 0,
    transport: 0,
    producer: 0,
    consumer: 0,
  };

  /** Stub object stores so we can fail fast on dangling ids. */
  private readonly workers = new Set<string>();
  private readonly routers = new Map<string, string /* workerId */>();
  private readonly transports = new Map<string, string /* routerId */>();
  private readonly producers = new Map<string, { transportId: string; kind: 'audio' | 'video' }>();
  private readonly closedRouters = new Set<string>();

  /**
   * Optional override hooks — tests use these to simulate failures
   * (e.g. router creation rejecting).
   */
  public failOnCreateWorker = false;
  public failOnCreateRouter = false;
  public failOnCloseRouter = false;

  async createWorker(): Promise<SfuWorkerHandle> {
    this.calls.push({ method: 'createWorker', args: [] });
    if (this.failOnCreateWorker) {
      throw new Error('fake: createWorker failure');
    }
    const n = ++this.seq.worker;
    const id = `worker_${n}`;
    this.workers.add(id);
    return { id, pid: 10000 + n };
  }

  async createRouter(workerId: string): Promise<SfuRouterHandle> {
    this.calls.push({ method: 'createRouter', args: [workerId] });
    if (this.failOnCreateRouter) {
      throw new Error('fake: createRouter failure');
    }
    if (!this.workers.has(workerId)) {
      throw new Error(`fake: worker ${workerId} not found`);
    }
    const id = `router_${++this.seq.router}`;
    this.routers.set(id, workerId);
    return {
      id,
      workerId,
      // Minimal stub — tests treat this as opaque.
      rtpCapabilities: { codecs: [], headerExtensions: [] },
    };
  }

  async createWebRtcTransport(
    routerId: string,
    options?: CreateWebRtcTransportOptions,
  ): Promise<SfuWebRtcTransportHandle> {
    this.calls.push({ method: 'createWebRtcTransport', args: [routerId, options] });
    if (!this.routers.has(routerId)) {
      throw new Error(`fake: router ${routerId} not found`);
    }
    const id = `transport_${++this.seq.transport}`;
    this.transports.set(id, routerId);
    return {
      id,
      routerId,
      iceParameters: { usernameFragment: 'u', password: 'p' },
      iceCandidates: [],
      dtlsParameters: { fingerprints: [] },
      sctpParameters: undefined,
    };
  }

  async connectTransport(transportId: string, dtlsParameters: unknown): Promise<void> {
    this.calls.push({ method: 'connectTransport', args: [transportId, dtlsParameters] });
    if (!this.transports.has(transportId)) {
      throw new Error(`fake: transport ${transportId} not found`);
    }
    // No-op — real mediasoup completes the DTLS handshake here.
  }

  async createProducer(
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
  ): Promise<SfuProducerHandle> {
    this.calls.push({
      method: 'createProducer',
      args: [transportId, kind, rtpParameters],
    });
    if (!this.transports.has(transportId)) {
      throw new Error(`fake: transport ${transportId} not found`);
    }
    const id = `producer_${++this.seq.producer}`;
    this.producers.set(id, { transportId, kind });
    return { id, transportId, kind };
  }

  async createConsumer(
    transportId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<SfuConsumerHandle> {
    this.calls.push({
      method: 'createConsumer',
      args: [transportId, producerId, rtpCapabilities],
    });
    if (!this.transports.has(transportId)) {
      throw new Error(`fake: transport ${transportId} not found`);
    }
    const producer = this.producers.get(producerId);
    if (!producer) {
      throw new Error(`fake: producer ${producerId} not found`);
    }
    const id = `consumer_${++this.seq.consumer}`;
    return {
      id,
      transportId,
      producerId,
      kind: producer.kind,
      rtpParameters: { codecs: [], headerExtensions: [] },
      type: 'simple',
      producerPaused: false,
    };
  }

  async resumeConsumer(consumerId: string): Promise<void> {
    // No-op in fake
  }

  async closeRouter(_routerId: string): Promise<void> {
    this.calls.push({ method: 'closeRouter', args: [_routerId] });
    if (this.failOnCloseRouter) {
      throw new Error('fake: closeRouter failure');
    }
    if (!this.routers.has(_routerId)) {
      // Idempotent — closing an unknown router is a no-op (matches the
      // real adapter contract).
      this.closedRouters.add(_routerId);
      return;
    }
    this.routers.delete(_routerId);
    this.closedRouters.add(_routerId);
    // Cascade: drop transports/producers attached to this router.
    for (const [tid, rid] of Array.from(this.transports.entries())) {
      if (rid === _routerId) {
        this.transports.delete(tid);
      }
    }
    for (const [pid, p] of Array.from(this.producers.entries())) {
      if (!this.transports.has(p.transportId)) {
        this.producers.delete(pid);
      }
    }
  }

  // ------------------------------------------------------------------
  // Test-only inspection helpers
  // ------------------------------------------------------------------

  hasRouter(id: string): boolean {
    return this.routers.has(id);
  }

  isRouterClosed(id: string): boolean {
    return this.closedRouters.has(id);
  }

  countCalls(method: keyof MediasoupPort): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}
