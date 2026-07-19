import { PaymeTxState, Prisma } from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PaymeService } from './payme.service';
import { PAYME_ERROR_CODES, PaymeError } from './payme.errors';

/**
 * PaymeService unit tests (Task 4.2 + 4.3 + 4.5 scope).
 *
 * Verifies:
 *   - JSON-RPC method dispatch (unknown method → -32601, malformed params
 *     → -32602).
 *   - Per-method state transitions on `PaymeTransaction`:
 *       CheckPerformTransaction → validates Invoice + amount (Req 4.7)
 *       CreateTransaction       → idempotent on paymeId (Req 4.1, 4.8)
 *       PerformTransaction      → atomic CREATED → PAID + side effects
 *                                 (Req 4.2, 4.4, 4.5, 4.6)
 *       CancelTransaction       → CREATED → CANCELED (+ payment.failed
 *                                 outbox; Req 4.7), PAID →
 *                                 CANCELED_AFTER_PAY
 *       CheckTransaction        → returns serialization
 *       GetStatement            → date range query
 *
 * Idempotency (Req 4.4) is exercised on every method that is replay-safe:
 * Create, Perform, Cancel.
 *
 * Invalid amount (-31001) and account not found (-31050) error handling
 * (Req 4.7) is asserted on Check, Create, and Perform.
 */
