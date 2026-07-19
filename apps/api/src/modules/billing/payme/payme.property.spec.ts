import * as fc from 'fast-check';
import { PaymeTxState, Prisma } from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import {
  InvoiceRepository,
  INVOICE_KIND,
  INVOICE_STATUS,
} from '../repositories/invoice.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PaymeService } from './payme.service';

/**
 * Property 5 — Payment to Enrollment atomicity
 * (Task 4.4 from .kiro/specs/edubridge-platform/tasks.md)
 *
 *   ∀ paymeWebhook(method=PerformTransaction, paymeId=p):
 *     after_handler:
 *       PaymeTransaction(paymeId=p).state = PAID
 *       ⟹ ∃! Invoice(status=PAID, paymeTxId=p.txId)
 *          ∧ if invoice.kind = STUDENT_COURSE
 *              then ∃! EnrollmentRequest(invoiceId=invoice.id, status=PENDING_APPROVAL)
 *          ∧ ∃! OutboxEvent(idempotencyKey="payment.succeeded:" + paymeId)
 *     webhook is idempotent: invoking twice produces the same DB state.
 *
 * Chaos test: invoke `PerformTransaction` 5× concurrently per run; assert
 * exactly one Invoice transition (PENDING→PAID), exactly one
 * EnrollmentRequest row created (for STUDENT_COURSE), and exactly one
 * `payment.succeeded` OutboxEvent with the canonical idempotency key.
 *
 * Validates: Requirements 4.2, 4.4, 4.5, 19.4
 *
 * Approach: drive the real `PaymeService` over an in-memory Prisma fake.
 * The fake faithfully reproduces the optimistic-lock semantics that the
 * production code relies on for atomicity:
 *
 *   - `paymeTransaction.updateMany WHERE state=CREATED` matches at most
 *     once per concurrent call set (the winner) — losers see count=0
 *     and the service throws `RaceLostError`, recovers via re-read, and
 *     returns the winner's serialization.
 *   - `invoice.updateMany WHERE id=? AND status=PENDING` (Invoice
 *     PENDING→PAID) is also row-atomic — only the winner mutates.
 *   - `enrollmentRequest.upsert` keys on the unique `(groupId, studentId)`
 *     pair, so even if multiple callers reached the side-effect block the
 *     row count would still be 1.
 *   - `OutboxService.create` dedups on `idempotencyKey` (mirrors the
 *     production `ON CONFLICT (idempotencyKey) DO NOTHING`).
 *
 * fast-check generates a fresh (paymeId, invoiceKind, amount, ids) world
 * per run and we assert the invariants on the post-state.
 */

// ---------------------------------------------------------------------------
// Fake Prisma client (covers only the surface PaymeService touches).
// ---------------------------------------------------------------------------

interface FakePaymeTransaction {
  id: string;
  paymeId: string | null;
  account: { invoiceId?: string } | null;
  amountUzs: number;
  state: PaymeTxState;
  createTime: bigint | null;
  performTime: bigint | null;
  cancelTime: bigint | null;
  reason: number | null;
  idempotencyKey: string;
}

interface FakeInvoice {
  id: string;
  kind: 'STUDENT_COURSE' | 'TEACHER_SUBSCRIPTION';
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'REFUNDED';
  amountUzs: number;
  teacherId: string | null;
  subscriptionId: string | null;
  studentId: string | null;
  groupId: string | null;
  paymeTxId: string | null;
  paidAt: Date | null;
}

interface FakeSubscription {
  id: string;
  teacherId: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
}

interface FakeEnrollmentRequest {
  id: string;
  groupId: string;
  studentId: string;
  invoiceId: string | null;
  status:
    | 'PENDING_PAYMENT'
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'REJECTED'
    | 'REVOKED';
}

interface FakeOutboxRow {
  id: string;
  topic: string;
  payload: unknown;
  idempotencyKey: string;
}

class FakeDB {
  paymeTransactions = new Map<string, FakePaymeTransaction>();
  /** Reverse index by paymeId for findUnique({ where: { paymeId } }). */
  paymeTxByPaymeId = new Map<string, string>();
  invoices = new Map<string, FakeInvoice>();
  subscriptions = new Map<string, FakeSubscription>();
  enrollmentRequests = new Map<string, FakeEnrollmentRequest>();
  outbox: FakeOutboxRow[] = [];

