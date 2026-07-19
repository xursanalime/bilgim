import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BillingService, PAST_DUE_GRACE_DAYS } from './billing.service';
import { SubscriptionRepository } from './repositories/subscription.repository';

/** Batch size per cron run — keeps each transaction small (Task 4.1 brief). */
const BATCH_SIZE = 50;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * BillingCron — periodic state-machine maintenance:
 *
 *   - `expireTrialsCron` (Req 3.3): TRIAL → EXPIRED once `trialEndsAt` has
 *     passed.
 *   - `expirePastDueCron` (Req 3.6): PAST_DUE → EXPIRED once the row has
 *     been stuck in PAST_DUE for ≥7 days.
 *
 * Both run hourly. Each transition is validated by the state machine and
 * applied atomically via `BillingService` — failures on individual rows are
 * logged and *do not* abort the batch. The cron methods themselves never
 * throw; an unhandled error would cause `@nestjs/schedule` to keep the timer
 * but suppress the next tick's logs, so we wrap the whole body.
 */
@Injectable()
export class BillingCron {
  private readonly logger = new Logger(BillingCron.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly subscriptionRepository: SubscriptionRepository,
  ) {}

  /**
   * Hourly: expire trials whose `trialEndsAt` has passed.
   * Cron: `0 * * * *` (every hour at :00).
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'billing.expire-trials' })
  async expireTrialsCron(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.subscriptionRepository.findExpiredTrials(
        now,
        BATCH_SIZE,
      );

      if (expired.length === 0) {
        this.logger.debug('expireTrialsCron: no expired trials');
        return;
      }

      this.logger.log(
        `expireTrialsCron: processing ${expired.length} expired trial(s)`,
      );

      for (const sub of expired) {
        try {
          await this.billingService.expireTrial(sub.id);
          this.logger.log(
            `Expired trial ${sub.id} (teacher=${sub.teacherId}, trialEndsAt=${sub.trialEndsAt?.toISOString() ?? 'null'})`,
          );
        } catch (error) {
          // Don't abort the batch — a single row's conflict (e.g. a
          // concurrent payment activated it) shouldn't block the rest.
          this.logger.error(
            `expireTrialsCron: failed to expire ${sub.id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `expireTrialsCron: batch error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Hourly: PAST_DUE → EXPIRED once the row has been stuck in PAST_DUE for
   * ≥7 days (Req 3.6). Threshold is computed as `now - 7 days` and compared
   * against `updatedAt`; see `findExpiredPastDue` for why that field is
   * stable for this purpose.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'billing.expire-past-due' })
  async expirePastDueCron(): Promise<void> {
    try {
      const now = Date.now();
      const threshold = new Date(now - PAST_DUE_GRACE_DAYS * ONE_DAY_MS);

      const expired = await this.subscriptionRepository.findExpiredPastDue(
        threshold,
        BATCH_SIZE,
      );

      if (expired.length === 0) {
        this.logger.debug('expirePastDueCron: no past-due subscriptions to expire');
        return;
      }

      this.logger.log(
        `expirePastDueCron: processing ${expired.length} past-due subscription(s)`,
      );

      for (const sub of expired) {
        try {
          await this.billingService.expirePastDue(sub.id);
          this.logger.log(
            `Expired past-due ${sub.id} (teacher=${sub.teacherId}, updatedAt=${sub.updatedAt.toISOString()})`,
          );
        } catch (error) {
          this.logger.error(
            `expirePastDueCron: failed to expire ${sub.id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `expirePastDueCron: batch error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
