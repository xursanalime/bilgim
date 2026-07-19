import {
  SubscriptionRepository,
  SubscriptionTransitionConflictError,
} from './subscription.repository';

const SUB_ID = '00000000-0000-0000-0000-000000000077';

describe('SubscriptionRepository', () => {
  let repo: SubscriptionRepository;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    repo = new SubscriptionRepository(prisma);
  });

  // ------------------------------------------------------------------
  // findExpiredTrials
  // ------------------------------------------------------------------

  describe('findExpiredTrials', () => {
    it('selects TRIAL rows with trialEndsAt ≤ now, ordered ASC, capped by take', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      const now = new Date('2026-06-01T00:00:00Z');

      await repo.findExpiredTrials(now, 25);

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: { status: 'TRIAL', trialEndsAt: { lte: now } },
        orderBy: { trialEndsAt: 'asc' },
        take: 25,
      });
    });

    it('defaults to take=50', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      await repo.findExpiredTrials(new Date());
      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  // ------------------------------------------------------------------
  // findExpiredPastDue
  // ------------------------------------------------------------------

  describe('findExpiredPastDue', () => {
    it('selects PAST_DUE rows with updatedAt ≤ thresholdDate, ordered ASC', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      const threshold = new Date('2026-05-25T00:00:00Z');

      await repo.findExpiredPastDue(threshold, 10);

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: { status: 'PAST_DUE', updatedAt: { lte: threshold } },
        orderBy: { updatedAt: 'asc' },
        take: 10,
      });
    });
  });

  // ------------------------------------------------------------------
  // transitionStatus
  // ------------------------------------------------------------------

  describe('transitionStatus', () => {
    it('atomically updates status with the (id, fromStatus) precondition', async () => {
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.subscription.findUnique.mockResolvedValue({
        id: SUB_ID,
        status: 'EXPIRED',
      });

      const result = await repo.transitionStatus(SUB_ID, 'TRIAL', 'EXPIRED');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: 'TRIAL' },
        data: { status: 'EXPIRED' },
      });
      expect(result.status).toBe('EXPIRED');
    });

    it('throws SubscriptionTransitionConflictError when zero rows match', async () => {
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repo.transitionStatus(SUB_ID, 'TRIAL', 'EXPIRED'),
      ).rejects.toBeInstanceOf(SubscriptionTransitionConflictError);
    });

    it('uses the optional transaction client when provided', async () => {
      const tx: any = {
        subscription: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: SUB_ID, status: 'ACTIVE' }),
        },
      };

      await repo.transitionStatus(SUB_ID, 'TRIAL', 'ACTIVE', tx);

      expect(tx.subscription.updateMany).toHaveBeenCalled();
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });
  });
});
