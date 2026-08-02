import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient, Subscription, SubscriptionStatus } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import {
  SubscriptionRepository,
  SubscriptionTransitionConflictError,
} from './repositories/subscription.repository';
import {
  InvoiceRepository,
  INVOICE_KIND,
  INVOICE_STATUS,
} from './repositories/invoice.repository';
import {
  canTransition,
  isActive,
  isTerminal,
} from './subscription-state-machine';
import { CheckoutDto } from './dto/checkout.dto';

/**
 * Trial duration in days. Per Requirement 2.1 every newly verified teacher
 * gets a 14-day trial.
 */
export const TRIAL_DURATION_DAYS = 14;

/**
 * Days a subscription may sit in PAST_DUE before being moved to EXPIRED
 * (Requirement 3.6).
 */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * `SystemSetting` key controlling whether teachers need an active
 * subscription to publish.
 *
 * Set to `false` (or `{ "enabled": false }`) from `/admin/system-settings`
 * to run the platform in demo mode while the Payme integration is still
 * being validated. Absent means enforce — the paywall can never be opened
 * by a missing row. Must be re-enabled before public launch.
 */
export const SUBSCRIPTION_GATE_SETTING_KEY = 'billing.requireSubscription';

/**
 * Lower-cased segment used to derive the outbox topic from the destination
 * status: `subscription.activated`, `subscription.expired`, ... — keeps the
 * topic naming consistent with the existing dispatcher mappings.
 */
function topicFor(toStatus: SubscriptionStatus): string {
  switch (toStatus) {
    case 'ACTIVE':
      return 'subscription.activated';
    case 'PAST_DUE':
      return 'subscription.past_due';
    case 'EXPIRED':
      return 'subscription.expired';
    case 'CANCELED':
      return 'subscription.canceled';
    case 'TRIAL':
      return 'subscription.trial_started';
  }
}