  /** Counters that prove the row-level lock fires exactly once. */
  invoicePendingToPaidWins = 0;
  paymeTxCreatedToPaidWins = 0;
  enrollmentRequestCreates = 0;

  private seq = 0;
  nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
}

function buildFakePrisma(db: FakeDB): any {
  const paymeTransactionTable = {
    findUnique: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      if (where.id) {
        const tx = db.paymeTransactions.get(where.id);
        return tx ? { ...tx } : null;
      }
      if (where.paymeId) {
        const id = db.paymeTxByPaymeId.get(where.paymeId);
        const tx = id ? db.paymeTransactions.get(id) : undefined;
        return tx ? { ...tx } : null;
      }
      return null;
    }),
    updateMany: jest.fn(async (args: any) => {
      const where = args.where;
      const data = args.data;
      let count = 0;
      for (const tx of db.paymeTransactions.values()) {
        if (where.id && tx.id !== where.id) continue;
        if (where.state && tx.state !== where.state) continue;
        // Atomic mutation — no awaits inside this body, so this
        // synchronously commits before any concurrent call can race in.
        if (
          where.state === PaymeTxState.CREATED &&
          data.state === PaymeTxState.PAID
        ) {
          db.paymeTxCreatedToPaidWins += 1;
        }
        if (data.state !== undefined) tx.state = data.state;
        if (data.performTime !== undefined) tx.performTime = data.performTime;
        if (data.cancelTime !== undefined) tx.cancelTime = data.cancelTime;
        if (data.reason !== undefined) tx.reason = data.reason;
        count++;
      }
      return { count };
    }),
  };

  const invoiceTable = {
    findUnique: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const inv = id ? db.invoices.get(id) : undefined;
      return inv ? { ...inv } : null;
    }),
    update: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const inv = id ? db.invoices.get(id) : undefined;
      if (!inv) throw new Error(`Invoice ${id} not found`);
      Object.assign(inv, args.data);
      return { ...inv };
    }),
    updateMany: jest.fn(async (args: any) => {
      const where = args.where;
      const data = args.data;
      let count = 0;
      for (const inv of db.invoices.values()) {
        if (where.id && inv.id !== where.id) continue;
        if (where.status && inv.status !== where.status) continue;
        if (
          where.status === INVOICE_STATUS.PENDING &&
          data.status === INVOICE_STATUS.PAID
        ) {
          db.invoicePendingToPaidWins += 1;
        }
        if (data.status !== undefined) inv.status = data.status;
        if (data.paidAt !== undefined) inv.paidAt = data.paidAt;
        if (data.paymeTxId !== undefined) inv.paymeTxId = data.paymeTxId;
        count++;
      }
      return { count };
    }),
  };

  const subscriptionTable = {
    findUnique: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const sub = id ? db.subscriptions.get(id) : undefined;
      return sub ? { ...sub } : null;
    }),
    updateMany: jest.fn(async (args: any) => {
      const where = args.where;
      const data = args.data;
      let count = 0;
      for (const sub of db.subscriptions.values()) {
        if (where.id && sub.id !== where.id) continue;
        if (where.status && sub.status !== where.status) continue;
        if (data.status !== undefined) sub.status = data.status;
        count++;
      }
      return { count };
    }),
  };

  const enrollmentRequestTable = {
    upsert: jest.fn(async (args: any) => {
      const compositeKey = args?.where?.groupId_studentId;
      if (!compositeKey)
        throw new Error('enrollmentRequest.upsert requires groupId_studentId');
      const { groupId, studentId } = compositeKey;
      // Find existing by (groupId, studentId).
      let existing: FakeEnrollmentRequest | undefined;
      for (const er of db.enrollmentRequests.values()) {
        if (er.groupId === groupId && er.studentId === studentId) {
          existing = er;
          break;
        }
      }
      if (existing) {
        Object.assign(existing, args.update ?? {});
        return { ...existing };
      }
      // Create branch — counts as a real "exactly one EnrollmentRequest
      // created" event for Property 5.
      db.enrollmentRequestCreates += 1;
      const created: FakeEnrollmentRequest = {
        id: db.nextId('enr'),
        groupId,
        studentId,
        invoiceId: args.create?.invoiceId ?? null,
        status: args.create?.status ?? 'PENDING_APPROVAL',
      };
      db.enrollmentRequests.set(created.id, created);
      return { ...created };
    }),
  };

  // OutboxEvent table — production code uses `tx.$executeRaw` with an
  // `INSERT ... ON CONFLICT (idempotencyKey) DO NOTHING`. The
  // OutboxService stub below talks directly to this table so we still
  // get a faithful "create or skip" record.
  const outboxEventTable = {
    create: jest.fn(async (args: any) => {
      const data = args.data;
      // Deduplicate on idempotencyKey — same semantics as the real
      // ON CONFLICT (idempotencyKey) DO NOTHING (Req 19.4).
      if (
        db.outbox.some((e) => e.idempotencyKey === data.idempotencyKey)
      ) {
        return null;
      }
      const row: FakeOutboxRow = {
        id: db.nextId('outbox'),
        topic: data.topic,
        payload: data.payload,
        idempotencyKey: data.idempotencyKey,
      };
      db.outbox.push(row);
      return { ...row };
    }),
  };

  const fake: any = {
    paymeTransaction: paymeTransactionTable,
    invoice: invoiceTable,
    subscription: subscriptionTable,
    enrollmentRequest: enrollmentRequestTable,
    outboxEvent: outboxEventTable,
    // Real Prisma serializes a $transaction(fn) at the DB level. JS is
    // single-threaded; each fake op body is synchronous between awaits,
    // which is the only atomicity the production optimistic-lock pattern
    // depends on. We deliberately do NOT serialize concurrent
    // $transaction callbacks here — that is exactly the chaos we want
    // to expose.
    $transaction: jest.fn(async (fn: any) => fn(fake)),
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('PaymeService — Property 5: Payment to Enrollment atomicity', () => {
  it('5x concurrent PerformTransaction yields exactly one Invoice transition, EnrollmentRequest, and OutboxEvent [Validates: Requirements 4.2, 4.4, 4.5, 19.4]', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Vary the invoice kind so we cover both side-effect branches.
        fc.constantFrom(
          INVOICE_KIND.STUDENT_COURSE,
          INVOICE_KIND.TEACHER_SUBSCRIPTION,
        ),
        // Reasonable amount (in so'm). Shrunk values stay > 0.
        fc.integer({ min: 1_000, max: 10_000_000 }),
        // Distinguishable suffix so generators don't collide per shrink.
        fc.integer({ min: 1, max: 1_000_000 }),
        async (kind, amountUzs, suffix) => {
          const db = new FakeDB();

          const paymeId = `payme-${suffix}`;
          const txId = `tx-${suffix}`;
          const invoiceId = `inv-${suffix}`;
          const studentId = `student-${suffix}`;
          const teacherId = `teacher-${suffix}`;
          const groupId = `group-${suffix}`;
          const subscriptionId = `sub-${suffix}`;

          // Seed PaymeTransaction (CREATED) — the precondition for
          // PerformTransaction in production.
          const paymeTx: FakePaymeTransaction = {
            id: txId,
            paymeId,
            account: { invoiceId },
            amountUzs,
            state: PaymeTxState.CREATED,
            createTime: BigInt(1700000000000),
            performTime: null,
            cancelTime: null,
            reason: null,
            idempotencyKey: `payme:${paymeId}`,
          };
          db.paymeTransactions.set(txId, paymeTx);
          db.paymeTxByPaymeId.set(paymeId, txId);

          // Seed Invoice (PENDING) and (for TEACHER_SUBSCRIPTION) a TRIAL
          // Subscription that the side-effect path will activate.
          if (kind === INVOICE_KIND.STUDENT_COURSE) {
            db.invoices.set(invoiceId, {
              id: invoiceId,
              kind,
              status: INVOICE_STATUS.PENDING,
              amountUzs,
              teacherId: null,
              subscriptionId: null,
              studentId,
              groupId,
              paymeTxId: txId,
              paidAt: null,
            });
          } else {
            db.subscriptions.set(subscriptionId, {
              id: subscriptionId,
              teacherId,
              status: 'TRIAL',
            });
            db.invoices.set(invoiceId, {
              id: invoiceId,
              kind,
              status: INVOICE_STATUS.PENDING,
              amountUzs,
              teacherId,
              subscriptionId,
              studentId: null,
              groupId: null,
              paymeTxId: txId,
              paidAt: null,
            });
          }

          // Build the system under test.
          const prisma = buildFakePrisma(db);
          const invoiceRepository = new InvoiceRepository(prisma);
          const subscriptionRepository = new SubscriptionRepository(prisma);
          const outboxService = {
            // Mirror the real OutboxService.create contract: write into
            // the outboxEvent table within the supplied tx, dedup on
            // idempotencyKey. Returns null on conflict (Req 19.4).
            create: jest.fn(async (tx: any, evt: any) => {
              const row = await tx.outboxEvent.create({ data: evt });
              return row?.id ?? null;
            }),
          } as unknown as OutboxService;

          const service = new PaymeService(
            prisma,
            invoiceRepository,
            subscriptionRepository,
            outboxService,
          );

          // Fire 5 concurrent PerformTransaction calls. None of them
          // should throw — losers must recover via the lost-race re-read
          // path and return the winner's serialization (idempotent).
          const dispatches = await Promise.allSettled(
            Array.from({ length: 5 }, () =>
              service.dispatch('PerformTransaction', { id: paymeId }),
            ),
          );

          // ----------------------------------------------------------------
          // Invariant assertions
          // ----------------------------------------------------------------

          // 1. All 5 dispatches resolved (no thrown errors). The lost-race
          //    path must always converge to a successful idempotent return.
          for (const r of dispatches) {
            if (r.status !== 'fulfilled') {
              throw new Error(
                `PerformTransaction threw under concurrency: ${
                  (r.reason as Error)?.message ?? r.reason
                }`,
              );
            }
            const v = r.value as { state?: number; transaction?: string };
            if (v.state !== 2) {
              throw new Error(
                `Expected state=2 (PAID) from every concurrent caller, got ${JSON.stringify(v)}`,
              );
            }
            if (v.transaction !== txId) {
              throw new Error(
                `Expected transaction=${txId} from every concurrent caller, got ${v.transaction}`,
              );
            }
          }

          // 2. PaymeTransaction is PAID, and the optimistic CREATED→PAID
          //    transition fired exactly once (Req 4.4, 19.4).
          const finalTx = db.paymeTransactions.get(txId)!;
          expect(finalTx.state).toBe(PaymeTxState.PAID);
          expect(db.paymeTxCreatedToPaidWins).toBe(1);

          // 3. Exactly one Invoice update PENDING→PAID (Req 4.2).
          const finalInvoice = db.invoices.get(invoiceId)!;
          expect(finalInvoice.status).toBe(INVOICE_STATUS.PAID);
          expect(finalInvoice.paymeTxId).toBe(txId);
          expect(db.invoicePendingToPaidWins).toBe(1);

          // 4. EnrollmentRequest semantics per invoice kind (Req 4.5).
          const enrollmentRequests = Array.from(
            db.enrollmentRequests.values(),
          );
          if (kind === INVOICE_KIND.STUDENT_COURSE) {
            expect(db.enrollmentRequestCreates).toBe(1);
            expect(enrollmentRequests).toHaveLength(1);
            const er = enrollmentRequests[0]!;
            expect(er.status).toBe('PENDING_APPROVAL');
            expect(er.groupId).toBe(groupId);
            expect(er.studentId).toBe(studentId);
            expect(er.invoiceId).toBe(invoiceId);
          } else {
            // TEACHER_SUBSCRIPTION must NEVER produce an EnrollmentRequest.
            expect(db.enrollmentRequestCreates).toBe(0);
            expect(enrollmentRequests).toHaveLength(0);
            // ...and the subscription must be ACTIVE (TRIAL → ACTIVE).
            const sub = db.subscriptions.get(subscriptionId)!;
            expect(sub.status).toBe('ACTIVE');
          }

          // 5. Exactly one `payment.succeeded` OutboxEvent with the
          //    canonical idempotency key (Req 19.4).
          const successEvents = db.outbox.filter(
            (e) =>
              e.topic === 'payment.succeeded' &&
              e.idempotencyKey === `payment.succeeded:${paymeId}`,
          );
          expect(successEvents).toHaveLength(1);
          const payload = successEvents[0]!.payload as Record<string, unknown>;
          expect(payload.paymeId).toBe(paymeId);
          expect(payload.invoiceId).toBe(invoiceId);
          expect(payload.invoiceKind).toBe(kind);
          expect(payload.amountUzs).toBe(amountUzs);
        },
      ),
      { numRuns: 50 },
    );
  });
});

/* eslint-disable @typescript-eslint/no-unused-vars */
type _AssertPrismaImported = Prisma.TransactionClient;
