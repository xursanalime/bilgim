import { BillingCron } from './billing.cron';
import { BillingService, PAST_DUE_GRACE_DAYS } from './billing.service';
import { SubscriptionRepository } from './repositories/subscription.repository';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-06-01T12:00:00.000Z');

/**
 * BillingCron unit tests.
 *
 * Verifies:
 *   - `expireTrialsCron` queries with `now` and dispatches each row through
 *     `BillingService.expireTrial` (Req 3.3).
 *   - `expirePastDueCron` queries with `now - 7 days` and dispatches each
 *     row through `BillingService.expirePastDue` (Req 3.6).
 *   - One row failing does not abort the batch (resilient to per-row
 *     conflicts).
 *   - Top-level errors are swallowed (cron tick must not crash the runtime).
 */
describe('BillingCron', () => {
  let cron: BillingCron;
  let billingService: jest.Mocked<BillingService>;
  let subscriptionRepository: jest.Mocked<SubscriptionRepository>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    billingService = {
      expireTrial: jest.fn().mockResolvedValue({}),
      expirePastDue: jest.fn().mockResolvedValue({}),
    } as any;

    subscriptionRepository = {
      findExpiredTrials: jest.fn().mockResolvedValue([]),
      findExpiredPastDue: jest.fn().mockResolvedValue([]),
    } as any;

    cron = new BillingCron(billingService, subscriptionRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ------------------------------------------------------------------
  // expireTrialsCron — Req 3.3
  // ------------------------------------------------------------------

  describe('expireTrialsCron', () => {
    it('queries findExpiredTrials with the current time and a 50-row batch', async () => {
      await cron.expireTrialsCron();

      expect(subscriptionRepository.findExpiredTrials).toHaveBeenCalledWith(
        FIXED_NOW,
        50,
      );
    });

    it('does nothing when no trials are expired', async () => {
      subscriptionRepository.findExpiredTrials.mockResolvedValue([]);

      await cron.expireTrialsCron();

      expect(billingService.expireTrial).not.toHaveBeenCalled();
    });

    it('expires each returned trial (TRIAL → EXPIRED)', async () => {
      subscriptionRepository.findExpiredTrials.mockResolvedValue([
        { id: 'sub-a', teacherId: 't-a', trialEndsAt: FIXED_NOW } as any,
        { id: 'sub-b', teacherId: 't-b', trialEndsAt: FIXED_NOW } as any,
      ]);

      await cron.expireTrialsCron();

      expect(billingService.expireTrial).toHaveBeenCalledTimes(2);
      expect(billingService.expireTrial).toHaveBeenNthCalledWith(1, 'sub-a');
      expect(billingService.expireTrial).toHaveBeenNthCalledWith(2, 'sub-b');
    });

    it('continues processing the batch when one row fails', async () => {
      subscriptionRepository.findExpiredTrials.mockResolvedValue([
        { id: 'sub-a', teacherId: 't-a', trialEndsAt: FIXED_NOW } as any,
        { id: 'sub-b', teacherId: 't-b', trialEndsAt: FIXED_NOW } as any,
        { id: 'sub-c', teacherId: 't-c', trialEndsAt: FIXED_NOW } as any,
      ]);
      billingService.expireTrial
        .mockResolvedValueOnce({} as any)
        .mockRejectedValueOnce(new Error('row conflict'))
        .mockResolvedValueOnce({} as any);

      await cron.expireTrialsCron();

      expect(billingService.expireTrial).toHaveBeenCalledTimes(3);
    });

    it('swallows errors from findExpiredTrials so the cron timer survives', async () => {
      subscriptionRepository.findExpiredTrials.mockRejectedValue(
        new Error('db down'),
      );

      await expect(cron.expireTrialsCron()).resolves.toBeUndefined();
      expect(billingService.expireTrial).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // expirePastDueCron — Req 3.6
  // ------------------------------------------------------------------

  describe('expirePastDueCron', () => {
    it('queries findExpiredPastDue with now - 7 days and a 50-row batch', async () => {
      await cron.expirePastDueCron();

      const expectedThreshold = new Date(
        FIXED_NOW.getTime() - PAST_DUE_GRACE_DAYS * ONE_DAY_MS,
      );
      expect(subscriptionRepository.findExpiredPastDue).toHaveBeenCalledWith(
        expectedThreshold,
        50,
      );
    });

    it('does nothing when no past-due subscriptions are old enough', async () => {
      subscriptionRepository.findExpiredPastDue.mockResolvedValue([]);

      await cron.expirePastDueCron();

      expect(billingService.expirePastDue).not.toHaveBeenCalled();
    });

    it('expires each returned past-due subscription (PAST_DUE → EXPIRED)', async () => {
      subscriptionRepository.findExpiredPastDue.mockResolvedValue([
        { id: 'sub-x', teacherId: 't-x', updatedAt: FIXED_NOW } as any,
        { id: 'sub-y', teacherId: 't-y', updatedAt: FIXED_NOW } as any,
      ]);

      await cron.expirePastDueCron();

      expect(billingService.expirePastDue).toHaveBeenCalledTimes(2);
      expect(billingService.expirePastDue).toHaveBeenNthCalledWith(1, 'sub-x');
      expect(billingService.expirePastDue).toHaveBeenNthCalledWith(2, 'sub-y');
    });

    it('continues processing the batch when one row fails', async () => {
      subscriptionRepository.findExpiredPastDue.mockResolvedValue([
        { id: 'sub-x', teacherId: 't-x', updatedAt: FIXED_NOW } as any,
        { id: 'sub-y', teacherId: 't-y', updatedAt: FIXED_NOW } as any,
      ]);
      billingService.expirePastDue
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({} as any);

      await cron.expirePastDueCron();

      expect(billingService.expirePastDue).toHaveBeenCalledTimes(2);
    });

    it('swallows errors from findExpiredPastDue', async () => {
      subscriptionRepository.findExpiredPastDue.mockRejectedValue(
        new Error('db down'),
      );

      await expect(cron.expirePastDueCron()).resolves.toBeUndefined();
      expect(billingService.expirePastDue).not.toHaveBeenCalled();
    });
  });
});
