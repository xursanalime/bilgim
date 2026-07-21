import { OutboxService, CreateOutboxEventInput } from './outbox.service';

describe('OutboxService', () => {
  let service: OutboxService;

  beforeEach(() => {
    service = new OutboxService();
  });

  describe('create', () => {
    it('should insert an OutboxEvent and return the generated id', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
      } as any;

      const input: CreateOutboxEventInput = {
        topic: 'user.registered',
        payload: { userId: 'abc-123' },
        idempotencyKey: 'reg:abc-123',
      };

      const result = await service.create(mockTx, input);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // UUID format
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should return null when idempotencyKey already exists (ON CONFLICT DO NOTHING)', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(0), // 0 rows affected = conflict
      } as any;

      const input: CreateOutboxEventInput = {
        topic: 'payment.succeeded',
        payload: { paymentId: 'pay-1' },
        idempotencyKey: 'pay:pay-1',
      };

      const result = await service.create(mockTx, input);

      expect(result).toBeNull();
    });

    it('should throw when the transaction client throws', async () => {
      const mockTx = {
        $executeRaw: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      } as any;

      const input: CreateOutboxEventInput = {
        topic: 'lesson.published',
        payload: { lessonId: 'les-1' },
        idempotencyKey: 'lesson:les-1',
      };

      await expect(service.create(mockTx, input)).rejects.toThrow(
        'DB connection lost',
      );
    });
  });

  describe('createMany', () => {
    it('should create multiple events and return array of ids', async () => {
      const mockTx = {
        $executeRaw: jest
          .fn()
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(0), // third one is duplicate
      } as any;

      const inputs: CreateOutboxEventInput[] = [
        { topic: 'a', payload: {}, idempotencyKey: 'key-1' },
        { topic: 'b', payload: {}, idempotencyKey: 'key-2' },
        { topic: 'c', payload: {}, idempotencyKey: 'key-3' },
      ];

      const results = await service.createMany(mockTx, inputs);

      expect(results).toHaveLength(3);
      expect(results[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(results[1]).toMatch(/^[0-9a-f-]{36}$/);
      expect(results[2]).toBeNull(); // duplicate
    });
  });
});
