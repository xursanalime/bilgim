import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { FakeMediasoupAdapter } from './fake-mediasoup.adapter';
import { MEDIASOUP_PORT } from './mediasoup.port';
import { SfuService } from './sfu.service';

/**
 * Unit tests for `SfuService` — exercises the high-level SFU
 * orchestration end-to-end without ever touching the mediasoup native
 * bindings. The fake `FakeMediasoupAdapter` records every call so we
 * can assert ordering + arguments.
 *
 * Requirements covered:
 *  - 9.1: `ensureRoomForLesson` allocates router + worker on first use
 *  - 9.2: enrolment-gating happens at higher layers; this layer only
 *    enforces transport/producer/lesson identity (negative tests below)
 *  - 9.3: `addProducer`/`addConsumer` route through the right transport
 *  - 9.5/9.6/9.8: `closeRoom` is idempotent and never leaves the room
 *    in a half-open state
 */
describe('SfuService', () => {
  let service: SfuService;
  let fake: FakeMediasoupAdapter;

  beforeEach(async () => {
    fake = new FakeMediasoupAdapter();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SfuService,
        { provide: MEDIASOUP_PORT, useValue: fake },
      ],
    }).compile();
    service = moduleRef.get(SfuService);
  });

  // ------------------------------------------------------------------
  // ensureRoomForLesson
  // ------------------------------------------------------------------

  describe('ensureRoomForLesson', () => {
    it('creates a worker and router on first call (Req 9.1)', async () => {
      const room = await service.ensureRoomForLesson('lesson-1');

      expect(room.lessonId).toBe('lesson-1');
      expect(room.workerId).toBe('worker_1');
      expect(room.routerId).toBe('router_1');
      expect(room.producerCount).toBe(0);
      expect(room.consumerCount).toBe(0);
      expect(room.transportCount).toBe(0);
      expect(room.rtpCapabilities).toBeDefined();

      // Exactly one worker + one router were created.
      expect(fake.countCalls('createWorker')).toBe(1);
      expect(fake.countCalls('createRouter')).toBe(1);
    });

    it('returns the cached room on repeated calls (Req 9.1)', async () => {
      const a = await service.ensureRoomForLesson('lesson-1');
      const b = await service.ensureRoomForLesson('lesson-1');

      expect(a.routerId).toBe(b.routerId);
      // No second worker / router was provisioned.
      expect(fake.countCalls('createWorker')).toBe(1);
      expect(fake.countCalls('createRouter')).toBe(1);
    });

    it('reuses the existing worker for a second lesson', async () => {
      const a = await service.ensureRoomForLesson('lesson-1');
      const b = await service.ensureRoomForLesson('lesson-2');

      expect(a.workerId).toBe(b.workerId);
      expect(a.routerId).not.toBe(b.routerId);
      expect(fake.countCalls('createWorker')).toBe(1);
      expect(fake.countCalls('createRouter')).toBe(2);
    });

    it('dedupes concurrent calls for the same lesson', async () => {
      // Fire two concurrent ensures for the same lesson — only one
      // router should be created.
      const [a, b] = await Promise.all([
        service.ensureRoomForLesson('lesson-1'),
        service.ensureRoomForLesson('lesson-1'),
      ]);
      expect(a.routerId).toBe(b.routerId);
      expect(fake.countCalls('createRouter')).toBe(1);
    });

    it('propagates worker creation failures', async () => {
      fake.failOnCreateWorker = true;
      await expect(service.ensureRoomForLesson('lesson-1')).rejects.toThrow(
        /createWorker failure/,
      );
      // No router should exist after the failure.
      expect(fake.countCalls('createRouter')).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // getRoomForLesson
  // ------------------------------------------------------------------

  describe('getRoomForLesson', () => {
    it('returns null when no room is active', () => {
      expect(service.getRoomForLesson('lesson-x')).toBeNull();
    });

    it('returns the snapshot once the room is open', async () => {
      await service.ensureRoomForLesson('lesson-1');
      const snap = service.getRoomForLesson('lesson-1');
      expect(snap?.routerId).toBe('router_1');
    });
  });

  // ------------------------------------------------------------------
  // Transports / Producers / Consumers
  // ------------------------------------------------------------------

  describe('transports / producers / consumers', () => {
    beforeEach(async () => {
      await service.ensureRoomForLesson('lesson-1');
    });

    it('createTransport binds to the lesson router', async () => {
      const t = await service.createTransport('lesson-1');
      expect(t.routerId).toBe('router_1');
      expect(t.id).toBe('transport_1');

      const snap = service.getRoomForLesson('lesson-1');
      expect(snap?.transportCount).toBe(1);
    });

    it('createTransport rejects when the room is not open', async () => {
      await expect(service.createTransport('lesson-unknown')).rejects.toThrow(
        ConflictException,
      );
    });

    it('connectTransport requires a known transport', async () => {
      await expect(
        service.connectTransport('lesson-1', 'transport_999', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('addProducer registers the producer on the room (Req 9.3)', async () => {
      const t = await service.createTransport('lesson-1');
      const p = await service.addProducer('lesson-1', t.id, 'video', {
        codecs: [],
      });

      expect(p.transportId).toBe(t.id);
      expect(p.kind).toBe('video');

      const snap = service.getRoomForLesson('lesson-1');
      expect(snap?.producerCount).toBe(1);
      expect(service.listProducers('lesson-1')).toHaveLength(1);
    });

    it('addProducer rejects a transport that does not belong to the lesson', async () => {
      // Create transport on lesson-1, then try to use it on lesson-2.
      const t = await service.createTransport('lesson-1');
      await service.ensureRoomForLesson('lesson-2');
      await expect(
        service.addProducer('lesson-2', t.id, 'video', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('addConsumer wires producer → transport (Req 9.3)', async () => {
      const teacherTransport = await service.createTransport('lesson-1');
      const producer = await service.addProducer(
        'lesson-1',
        teacherTransport.id,
        'video',
        {},
      );
      const studentTransport = await service.createTransport('lesson-1');
      const consumer = await service.addConsumer(
        'lesson-1',
        studentTransport.id,
        producer.id,
        { codecs: [] },
      );
      expect(consumer.producerId).toBe(producer.id);
      expect(consumer.transportId).toBe(studentTransport.id);
      expect(consumer.kind).toBe('video');

      const snap = service.getRoomForLesson('lesson-1');
      expect(snap?.consumerCount).toBe(1);
    });

    it('addConsumer rejects unknown producer', async () => {
      const studentTransport = await service.createTransport('lesson-1');
      await expect(
        service.addConsumer(
          'lesson-1',
          studentTransport.id,
          'producer_999',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  // closeRoom
  // ------------------------------------------------------------------

  describe('closeRoom', () => {
    it('closes the router and clears state (Req 9.5, 9.6)', async () => {
      await service.ensureRoomForLesson('lesson-1');
      await service.closeRoom('lesson-1');

      expect(service.getRoomForLesson('lesson-1')).toBeNull();
      expect(fake.countCalls('closeRouter')).toBe(1);
      expect(fake.isRouterClosed('router_1')).toBe(true);
    });

    it('is idempotent for unknown lessons (Req 9.8)', async () => {
      await expect(service.closeRoom('lesson-x')).resolves.toBeUndefined();
      expect(fake.countCalls('closeRouter')).toBe(0);
    });

    it('still removes room state when closeRouter throws (Req 9.8)', async () => {
      await service.ensureRoomForLesson('lesson-1');
      fake.failOnCloseRouter = true;
      await expect(service.closeRoom('lesson-1')).resolves.toBeUndefined();
      expect(service.getRoomForLesson('lesson-1')).toBeNull();
    });

    it('a re-opened lesson allocates a fresh router', async () => {
      await service.ensureRoomForLesson('lesson-1');
      await service.closeRoom('lesson-1');

      const snap = await service.ensureRoomForLesson('lesson-1');
      expect(snap.routerId).toBe('router_2');
      // Worker is reused.
      expect(fake.countCalls('createWorker')).toBe(1);
      expect(fake.countCalls('createRouter')).toBe(2);
    });
  });

  // ------------------------------------------------------------------
  // Call ordering — happy path
  // ------------------------------------------------------------------

  it('drives the port in the documented order on a full session', async () => {
    await service.ensureRoomForLesson('lesson-1');
    const teacherT = await service.createTransport('lesson-1');
    await service.connectTransport('lesson-1', teacherT.id, {
      fingerprints: [],
    });
    const producer = await service.addProducer(
      'lesson-1',
      teacherT.id,
      'video',
      {},
    );
    const studentT = await service.createTransport('lesson-1');
    await service.connectTransport('lesson-1', studentT.id, {
      fingerprints: [],
    });
    await service.addConsumer('lesson-1', studentT.id, producer.id, {});
    await service.closeRoom('lesson-1');

    const methods = fake.calls.map((c) => c.method);
    expect(methods).toEqual([
      'createWorker',
      'createRouter',
      'createWebRtcTransport',
      'connectTransport',
      'createProducer',
      'createWebRtcTransport',
      'connectTransport',
      'createConsumer',
      'closeRouter',
    ]);
  });
});
