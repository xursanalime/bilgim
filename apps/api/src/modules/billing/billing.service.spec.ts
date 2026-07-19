import { Prisma } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService, TRIAL_DURATION_DAYS } from './billing.service';
import { InvoiceRepository } from './repositories/invoice.repository';
import {
  SubscriptionRepository,
  SubscriptionTransitionConflictError,
} from './repositories/subscription.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000099';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * BillingService unit tests.
 *
 * Covers:
 *   - Requirements 2.1, 3.2, 3.3, 3.7 — startTrial (idempotency, race
 *     handling, no Invoice during TRIAL).
 *   - Requirements 3.1, 3.3 – 3.6 — state transitions enforced via the
 *     state machine and the row-level precondition.
 *   - Requirement 3.8 — `requireActiveSubscription` access gate.
 *   - Requirement 4.1 — checkout creates Invoice(PENDING) and returns Payme
 *     payUrl; rejects missing groups/plans and unpriced groups.
 */
describe('BillingService', () => {
  let service: BillingService;
  let subscriptionRepository: jest.Mocked<SubscriptionRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let invoiceRepository: jest.Mocked<InvoiceRepository>;
  let config: { get: jest.Mock };
  let prisma: any;

  beforeEach(() => {
    subscriptionRepository = {
      findActiveByTeacherId: jest.fn(),
      findById: jest.fn(),
      createTrial: jest.fn(),
      findExpiredTrials: jest.fn(),
      findExpiredPastDue: jest.fn(),
      transitionStatus: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-event-id'),
    } as any;

    invoiceRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      markPaid: jest.fn(),
      linkPaymeTx: jest.fn(),
    } as any;

    config = {
      get: jest.fn((key: string) => {
        if (key === 'PAYME_MERCHANT_ID') return 'merchant-test';
        if (key === 'PAYME_CHECKOUT_URL') return 'https://checkout.paycom.uz';
        return undefined;
      }),
    };

    // `$transaction(fn)` simply runs the callback with the prisma stub itself
    // as the tx — same pattern AuthService uses in its tests.
    prisma = {
      teacherProfile: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      invoice: {
        create: jest.fn(),
      },
      group: {
        findUnique: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    service = new BillingService(
      prisma,
      subscriptionRepository,
      outboxService,
      invoiceRepository,
      config as any,
    );
  });

  // ------------------------------------------------------------------
  // startTrial
  // ------------------------------------------------------------------

  describe('startTrial', () => {
    it('creates a TRIAL subscription with trialEndsAt ≈ now + 14 days on first call', async () => {
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);
      subscriptionRepository.createTrial.mockImplementation(async (input) => ({
        id: 'sub-1',
        teacherId: input.teacherId,
        planId: null,
        status: 'TRIAL',
        trialEndsAt: input.trialEndsAt,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const before = Date.now();
      const result = await service.startTrial(TEACHER_ID);
      const after = Date.now();

      expect(result.status).toBe('TRIAL');
      expect(result.teacherId).toBe(TEACHER_ID);
      expect(result.planId).toBeNull();

      const expectedLow = before + TRIAL_DURATION_DAYS * TWENTY_FOUR_HOURS_MS - 1000;
      const expectedHigh = after + TRIAL_DURATION_DAYS * TWENTY_FOUR_HOURS_MS + 1000;
      const ts = result.trialEndsAt!.getTime();
      expect(ts).toBeGreaterThanOrEqual(expectedLow);
      expect(ts).toBeLessThanOrEqual(expectedHigh);

      // No Invoice creation during TRIAL (Req 3.2)
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('upserts a minimal TeacherProfile shell (specialtyId stays null)', async () => {
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);
      subscriptionRepository.createTrial.mockResolvedValue({
        id: 'sub-1',
        teacherId: TEACHER_ID,
        status: 'TRIAL',
        trialEndsAt: new Date(),
      } as any);

      await service.startTrial(TEACHER_ID);

      expect(prisma.teacherProfile.upsert).toHaveBeenCalledWith({
        where: { userId: TEACHER_ID },
        create: { userId: TEACHER_ID },
        update: {},
      });
    });

    it('is idempotent: returns the existing subscription on the second call', async () => {
      const existing = {
        id: 'sub-existing',
        teacherId: TEACHER_ID,
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 7 * TWENTY_FOUR_HOURS_MS),
        planId: null,
      } as any;
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(existing);

      const result = await service.startTrial(TEACHER_ID);

      expect(result).toBe(existing);
      expect(subscriptionRepository.createTrial).not.toHaveBeenCalled();
      expect(prisma.teacherProfile.upsert).not.toHaveBeenCalled();
    });

    it('returns the existing subscription if an ACTIVE one already exists', async () => {
      const existingActive = {
        id: 'sub-active',
        teacherId: TEACHER_ID,
        status: 'ACTIVE',
        trialEndsAt: null,
      } as any;
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(existingActive);

      const result = await service.startTrial(TEACHER_ID);

      expect(result).toBe(existingActive);
      expect(subscriptionRepository.createTrial).not.toHaveBeenCalled();
    });

    it('handles a P2002 race by re-reading and returning the concurrently created row', async () => {
      const winner = {
        id: 'sub-winner',
        teacherId: TEACHER_ID,
        status: 'TRIAL',
      } as any;

      subscriptionRepository.findActiveByTeacherId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.18.0' },
      );
      subscriptionRepository.createTrial.mockRejectedValue(p2002);

      const result = await service.startTrial(TEACHER_ID);

      expect(result).toBe(winner);
      expect(subscriptionRepository.findActiveByTeacherId).toHaveBeenCalledTimes(2);
    });

    it('rethrows non-P2002 Prisma errors', async () => {
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);

      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '5.18.0' },
      );
      subscriptionRepository.createTrial.mockRejectedValue(fkError);

      await expect(service.startTrial(TEACHER_ID)).rejects.toBe(fkError);
    });

    it('passes the optional Prisma transaction client through to the repository', async () => {
      const tx = {
        teacherProfile: { upsert: jest.fn().mockResolvedValue({}) },
      } as any;

      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);
      subscriptionRepository.createTrial.mockResolvedValue({
        id: 'sub-1',
        teacherId: TEACHER_ID,
        status: 'TRIAL',
      } as any);

      await service.startTrial(TEACHER_ID, tx);

      expect(subscriptionRepository.findActiveByTeacherId).toHaveBeenCalledWith(
        TEACHER_ID,
        tx,
      );
      expect(tx.teacherProfile.upsert).toHaveBeenCalled();
      expect(prisma.teacherProfile.upsert).not.toHaveBeenCalled();
      expect(subscriptionRepository.createTrial).toHaveBeenCalledWith(
        expect.objectContaining({ teacherId: TEACHER_ID }),
        tx,
      );
    });
  });

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------

  function buildSubscription(overrides: any = {}) {
    return {
      id: SUB_ID,
      teacherId: TEACHER_ID,
      planId: null,
      status: 'TRIAL',
      trialEndsAt: new Date(),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  describe('expireTrial (Req 3.3)', () => {
    it('transitions TRIAL → EXPIRED and emits a subscription.expired outbox event', async () => {
      const updated = buildSubscription({ status: 'EXPIRED' });
      subscriptionRepository.transitionStatus.mockResolvedValue(updated);

      const result = await service.expireTrial(SUB_ID);

      expect(result).toBe(updated);
      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'TRIAL',
        'EXPIRED',
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'subscription.expired',
          idempotencyKey: `subscription.transition:${SUB_ID}:TRIAL:EXPIRED`,
          payload: expect.objectContaining({
            subscriptionId: SUB_ID,
            teacherId: TEACHER_ID,
            fromStatus: 'TRIAL',
            toStatus: 'EXPIRED',
          }),
        }),
      );
    });

    it('translates a row-level conflict into SUBSCRIPTION_INVALID_TRANSITION', async () => {
      subscriptionRepository.transitionStatus.mockRejectedValue(
        new SubscriptionTransitionConflictError(SUB_ID, 'TRIAL', 'EXPIRED'),
      );

      await expect(service.expireTrial(SUB_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBSCRIPTION_INVALID_TRANSITION',
        }),
      });
    });
  });

  describe('expirePastDue (Req 3.6)', () => {
    it('transitions PAST_DUE → EXPIRED', async () => {
      const updated = buildSubscription({ status: 'EXPIRED' });
      subscriptionRepository.transitionStatus.mockResolvedValue(updated);

      await service.expirePastDue(SUB_ID);

      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'PAST_DUE',
        'EXPIRED',
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ topic: 'subscription.expired' }),
      );
    });
  });

  describe('activate (Req 3.4 / 3.5)', () => {
    it('transitions TRIAL → ACTIVE on payment success', async () => {
      subscriptionRepository.findById.mockResolvedValue(
        buildSubscription({ status: 'TRIAL' }),
      );
      const updated = buildSubscription({ status: 'ACTIVE' });
      subscriptionRepository.transitionStatus.mockResolvedValue(updated);

      const result = await service.activate(SUB_ID);

      expect(result).toBe(updated);
      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'TRIAL',
        'ACTIVE',
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ topic: 'subscription.activated' }),
      );
    });

    it('transitions PAST_DUE → ACTIVE on payment success', async () => {
      subscriptionRepository.findById.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE' }),
      );
      subscriptionRepository.transitionStatus.mockResolvedValue(
        buildSubscription({ status: 'ACTIVE' }),
      );

      await service.activate(SUB_ID);

      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'PAST_DUE',
        'ACTIVE',
        expect.anything(),
      );
    });

    it('is idempotent on already-ACTIVE subscription', async () => {
      const sub = buildSubscription({ status: 'ACTIVE' });
      subscriptionRepository.findById.mockResolvedValue(sub);

      const result = await service.activate(SUB_ID);

      expect(result).toBe(sub);
      expect(subscriptionRepository.transitionStatus).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('rejects activation from a terminal status', async () => {
      subscriptionRepository.findById.mockResolvedValue(
        buildSubscription({ status: 'EXPIRED' }),
      );

      await expect(service.activate(SUB_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBSCRIPTION_INVALID_TRANSITION',
        }),
      });
    });

    it('throws SUBSCRIPTION_NOT_FOUND when the row is missing', async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.activate(SUB_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBSCRIPTION_NOT_FOUND',
        }),
      });
    });
  });

  describe('markPastDue (Req 3.5)', () => {
    it('transitions ACTIVE → PAST_DUE', async () => {
      subscriptionRepository.transitionStatus.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE' }),
      );

      await service.markPastDue(SUB_ID);

      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'ACTIVE',
        'PAST_DUE',
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ topic: 'subscription.past_due' }),
      );
    });
  });

  describe('cancel', () => {
    it.each(['TRIAL', 'ACTIVE', 'PAST_DUE'] as const)(
      'transitions %s → CANCELED',
      async (from) => {
        subscriptionRepository.findById.mockResolvedValue(
          buildSubscription({ status: from }),
        );
        subscriptionRepository.transitionStatus.mockResolvedValue(
          buildSubscription({ status: 'CANCELED' }),
        );

        await service.cancel(SUB_ID);

        expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
          SUB_ID,
          from,
          'CANCELED',
          expect.anything(),
        );
        expect(outboxService.create).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ topic: 'subscription.canceled' }),
        );
      },
    );

    it('is idempotent on already-CANCELED subscription', async () => {
      const sub = buildSubscription({ status: 'CANCELED' });
      subscriptionRepository.findById.mockResolvedValue(sub);

      const result = await service.cancel(SUB_ID);

      expect(result).toBe(sub);
      expect(subscriptionRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects canceling an EXPIRED subscription', async () => {
      subscriptionRepository.findById.mockResolvedValue(
        buildSubscription({ status: 'EXPIRED' }),
      );

      await expect(service.cancel(SUB_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBSCRIPTION_ALREADY_TERMINAL',
        }),
      });
    });

    it('throws SUBSCRIPTION_NOT_FOUND when the row is missing', async () => {
      subscriptionRepository.findById.mockResolvedValue(null);

      await expect(service.cancel(SUB_ID)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBSCRIPTION_NOT_FOUND',
        }),
      });
    });
  });

  // ------------------------------------------------------------------
  // requireActiveSubscription (Req 3.8)
  // ------------------------------------------------------------------

  describe('requireActiveSubscription', () => {
    it.each(['TRIAL', 'ACTIVE'] as const)(
      'allows access on %s subscription',
      async (status) => {
        const sub = buildSubscription({ status });
        subscriptionRepository.findActiveByTeacherId.mockResolvedValue(sub);

        await expect(service.requireActiveSubscription(TEACHER_ID)).resolves.toBe(
          sub,
        );
      },
    );

    it('blocks publishing when the teacher has no active subscription', async () => {
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);

      await expect(
        service.requireActiveSubscription(TEACHER_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }),
      });
    });

    it('blocks publishing on PAST_DUE (grace period — Req 3.8)', async () => {
      subscriptionRepository.findActiveByTeacherId.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE' }),
      );

      await expect(
        service.requireActiveSubscription(TEACHER_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }),
      });
    });
  });

  // ------------------------------------------------------------------
  // checkout (Req 4.1)
  //
  // The checkout endpoint creates an Invoice(PENDING) and returns the Payme
  // payUrl. Side effects (Invoice → PAID, EnrollmentRequest, Subscription
  // activation) are deferred to the Payme webhook (Req 4.2, exercised in
  // payme.service.spec.ts).
  //
  // Failure shapes covered here mirror the "invalid amount / account-not-
  // found" branches required by Task 4.5 from the *issuing* side:
  //   - Group not found     → 404 GROUP_NOT_FOUND
  //   - Group has no price  → 400 GROUP_NOT_PRICED (would otherwise produce
  //                                   invalid amount on the Payme side)
  //   - Plan not found      → 404 PLAN_NOT_FOUND
  //   - No active sub       → 400 NO_ACTIVE_SUBSCRIPTION
  //   - Wrong role          → 403 WRONG_ROLE_FOR_CHECKOUT
  // ------------------------------------------------------------------

  describe('checkout', () => {
    const STUDENT_ID = '00000000-0000-0000-0000-0000000000aa';
    const GROUP_ID = '00000000-0000-0000-0000-0000000000bb';
    const INVOICE_ID = '00000000-0000-0000-0000-0000000000cc';

    describe('STUDENT_COURSE', () => {
      it('creates a PENDING Invoice and returns the Payme payUrl + amount', async () => {
        prisma.group.findUnique.mockResolvedValue({
          id: GROUP_ID,
          priceUzs: 50_000,
          teacherId: 't-1',
        });
        invoiceRepository.create.mockResolvedValue({
          id: INVOICE_ID,
          kind: 'STUDENT_COURSE',
          status: 'PENDING',
          amountUzs: 50_000,
        } as any);

        const result = await service.checkout(STUDENT_ID, 'STUDENT', {
          kind: 'STUDENT_COURSE',
          groupId: GROUP_ID,
        });

        expect(invoiceRepository.create).toHaveBeenCalledWith({
          kind: 'STUDENT_COURSE',
          amountUzs: 50_000,
          studentId: STUDENT_ID,
          groupId: GROUP_ID,
        });
        expect(result.invoiceId).toBe(INVOICE_ID);
        expect(result.amountUzs).toBe(50_000);

        // payUrl is base64(`m=...;ac.invoiceId=...;a=...`) appended to the
        // checkout host; assert structure rather than exact string so we
        // don't over-couple to the encoding format.
        expect(result.payUrl.startsWith('https://checkout.paycom.uz/')).toBe(
          true,
        );
        const encoded = result.payUrl.split('/').pop()!;
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        expect(decoded).toContain(`ac.invoiceId=${INVOICE_ID}`);
        // amount in tiyin (so'm × 100) per Payme convention
        expect(decoded).toContain('a=5000000');
        expect(decoded).toContain('m=merchant-test');
      });

      it('throws GROUP_NOT_FOUND when the group does not exist', async () => {
        prisma.group.findUnique.mockResolvedValue(null);

        await expect(
          service.checkout(STUDENT_ID, 'STUDENT', {
            kind: 'STUDENT_COURSE',
            groupId: GROUP_ID,
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'GROUP_NOT_FOUND' }),
        });
        expect(invoiceRepository.create).not.toHaveBeenCalled();
      });

      it('throws GROUP_NOT_PRICED when the group price is 0 (would mint invalid-amount on Payme)', async () => {
        prisma.group.findUnique.mockResolvedValue({
          id: GROUP_ID,
          priceUzs: 0,
        });

        await expect(
          service.checkout(STUDENT_ID, 'STUDENT', {
            kind: 'STUDENT_COURSE',
            groupId: GROUP_ID,
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'GROUP_NOT_PRICED' }),
        });
        expect(invoiceRepository.create).not.toHaveBeenCalled();
      });

      it('rejects a TEACHER trying to check out a STUDENT_COURSE', async () => {
        await expect(
          service.checkout(STUDENT_ID, 'TEACHER', {
            kind: 'STUDENT_COURSE',
            groupId: GROUP_ID,
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            code: 'WRONG_ROLE_FOR_CHECKOUT',
          }),
        });
      });
    });

    describe('TEACHER_SUBSCRIPTION', () => {
      it('creates a PENDING Invoice for the teacher subscription and returns the payUrl', async () => {
        const planId = '00000000-0000-0000-0000-000000000111';
        prisma.plan.findUnique.mockResolvedValue({
          id: planId,
          slug: 'teacher-monthly',
          priceUzs: 200_000,
        });
        subscriptionRepository.findActiveByTeacherId.mockResolvedValue({
          id: SUB_ID,
          teacherId: TEACHER_ID,
          status: 'TRIAL',
        } as any);
        invoiceRepository.create.mockResolvedValue({
          id: INVOICE_ID,
          kind: 'TEACHER_SUBSCRIPTION',
          status: 'PENDING',
          amountUzs: 200_000,
        } as any);

        const result = await service.checkout(TEACHER_ID, 'TEACHER', {
          kind: 'TEACHER_SUBSCRIPTION',
        });

        expect(invoiceRepository.create).toHaveBeenCalledWith({
          kind: 'TEACHER_SUBSCRIPTION',
          amountUzs: 200_000,
          teacherId: TEACHER_ID,
          subscriptionId: SUB_ID,
        });
        expect(result.amountUzs).toBe(200_000);
      });

      it('throws PLAN_NOT_FOUND for an unknown plan slug', async () => {
        prisma.plan.findUnique.mockResolvedValue(null);

        await expect(
          service.checkout(TEACHER_ID, 'TEACHER', {
            kind: 'TEACHER_SUBSCRIPTION',
            planSlug: 'nonexistent-plan',
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'PLAN_NOT_FOUND' }),
        });
        expect(invoiceRepository.create).not.toHaveBeenCalled();
      });

      it('throws NO_ACTIVE_SUBSCRIPTION when the teacher has no trial/active row', async () => {
        prisma.plan.findUnique.mockResolvedValue({
          id: 'plan-1',
          slug: 'teacher-monthly',
          priceUzs: 200_000,
        });
        subscriptionRepository.findActiveByTeacherId.mockResolvedValue(null);

        await expect(
          service.checkout(TEACHER_ID, 'TEACHER', {
            kind: 'TEACHER_SUBSCRIPTION',
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            code: 'NO_ACTIVE_SUBSCRIPTION',
          }),
        });
      });

      it('rejects a STUDENT trying to check out a TEACHER_SUBSCRIPTION', async () => {
        await expect(
          service.checkout(TEACHER_ID, 'STUDENT', {
            kind: 'TEACHER_SUBSCRIPTION',
          }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            code: 'WRONG_ROLE_FOR_CHECKOUT',
          }),
        });
      });
    });
  });
});