describe('PaymeService', () => {
  let service: PaymeService;
  let prisma: any;
  let invoiceRepository: jest.Mocked<InvoiceRepository>;
  let subscriptionRepository: jest.Mocked<SubscriptionRepository>;
  let outboxService: jest.Mocked<OutboxService>;

  const TX_ID = '00000000-0000-0000-0000-00000000abcd';
  const PAYME_TX_ID = 'payme-id-1';
  const INVOICE_ID = '11111111-1111-1111-1111-111111111111';
  const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
  const GROUP_ID = '33333333-3333-3333-3333-333333333333';
  const TEACHER_ID = '44444444-4444-4444-4444-444444444444';
  const SUB_ID = '55555555-5555-5555-5555-555555555555';
  const AMOUNT_UZS = 50_000;
  const AMOUNT_TIYIN = AMOUNT_UZS * 100;

  function buildTx(overrides: Partial<any> = {}) {
    return {
      id: TX_ID,
      paymeId: PAYME_TX_ID,
      account: { invoiceId: INVOICE_ID },
      amountUzs: AMOUNT_UZS,
      state: PaymeTxState.CREATED,
      createTime: BigInt(1700000000000),
      performTime: null,
      cancelTime: null,
      reason: null,
      rawPayload: null,
      idempotencyKey: `payme:${PAYME_TX_ID}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function buildInvoice(overrides: Partial<any> = {}) {
    return {
      id: INVOICE_ID,
      kind: 'STUDENT_COURSE',
      status: 'PENDING',
      amountUzs: AMOUNT_UZS,
      teacherId: null,
      studentId: STUDENT_ID,
      groupId: GROUP_ID,
      subscriptionId: null,
      paymeTxId: null,
      paidAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      paymeTransaction: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      invoice: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscription: {
        findUnique: jest.fn(),
      },
      enrollmentRequest: {
        upsert: jest.fn().mockResolvedValue({ id: 'enr-1' }),
      },
      // `$transaction(fn)` runs the callback with prisma itself as the tx.
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    invoiceRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      markPaid: jest.fn().mockResolvedValue(true),
      linkPaymeTx: jest.fn(),
    } as any;

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

    service = new PaymeService(
      prisma,
      invoiceRepository,
      subscriptionRepository,
      outboxService,
    );
  });

  // ------------------------------------------------------------------
  // dispatch (router)
  // ------------------------------------------------------------------

  describe('dispatch', () => {
    it('throws -32601 for an unknown method', async () => {
      await expect(service.dispatch('TotallyMadeUp', {})).rejects.toMatchObject(
        { code: PAYME_ERROR_CODES.TRANSPORT_METHOD_NOT_FOUND },
      );
    });

    it('throws -32602 when params fail Zod validation', async () => {
      // CheckPerformTransaction requires { amount, account: { invoiceId } }
      await expect(
        service.dispatch('CheckPerformTransaction', { amount: 100 }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.TRANSPORT_INVALID_PARAMS,
      });
    });

    it('routes ChangePassword to a no-op success', async () => {
      await expect(
        service.dispatch('ChangePassword', { password: 'whatever' }),
      ).resolves.toEqual({ success: true });
    });
  });

  // ------------------------------------------------------------------
  // CheckPerformTransaction (Req 4.7)
  // ------------------------------------------------------------------

  describe('CheckPerformTransaction', () => {
    it('returns { allow: true } for a valid PENDING invoice with the correct amount', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());

      const result = await service.dispatch('CheckPerformTransaction', {
        amount: AMOUNT_TIYIN,
        account: { invoiceId: INVOICE_ID },
      });

      expect(result).toEqual({ allow: true });
    });

    it('throws -31050 ACCOUNT_NOT_FOUND when the invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('CheckPerformTransaction', {
          amount: AMOUNT_TIYIN,
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND,
      });
    });

    it.each(['PAID', 'CANCELED', 'REFUNDED'] as const)(
      'throws -31050 ACCOUNT_NOT_FOUND when the invoice is in terminal status %s',
      async (status) => {
        prisma.invoice.findUnique.mockResolvedValue(buildInvoice({ status }));

        await expect(
          service.dispatch('CheckPerformTransaction', {
            amount: AMOUNT_TIYIN,
            account: { invoiceId: INVOICE_ID },
          }),
        ).rejects.toMatchObject({
          code: PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND,
        });
      },
    );

    it('throws -31001 INVALID_AMOUNT when amount mismatches the invoice (in tiyin)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());

      await expect(
        service.dispatch('CheckPerformTransaction', {
          amount: AMOUNT_TIYIN + 1, // off by one tiyin
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.INVALID_AMOUNT,
      });
    });
  });

  // ------------------------------------------------------------------
  // CreateTransaction (Req 4.1, 4.7, 4.8)
  // ------------------------------------------------------------------

  describe('CreateTransaction', () => {
    it('inserts a new PaymeTransaction(state=CREATED) with a unique idempotencyKey and returns the JSON-RPC body', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());
      // first lookup of the paymeTransaction returns null (no existing row)
      prisma.paymeTransaction.findUnique.mockResolvedValue(null);
      // inside $transaction the create returns a fresh row
      prisma.paymeTransaction.create.mockResolvedValue(buildTx());

      const result = await service.dispatch('CreateTransaction', {
        id: PAYME_TX_ID,
        time: 1700000000000,
        amount: AMOUNT_TIYIN,
        account: { invoiceId: INVOICE_ID },
      });

      expect(prisma.paymeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymeId: PAYME_TX_ID,
            account: { invoiceId: INVOICE_ID },
            state: PaymeTxState.CREATED,
            // Req 4.8 — every PaymeTransaction has a unique idempotencyKey
            idempotencyKey: `payme:${PAYME_TX_ID}`,
          }),
        }),
      );
      // The transaction also links the PaymeTx onto the Invoice.
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: INVOICE_ID },
          data: expect.objectContaining({ paymeTxId: TX_ID }),
        }),
      );
      expect(result).toEqual({
        create_time: 1700000000000,
        transaction: TX_ID,
        state: 1, // CREATED
      });
    });

    it('throws -31050 ACCOUNT_NOT_FOUND when the invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('CreateTransaction', {
          id: PAYME_TX_ID,
          time: 1700000000000,
          amount: AMOUNT_TIYIN,
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND,
      });
      expect(prisma.paymeTransaction.create).not.toHaveBeenCalled();
    });

    it('throws -31001 INVALID_AMOUNT when amount mismatches the invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());

      await expect(
        service.dispatch('CreateTransaction', {
          id: PAYME_TX_ID,
          time: 1700000000000,
          amount: AMOUNT_TIYIN - 1,
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.INVALID_AMOUNT,
      });
      expect(prisma.paymeTransaction.create).not.toHaveBeenCalled();
    });

    it('is idempotent on the same paymeId (returns existing serialization)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());

      const result = await service.dispatch('CreateTransaction', {
        id: PAYME_TX_ID,
        time: 1700000000000,
        amount: AMOUNT_TIYIN,
        account: { invoiceId: INVOICE_ID },
      });

      expect(prisma.paymeTransaction.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ transaction: TX_ID, state: 1 });
    });

    it('throws -31050 when the existing tx has a different account.invoiceId', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({ account: { invoiceId: 'other-invoice' } }),
      );

      await expect(
        service.dispatch('CreateTransaction', {
          id: PAYME_TX_ID,
          time: 1700000000000,
          amount: AMOUNT_TIYIN,
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({ code: PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND });
    });

    it('throws -31008 when the existing tx is in a non-reusable state', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({ state: PaymeTxState.CANCELED }),
      );

      await expect(
        service.dispatch('CreateTransaction', {
          id: PAYME_TX_ID,
          time: 1700000000000,
          amount: AMOUNT_TIYIN,
          account: { invoiceId: INVOICE_ID },
        }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION,
      });
    });

    it('handles a P2002 race by re-reading and returning the winning row (Req 4.4)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());
      const winner = buildTx();
      prisma.paymeTransaction.findUnique
        .mockResolvedValueOnce(null) // first lookup — no existing row
        .mockResolvedValueOnce(winner); // re-read after race

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.18.0' },
      );
      // The create runs inside $transaction; throw from the create itself.
      prisma.paymeTransaction.create.mockRejectedValue(p2002);

      const result = await service.dispatch('CreateTransaction', {
        id: PAYME_TX_ID,
        time: 1700000000000,
        amount: AMOUNT_TIYIN,
        account: { invoiceId: INVOICE_ID },
      });

      expect(result).toMatchObject({ transaction: TX_ID, state: 1 });
    });
  });

  // ------------------------------------------------------------------
  // PerformTransaction (Req 4.2, 4.4, 4.5, 4.6)
  // ------------------------------------------------------------------

  describe('PerformTransaction', () => {
    it('atomically transitions CREATED → PAID, marks invoice PAID, and emits payment.succeeded (STUDENT_COURSE → EnrollmentRequest)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findUnique.mockResolvedValue(buildInvoice());

      const result = await service.dispatch('PerformTransaction', {
        id: PAYME_TX_ID,
      });

      // 1. Optimistic transition CREATED → PAID
      expect(prisma.paymeTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: TX_ID, state: PaymeTxState.CREATED },
        data: expect.objectContaining({ state: PaymeTxState.PAID }),
      });

      // 2. Invoice marked PAID
      expect(invoiceRepository.markPaid).toHaveBeenCalledWith(
        INVOICE_ID,
        TX_ID,
        expect.anything(),
      );

      // 3. Side effect: STUDENT_COURSE → EnrollmentRequest(PENDING_APPROVAL)
      expect(prisma.enrollmentRequest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            groupId_studentId: {
              groupId: GROUP_ID,
              studentId: STUDENT_ID,
            },
          },
          create: expect.objectContaining({
            groupId: GROUP_ID,
            studentId: STUDENT_ID,
            status: 'PENDING_APPROVAL',
            invoiceId: INVOICE_ID,
          }),
        }),
      );

      // 4. Outbox: payment.succeeded with idempotencyKey scoped to paymeId
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'payment.succeeded',
          idempotencyKey: `payment.succeeded:${PAYME_TX_ID}`,
          payload: expect.objectContaining({
            paymeId: PAYME_TX_ID,
            invoiceId: INVOICE_ID,
            invoiceKind: 'STUDENT_COURSE',
            studentId: STUDENT_ID,
            groupId: GROUP_ID,
          }),
        }),
      );

      // No subscription transition for STUDENT_COURSE
      expect(subscriptionRepository.transitionStatus).not.toHaveBeenCalled();

      expect(result).toMatchObject({ transaction: TX_ID, state: 2 });
      expect(typeof (result as any).perform_time).toBe('number');
    });

    it('TEACHER_SUBSCRIPTION: activates the subscription (TRIAL → ACTIVE) inside the same transaction (Req 4.6)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          kind: 'TEACHER_SUBSCRIPTION',
          studentId: null,
          groupId: null,
          teacherId: TEACHER_ID,
          subscriptionId: SUB_ID,
        }),
      );
      prisma.subscription.findUnique.mockResolvedValue({
        id: SUB_ID,
        teacherId: TEACHER_ID,
        status: 'TRIAL',
      });

      const result = await service.dispatch('PerformTransaction', {
        id: PAYME_TX_ID,
      });

      expect(subscriptionRepository.transitionStatus).toHaveBeenCalledWith(
        SUB_ID,
        'TRIAL',
        'ACTIVE',
        expect.anything(),
      );
      // No EnrollmentRequest for TEACHER_SUBSCRIPTION
      expect(prisma.enrollmentRequest.upsert).not.toHaveBeenCalled();
      expect(result).toMatchObject({ transaction: TX_ID, state: 2 });
    });

    it('TEACHER_SUBSCRIPTION: skips the transition when the subscription is already ACTIVE (idempotent)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          kind: 'TEACHER_SUBSCRIPTION',
          studentId: null,
          groupId: null,
          teacherId: TEACHER_ID,
          subscriptionId: SUB_ID,
        }),
      );
      prisma.subscription.findUnique.mockResolvedValue({
        id: SUB_ID,
        teacherId: TEACHER_ID,
        status: 'ACTIVE',
      });

      await service.dispatch('PerformTransaction', { id: PAYME_TX_ID });

      expect(subscriptionRepository.transitionStatus).not.toHaveBeenCalled();
    });

    it('is idempotent on PAID: returns existing perform_time and skips side effects (Req 4.4)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({
          state: PaymeTxState.PAID,
          performTime: BigInt(1700000005000),
        }),
      );

      const result = await service.dispatch('PerformTransaction', {
        id: PAYME_TX_ID,
      });

      expect(prisma.paymeTransaction.updateMany).not.toHaveBeenCalled();
      expect(invoiceRepository.markPaid).not.toHaveBeenCalled();
      expect(prisma.enrollmentRequest.upsert).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        perform_time: 1700000005000,
        transaction: TX_ID,
        state: 2,
      });
    });

    it('throws -31003 TRANSACTION_NOT_FOUND when the transaction is unknown', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('PerformTransaction', { id: 'missing' }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    });

    it('throws -31008 when the transaction is in a non-CREATED non-PAID state', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({ state: PaymeTxState.CANCELED }),
      );

      await expect(
        service.dispatch('PerformTransaction', { id: PAYME_TX_ID }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.CANNOT_PERFORM_TRANSACTION,
      });
    });

    it('throws -31050 ACCOUNT_NOT_FOUND when the linked invoice has gone missing', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('PerformTransaction', { id: PAYME_TX_ID }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.ACCOUNT_NOT_FOUND,
      });
    });

    it('handles a lost optimistic-lock race (updateMany count=0) by re-reading and returning the PAID state (Req 4.4)', async () => {
      prisma.paymeTransaction.findUnique
        .mockResolvedValueOnce(buildTx()) // initial read — CREATED
        .mockResolvedValueOnce(
          buildTx({
            state: PaymeTxState.PAID,
            performTime: BigInt(1700000099999),
          }),
        );
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.dispatch('PerformTransaction', {
        id: PAYME_TX_ID,
      });

      expect(result).toEqual({
        perform_time: 1700000099999,
        transaction: TX_ID,
        state: 2,
      });
      // Once the race is detected, side effects are not retried by us —
      // the winner already committed them.
      expect(invoiceRepository.markPaid).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // CancelTransaction (Req 4.7)
  // ------------------------------------------------------------------

  describe('CancelTransaction', () => {
    it('transitions CREATED → CANCELED, marks invoice CANCELED, and emits payment.failed (Req 4.7)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(buildTx());
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.dispatch('CancelTransaction', {
        id: PAYME_TX_ID,
        reason: 1,
      });

      expect(prisma.paymeTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: TX_ID, state: PaymeTxState.CREATED },
        data: expect.objectContaining({
          state: PaymeTxState.CANCELED,
          reason: 1,
        }),
      });
      // Invoice canceled in same tx
      expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: INVOICE_ID, status: 'PENDING' },
        data: { status: 'CANCELED' },
      });
      // Outbox: payment.failed
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'payment.failed',
          idempotencyKey: `payment.failed:${PAYME_TX_ID}`,
          payload: expect.objectContaining({
            paymeId: PAYME_TX_ID,
            invoiceId: INVOICE_ID,
            reason: 1,
          }),
        }),
      );
      expect(result).toMatchObject({ transaction: TX_ID, state: -1 });
    });

    it('transitions PAID → CANCELED_AFTER_PAY (no payment.failed emitted — refund flow handled separately)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({ state: PaymeTxState.PAID }),
      );
      prisma.paymeTransaction.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.dispatch('CancelTransaction', {
        id: PAYME_TX_ID,
        reason: 5,
      });

      expect(prisma.paymeTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: TX_ID, state: PaymeTxState.PAID },
        data: expect.objectContaining({
          state: PaymeTxState.CANCELED_AFTER_PAY,
          reason: 5,
        }),
      });
      // No invoice cancellation or payment.failed for refund path.
      expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ transaction: TX_ID, state: -2 });
    });

    it('is idempotent on already-CANCELED (Req 4.4)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({
          state: PaymeTxState.CANCELED,
          cancelTime: BigInt(1700000077777),
          reason: 1,
        }),
      );

      const result = await service.dispatch('CancelTransaction', {
        id: PAYME_TX_ID,
        reason: 1,
      });

      expect(prisma.paymeTransaction.updateMany).not.toHaveBeenCalled();
      expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        cancel_time: 1700000077777,
        transaction: TX_ID,
        state: -1,
      });
    });

    it('throws -31003 when the transaction is unknown', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('CancelTransaction', { id: 'missing', reason: 1 }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    });

    it('throws -31007 when the tx is still PENDING (never reached CREATED)', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({ state: PaymeTxState.PENDING }),
      );

      await expect(
        service.dispatch('CancelTransaction', { id: PAYME_TX_ID, reason: 1 }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.CANNOT_CANCEL_TRANSACTION,
      });
    });
  });

  // ------------------------------------------------------------------
  // CheckTransaction
  // ------------------------------------------------------------------

  describe('CheckTransaction', () => {
    it('returns the full state serialization', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(
        buildTx({
          state: PaymeTxState.PAID,
          performTime: BigInt(1700000005000),
          reason: null,
        }),
      );

      const result = await service.dispatch('CheckTransaction', {
        id: PAYME_TX_ID,
      });

      expect(result).toMatchObject({
        transaction: TX_ID,
        state: 2,
        create_time: 1700000000000,
        perform_time: 1700000005000,
      });
    });

    it('throws -31003 when the transaction is unknown', async () => {
      prisma.paymeTransaction.findUnique.mockResolvedValue(null);

      await expect(
        service.dispatch('CheckTransaction', { id: 'missing' }),
      ).rejects.toMatchObject({
        code: PAYME_ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    });
  });

  // ------------------------------------------------------------------
  // GetStatement
  // ------------------------------------------------------------------

  describe('GetStatement', () => {
    it('returns transactions in the requested date range', async () => {
      prisma.paymeTransaction.findMany.mockResolvedValue([
        buildTx({ state: PaymeTxState.PAID, performTime: BigInt(1700000005000) }),
      ]);

      const result = await service.dispatch('GetStatement', {
        from: 1699000000000,
        to: 1701000000000,
      });

      expect(prisma.paymeTransaction.findMany).toHaveBeenCalledWith({
        where: {
          createTime: {
            gte: BigInt(1699000000000),
            lte: BigInt(1701000000000),
          },
        },
        orderBy: { createTime: 'asc' },
        take: 1000,
      });
      expect((result as any).transactions).toHaveLength(1);
    });

    it('throws -32602 when from > to', async () => {
      await expect(
        service.dispatch('GetStatement', { from: 100, to: 50 }),
      ).rejects.toBeInstanceOf(PaymeError);
    });
  });
});