/**
 * BillingService — owns the Subscription lifecycle (TRIAL → ACTIVE → PAST_DUE
 * → CANCELED/EXPIRED, per Requirement 3.1) and (in later tasks) Payme
 * integration.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly outboxService: OutboxService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Build the Payme checkout URL.
   *
   * Format: `https://checkout.paycom.uz/{base64(m=MERCHANT_ID;ac.invoiceId=INVOICE_ID;a=AMOUNT_TIYIN)}`
   *
   * `amount` is provided in tiyin (so'm × 100) per Payme convention.
   */
  buildPayUrl(invoiceId: string, amountUzs: number): string {
    const merchantId = this.config.get<string>('PAYME_MERCHANT_ID') ?? 'demo';
    const checkoutBase =
      this.config.get<string>('PAYME_CHECKOUT_URL') ??
      'https://checkout.paycom.uz';
    const amountTiyin = amountUzs * 100;
    const params = `m=${merchantId};ac.invoiceId=${invoiceId};a=${amountTiyin}`;
    const encoded = Buffer.from(params, 'utf-8').toString('base64');
    return `${checkoutBase}/${encoded}`;
  }

  /**
   * Create a checkout — generates an Invoice(status=PENDING) and returns
   * the Payme payUrl. The Payme webhook later marks the Invoice PAID and
   * fires the appropriate side effect (EnrollmentRequest or Subscription
   * activation) atomically.
   *
   * @param userId — authenticated user id (TEACHER for SUBSCRIPTION, STUDENT for COURSE)
   * @param userRole — STUDENT or TEACHER
   */
  async checkout(
    userId: string,
    userRole: 'STUDENT' | 'TEACHER',
    dto: CheckoutDto,
  ): Promise<{ invoiceId: string; payUrl: string; amountUzs: number }> {
    if (dto.kind === 'STUDENT_COURSE') {
      if (userRole !== 'STUDENT') {
        throw new ForbiddenException({
          code: 'WRONG_ROLE_FOR_CHECKOUT',
          message: 'Only students can checkout a course',
        });
      }
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
      });
      if (!group) {
        throw new NotFoundException({
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found',
        });
      }
      if (group.priceUzs <= 0) {
        throw new BadRequestException({
          code: 'GROUP_NOT_PRICED',
          message: 'Group has no configured price',
        });
      }

      const invoice = await this.invoiceRepository.create({
        kind: INVOICE_KIND.STUDENT_COURSE,
        amountUzs: group.priceUzs,
        studentId: userId,
        groupId: group.id,
      });

      this.logger.log(
        `Checkout STUDENT_COURSE: student=${userId} group=${group.id} invoice=${invoice.id} amount=${group.priceUzs}`,
      );

      return {
        invoiceId: invoice.id,
        payUrl: this.buildPayUrl(invoice.id, group.priceUzs),
        amountUzs: group.priceUzs,
      };
    }

    // TEACHER_SUBSCRIPTION
    if (userRole !== 'TEACHER') {
      throw new ForbiddenException({
        code: 'WRONG_ROLE_FOR_CHECKOUT',
        message: 'Only teachers can checkout a subscription',
      });
    }
    const planSlug = dto.planSlug ?? 'teacher-monthly';
    const plan = await this.prisma.plan.findUnique({
      where: { slug: planSlug },
    });
    if (!plan) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: `Plan ${planSlug} not found`,
      });
    }

    const subscription =
      await this.subscriptionRepository.findActiveByTeacherId(userId);
    if (!subscription) {
      throw new BadRequestException({
        code: 'NO_ACTIVE_SUBSCRIPTION',
        message:
          'No active subscription to upgrade. Trial should be auto-created at email verification.',
      });
    }

    const invoice = await this.invoiceRepository.create({
      kind: INVOICE_KIND.TEACHER_SUBSCRIPTION,
      amountUzs: plan.priceUzs,
      teacherId: userId,
      subscriptionId: subscription.id,
    });

    this.logger.log(
      `Checkout TEACHER_SUBSCRIPTION: teacher=${userId} plan=${plan.slug} invoice=${invoice.id} amount=${plan.priceUzs}`,
    );

    return {
      invoiceId: invoice.id,
      payUrl: this.buildPayUrl(invoice.id, plan.priceUzs),
      amountUzs: plan.priceUzs,
    };
  }

  /**
   * Start a 14-day TRIAL subscription for a teacher.
   *
   * Behaviour (Requirements 2.1, 3.2, 3.3):
   *   1. Idempotent — if the teacher already has a non-terminal subscription
   *      (TRIAL/ACTIVE/PAST_DUE), the existing row is returned untouched.
   *   2. Ensures a `TeacherProfile` shell exists. The trial is created at
   *      email-verification time, *before* the onboarding quiz runs, so the
   *      teacher hasn't picked a specialty yet. We upsert a row with
   *      `specialtyId = null`; the onboarding flow later fills in the
   *      specialty (Requirement 2.5). This direct touch on `TeacherProfile`
   *      avoids a cycle Auth → Billing → Teacher → Auth.
   *   3. Inserts a `Subscription(status=TRIAL, trialEndsAt = now + 14 days,
   *      planId = null)`. Per Requirement 3.2, no Invoice is created during
   *      TRIAL.
   *   4. The DB partial unique index `subscriptions_teacher_active_uniq`
   *      guarantees at most one non-terminal subscription per teacher
   *      (Requirement 3.7). On a concurrent race, the duplicate insert
   *      raises Prisma `P2002`; we catch it, re-read the row, and return
   *      that.
   */
  async startTrial(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;

    // 1. Idempotency check
    const existing = await this.subscriptionRepository.findActiveByTeacherId(
      userId,
      tx,
    );
    if (existing) {
      this.logger.debug(
        `startTrial: teacher ${userId} already has subscription ${existing.id} (status=${existing.status}); returning existing`,
      );
      return existing;
    }

    // 2. Ensure TeacherProfile shell exists (FK precondition).
    await client.teacherProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    // 3. Insert TRIAL subscription
    const trialEndsAt = new Date(
      Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const subscription = await this.subscriptionRepository.createTrial(
        { teacherId: userId, trialEndsAt },
        tx,
      );
      this.logger.log(
        `Trial subscription ${subscription.id} created for teacher ${userId} (ends ${trialEndsAt.toISOString()})`,
      );
      return subscription;
    } catch (error) {
      // 4. Race-safe idempotency
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.subscriptionRepository.findActiveByTeacherId(
          userId,
          tx,
        );
        if (winner) {
          this.logger.warn(
            `startTrial: lost partial-unique-index race for teacher ${userId}; returning concurrently created subscription ${winner.id}`,
          );
          return winner;
        }
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // State transitions (Requirements 3.1, 3.3 – 3.6)
  //
  // Each transition method:
  //   1. Loads the subscription.
  //   2. Validates the transition with the state machine (`canTransition`).
  //   3. Atomically updates `status` with the row-level precondition
  //      (`UPDATE ... WHERE id=? AND status=?`) inside a Prisma transaction.
  //   4. Emits an OutboxEvent (`subscription.<to-status>`) within the same
  //      transaction so the side-effect commits with the state change.
  // ------------------------------------------------------------------

  /** TRIAL → EXPIRED (Req 3.3). Called by the hourly cron. */
  async expireTrial(subscriptionId: string): Promise<Subscription> {
    return this.transition(subscriptionId, 'TRIAL', 'EXPIRED');
  }

  /** PAST_DUE → EXPIRED (Req 3.6). Called by the hourly cron. */
  async expirePastDue(subscriptionId: string): Promise<Subscription> {
    return this.transition(subscriptionId, 'PAST_DUE', 'EXPIRED');
  }

  /**
   * TRIAL or PAST_DUE → ACTIVE (Req 3.4 / 3.5). Called after a successful
   * Payme charge. Resolves the current status from the row to pick the
   * correct transition arrow.
   */
  async activate(subscriptionId: string): Promise<Subscription> {
    const sub = await this.subscriptionRepository.findById(subscriptionId);
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: `Subscription ${subscriptionId} not found`,
      });
    }

    if (sub.status === 'ACTIVE') {
      // Idempotent: payment retry on an already-active subscription is a no-op.
      return sub;
    }

    if (sub.status !== 'TRIAL' && sub.status !== 'PAST_DUE') {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_INVALID_TRANSITION',
        message: `Cannot activate subscription in status ${sub.status}`,
      });
    }

    return this.transition(subscriptionId, sub.status, 'ACTIVE');
  }

  /** ACTIVE → PAST_DUE (Req 3.5). Called when a renewal payment fails. */
  async markPastDue(subscriptionId: string): Promise<Subscription> {
    return this.transition(subscriptionId, 'ACTIVE', 'PAST_DUE');
  }

  /**
   * Any non-terminal status → CANCELED. Called when the user cancels.
   * Idempotent: cancelling an already-CANCELED subscription is a no-op.
   * Cancelling an EXPIRED subscription is rejected (different terminal).
   */
  async cancel(subscriptionId: string): Promise<Subscription> {
    const sub = await this.subscriptionRepository.findById(subscriptionId);
    if (!sub) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: `Subscription ${subscriptionId} not found`,
      });
    }

    if (sub.status === 'CANCELED') return sub;

    if (isTerminal(sub.status)) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_ALREADY_TERMINAL',
        message: `Subscription ${subscriptionId} is already in terminal status ${sub.status}`,
      });
    }

    return this.transition(subscriptionId, sub.status, 'CANCELED');
  }

  /**
   * Catalog publish guard (Req 3.8): require a TRIAL or ACTIVE subscription
   * for the teacher. Throws `ForbiddenException(SUBSCRIPTION_EXPIRED)`
   * otherwise.
   *
   * This is the canonical gate; CatalogModule will call it from the lesson
   * publish flow in Task 7.2.
   */
  async requireActiveSubscription(teacherId: string): Promise<Subscription> {
    const sub =
      await this.subscriptionRepository.findActiveByTeacherId(teacherId);

    if (sub && isActive(sub.status)) return sub;

    // Demo mode: while the payment integration is still being validated,
    // an admin can drop the paywall platform-wide from
    // `/admin/system-settings` instead of anyone hardcoding an exemption.
    // A teacher with no subscription row still gets a real TRIAL so the
    // rest of the billing state machine has something to work with.
    if (await this.isSubscriptionGateDisabled()) {
      this.logger.warn(
        `Subscription gate bypassed for teacher ${teacherId} — ` +
          `${SUBSCRIPTION_GATE_SETTING_KEY} is disabled (demo mode)`,
      );
      return sub ?? (await this.startTrial(teacherId));
    }

    // Distinguish the two failure modes. They look identical to the user
    // but need different fixes: "expired" means renew, "missing" means the
    // account was activated outside the normal verify-email path (admin
    // action, data migration, seed) and never got its trial provisioned.
    if (!sub) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_MISSING',
        message:
          'This account has no subscription. Start a trial or contact support.',
      });
    }

    throw new ForbiddenException({
      code: 'SUBSCRIPTION_EXPIRED',
      message:
        'Active subscription required to publish lessons. Renew your plan to continue.',
    });
  }

  /**
   * `true` when an admin has turned the subscription paywall off.
   *
   * Reads `billing.requireSubscription` from `SystemSetting`; absent or
   * malformed means "enforce", so a missing row can never silently open the
   * gate. Handles both a raw JSON boolean and `{ "enabled": bool }` so the
   * admin UI can store either shape.
   */
  private async isSubscriptionGateDisabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: SUBSCRIPTION_GATE_SETTING_KEY },
      });
      if (!row) return false;

      const value = row.value as unknown;
      if (typeof value === 'boolean') return value === false;
      if (value && typeof value === 'object' && 'enabled' in value) {
        return (value as { enabled: unknown }).enabled === false;
      }
      return false;
    } catch (err) {
      // Never let a settings-table hiccup open the paywall.
      this.logger.error(
        `Failed to read ${SUBSCRIPTION_GATE_SETTING_KEY}; enforcing subscription: ` +
          `${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Core transition primitive: validate via state machine, atomically update
   * `status` with a row-level precondition, and emit an outbox event in the
   * same transaction.
   *
   * Throws:
   *   - `BadRequestException(SUBSCRIPTION_INVALID_TRANSITION)` when the
   *     state machine rejects the (from → to) edge.
   *   - `BadRequestException(SUBSCRIPTION_INVALID_TRANSITION)` when another
   *     caller already moved the row out of `fromStatus` (re-thrown from
   *     `SubscriptionTransitionConflictError`).
   */
  private async transition(
    subscriptionId: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
  ): Promise<Subscription> {
    if (!canTransition(fromStatus, toStatus)) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_INVALID_TRANSITION',
        message: `Invalid state transition: ${fromStatus} → ${toStatus}`,
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await this.subscriptionRepository.transitionStatus(
          subscriptionId,
          fromStatus,
          toStatus,
          tx,
        );

        // Emit outbox event in the same transaction so the side-effect is
        // atomic with the state change (Req 18.1).
        await this.outboxService.create(tx, {
          topic: topicFor(toStatus),
          payload: {
            subscriptionId: result.id,
            teacherId: result.teacherId,
            fromStatus,
            toStatus,
          },
          // Idempotency key encodes the transition's destination state and
          // the timestamp of this transition, so retried calls within the
          // same minute coalesce — but normal flows always produce a unique
          // key because the row's status will no longer be `fromStatus` on
          // retry.
          idempotencyKey: `subscription.transition:${result.id}:${fromStatus}:${toStatus}`,
        });

        return result;
      });

      this.logger.log(
        `Subscription ${updated.id} (teacher=${updated.teacherId}) transitioned ${fromStatus} → ${toStatus}`,
      );
      return updated;
    } catch (error) {
      if (error instanceof SubscriptionTransitionConflictError) {
        throw new BadRequestException({
          code: 'SUBSCRIPTION_INVALID_TRANSITION',
          message: error.message,
        });
      }
      throw error;
    }
  }

  async getMyInvoices(
    userId: string,
    opts: { page?: number; limit?: number } = {},
  ) {
    return this.invoiceRepository.findByUser(userId, opts);
  }
}
