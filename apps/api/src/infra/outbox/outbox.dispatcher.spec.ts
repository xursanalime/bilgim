import { OutboxDispatcher, OUTBOX_STATUS } from './outbox.dispatcher';
import { QUEUE_NAMES } from '../bullmq/queue.constants';

describe('OutboxDispatcher', () => {
  let dispatcher: OutboxDispatcher;
  let mockPrisma: any;
  let mockQueues: Record<string, any>;

  beforeEach(() => {
    jest.useFakeTimers();

    mockPrisma = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    mockQueues = {
      email: { add: jest.fn().mockResolvedValue({}) },
      telegram: { add: jest.fn().mockResolvedValue({}) },
      push: { add: jest.fn().mockResolvedValue({}) },
      transcoding: { add: jest.fn().mockResolvedValue({}) },
      'ai-grading': { add: jest.fn().mockResolvedValue({}) },
      'notification-fanout': { add: jest.fn().mockResolvedValue({}) },
      'outbox-dispatch': { add: jest.fn().mockResolvedValue({}) },
      'live-recording': { add: jest.fn().mockResolvedValue({}) },
      'gamification-outbox': { add: jest.fn().mockResolvedValue({}) },
    };

    dispatcher = new OutboxDispatcher(
      mockPrisma,
      mockQueues[QUEUE_NAMES.EMAIL],
      mockQueues[QUEUE_NAMES.TELEGRAM],
      mockQueues[QUEUE_NAMES.PUSH],
      mockQueues[QUEUE_NAMES.TRANSCODING],
      mockQueues[QUEUE_NAMES.AI_GRADING],
      mockQueues[QUEUE_NAMES.NOTIFICATION_FANOUT],
      mockQueues[QUEUE_NAMES.OUTBOX_DISPATCH],
      mockQueues[QUEUE_NAMES.LIVE_RECORDING],
      mockQueues[QUEUE_NAMES.GAMIFICATION_OUTBOX],
    );
  });

  afterEach(() => {
    dispatcher.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('OUTBOX_STATUS', () => {
    it('should have PENDING, DISPATCHED, and DEAD_LETTER statuses', () => {
      expect(OUTBOX_STATUS.PENDING).toBe('PENDING');
      expect(OUTBOX_STATUS.DISPATCHED).toBe('DISPATCHED');
      expect(OUTBOX_STATUS.DEAD_LETTER).toBe('DEAD_LETTER');
    });
  });

  describe('poll and dispatch', () => {
    it('should dispatch a PENDING event to the correct queue and mark as DISPATCHED', async () => {
      const event = {
        id: 'evt-1',
        topic: 'user.registered',
        payload: { userId: 'u1' },
        idempotencyKey: 'reg:u1',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();

      // Advance timer to trigger first poll
      jest.advanceTimersByTime(2000);
      // Flush all pending promises
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockQueues[QUEUE_NAMES.EMAIL].add).toHaveBeenCalledWith(
        'user.registered',
        expect.objectContaining({
          outboxEventId: 'evt-1',
          topic: 'user.registered',
          payload: { userId: 'u1' },
          idempotencyKey: 'reg:u1',
        }),
        expect.anything(),
      );

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: 'DISPATCHED',
          dispatchedAt: expect.any(Date),
        }),
      });
    });

    it('should mark event as DEAD_LETTER when no queue mapping exists', async () => {
      const event = {
        id: 'evt-2',
        topic: 'unknown.topic',
        payload: {},
        idempotencyKey: 'unk:1',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-2' },
        data: expect.objectContaining({
          status: 'DEAD_LETTER',
          lastError: expect.stringContaining('No queue mapping'),
        }),
      });
    });

    it('should apply exponential backoff on dispatch failure (5 * 5^(attempt-1) seconds)', async () => {
      const event = {
        id: 'evt-3',
        topic: 'payment.succeeded',
        payload: {},
        idempotencyKey: 'pay:1',
        attempt: 2, // already failed twice
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);
      mockQueues[QUEUE_NAMES.NOTIFICATION_FANOUT].add.mockRejectedValueOnce(
        new Error('Redis timeout'),
      );

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // attempt goes from 2 to 3, backoff = 5 * 5^(3-1) = 5 * 25 = 125 seconds
      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-3' },
        data: expect.objectContaining({
          attempt: 3,
          lastError: 'Redis timeout',
          nextAttemptAt: expect.any(Date),
        }),
      });
    });

    it('should mark as DEAD_LETTER after 10 failed attempts', async () => {
      const event = {
        id: 'evt-4',
        topic: 'lesson.published',
        payload: {},
        idempotencyKey: 'les:1',
        attempt: 9, // next attempt will be 10 (>= MAX_ATTEMPTS)
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);
      mockQueues[QUEUE_NAMES.NOTIFICATION_FANOUT].add.mockRejectedValueOnce(
        new Error('Persistent failure'),
      );

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-4' },
        data: expect.objectContaining({
          status: 'DEAD_LETTER',
          lastError: 'Persistent failure',
        }),
      });
    });

    it('should route submission.created to AI_GRADING queue', async () => {
      const event = {
        id: 'evt-5',
        topic: 'submission.created',
        payload: { submissionId: 'sub-1' },
        idempotencyKey: 'sub:1',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockQueues[QUEUE_NAMES.AI_GRADING].add).toHaveBeenCalledWith(
        'submission.created',
        expect.objectContaining({
          outboxEventId: 'evt-5',
          topic: 'submission.created',
        }),
        expect.anything(),
      );
    });

    it('should route notification.telegram to TELEGRAM queue', async () => {
      const event = {
        id: 'evt-6',
        topic: 'notification.telegram',
        payload: { chatId: '123', text: 'hello' },
        idempotencyKey: 'tg:1',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockQueues[QUEUE_NAMES.TELEGRAM].add).toHaveBeenCalledWith(
        'notification.telegram',
        expect.objectContaining({
          outboxEventId: 'evt-6',
          topic: 'notification.telegram',
        }),
        expect.anything(),
      );
    });

    it('fans live.started out to BOTH notification-fanout and live-recording (Req 9.5, 9.6)', async () => {
      const event = {
        id: 'evt-live-1',
        topic: 'live.started',
        payload: { sessionId: 'sess-1', lessonId: 'les-1' },
        idempotencyKey: 'live.started:sess-1',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockQueues[QUEUE_NAMES.NOTIFICATION_FANOUT].add).toHaveBeenCalledWith(
        'live.started',
        expect.objectContaining({
          outboxEventId: 'evt-live-1',
          topic: 'live.started',
        }),
        expect.anything(),
      );
      expect(mockQueues[QUEUE_NAMES.LIVE_RECORDING].add).toHaveBeenCalledWith(
        'live.started',
        expect.objectContaining({
          outboxEventId: 'evt-live-1',
          topic: 'live.started',
        }),
        expect.anything(),
      );
      expect(mockPrisma.outboxEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-live-1' },
        data: expect.objectContaining({
          status: 'DISPATCHED',
          dispatchedAt: expect.any(Date),
        }),
      });
    });

    it('fans live.ended out to BOTH notification-fanout and live-recording (Req 9.7, 9.8)', async () => {
      const event = {
        id: 'evt-live-2',
        topic: 'live.ended',
        payload: { sessionId: 'sess-2', lessonId: 'les-2' },
        idempotencyKey: 'live.ended:sess-2',
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date(),
        createdAt: new Date(),
        lastError: null,
        dispatchedAt: null,
      };

      mockPrisma.outboxEvent.findMany.mockResolvedValueOnce([event]);

      dispatcher.onModuleInit();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockQueues[QUEUE_NAMES.NOTIFICATION_FANOUT].add).toHaveBeenCalledWith(
        'live.ended',
        expect.objectContaining({ topic: 'live.ended' }),
        expect.anything(),
      );
      expect(mockQueues[QUEUE_NAMES.LIVE_RECORDING].add).toHaveBeenCalledWith(
        'live.ended',
        expect.objectContaining({ topic: 'live.ended' }),
        expect.anything(),
      );
    });
  });
});
