import * as fc from 'fast-check';
import { Prisma, Subscription, SubscriptionStatus } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from './billing.service';
import {
  SubscriptionRepository,
  SubscriptionTransitionConflictError,
} from './repositories/subscription.repository';
import {
  InvoiceRepository,
  INVOICE_KIND,
  INVOICE_STATUS,
} from './repositories/invoice.repository';

/**
 * Property 2 — Trial / billing exclusivity
 * (Task 3.3 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * For any teacher, regardless of which legal sequence of billing operations
 * is applied:
 *
 *   I1. |{ s ∈ Subscription | s.teacherId = T ∧ s.status ∈ {TRIAL, ACTIVE,
 *        PAST_DUE} }| ≤ 1                                          (Req 3.7)
 *
 *   I2. The Billing module never *spontaneously* mints a TEACHER_SUBSCRIPTION
 *        invoice for a teacher in TRIAL — i.e. invoices are only created as
 *        a direct result of explicit `checkout` calls. Equivalently: the
 *        number of PENDING TEACHER_SUBSCRIPTION invoices for T is at most
 *        the number of `checkoutSubscription(T)` commands successfully
 *        applied since T entered TRIAL (and minus those moved out of
 *        PENDING). Per the refined Req 3.2 the explicit upgrade invoice is
 *        permitted (see Req 4.6 — TRIAL → ACTIVE on PerformTransaction).
 *                                                                  (Req 3.2)
 *
 * This file ONLY implements Property 2 from the design document.
 *
 * Validates: Requirements 3.2, 3.7
 *
 * Approach: drive the real `BillingService` (which is the only authorized
 * writer for Subscription rows per the design) over an in-memory Prisma
 * fake. The fake faithfully reproduces:
 *
 *   - the partial unique index `subscriptions_teacher_active_uniq` (raises
 *     Prisma `P2002` on a duplicate non-terminal row);
 *   - the row-level optimistic update used by `transitionStatus`
 *     (UPDATE ... WHERE id=? AND status=?).
 *
 * fast-check generates a sequence of legal command tuples per teacher;
 * after every step we assert I1 and I2 over the entire fake DB. Any
 * counterexample shrinks down to the smallest sequence that violates the
 * invariant.
 */

// ---------------------------------------------------------------------------
// Fake Prisma client (covers only the surface BillingService touches).
// ---------------------------------------------------------------------------

interface FakeSubscription {
  id: string;
  teacherId: string;
  planId: string | null;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
}

const NON_TERMINAL: ReadonlySet<SubscriptionStatus> = new Set([
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
]);

class FakeDB {
  subscriptions = new Map<string, FakeSubscription>();
  invoices = new Map<string, FakeInvoice>();
  outbox: Array<{ topic: string; payload: unknown; idempotencyKey: string }> =
    [];
  teacherProfiles = new Set<string>();
  plans = new Map<string, { id: string; slug: string; priceUzs: number }>();

  private seq = 0;

  nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }
}

/**
 * Returns true if creating/updating to `targetStatus` for `teacherId`
 * would violate the partial unique index (i.e. another non-terminal row
 * already exists for that teacher, ignoring `excludeId`).
 */
function violatesNonTerminalUnique(
  db: FakeDB,
  teacherId: string,
  targetStatus: SubscriptionStatus,
  excludeId?: string,
): boolean {
  if (!NON_TERMINAL.has(targetStatus)) return false;
  for (const sub of db.subscriptions.values()) {
    if (sub.id === excludeId) continue;
    if (sub.teacherId !== teacherId) continue;
    if (NON_TERMINAL.has(sub.status)) return true;
  }
  return false;
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`teacherId`)',
    {
      code: 'P2002',
      clientVersion: '5.18.0',
      meta: { target: ['teacherId'] },
    },
  );
}

/**
 * Build a Prisma-shaped fake. Only the subset BillingService /
 * SubscriptionRepository / InvoiceRepository / OutboxService actually use is
 * implemented; anything else throws so unintended writes surface loudly.
 */
function buildFakePrisma(db: FakeDB): any {
  const subscriptionTable = {
    findFirst: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      for (const sub of db.subscriptions.values()) {
        if (where.teacherId && sub.teacherId !== where.teacherId) continue;
        if (where.status?.in && !where.status.in.includes(sub.status))
          continue;
        return { ...sub };
      }
      return null;
    }),
    findUnique: jest.fn(async (args: any) => {
      const id = args?.where?.id;
      const sub = id ? db.subscriptions.get(id) : undefined;
      return sub ? { ...sub } : null;
    }),
    findMany: jest.fn(async () => []),
    create: jest.fn(async (args: any) => {
      const data = args.data;
      // Partial unique index check
      if (
        NON_TERMINAL.has(data.status) &&
        violatesNonTerminalUnique(db, data.teacherId, data.status)
      ) {
        throw p2002();
      }
      const now = new Date();
      const sub: FakeSubscription = {
        id: db.nextId('sub'),
        teacherId: data.teacherId,
        planId: data.planId ?? null,
        status: data.status,
        trialEndsAt: data.trialEndsAt ?? null,
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAt: data.cancelAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      db.subscriptions.set(sub.id, sub);
      return { ...sub };
    }),
    updateMany: jest.fn(async (args: any) => {
      const where = args.where;
      const data = args.data;
      let count = 0;
      for (const sub of db.subscriptions.values()) {
        if (where.id && sub.id !== where.id) continue;
        if (where.status && sub.status !== where.status) continue;
        // The partial unique index also fires on UPDATE — guard it.
        const targetStatus = (data.status ?? sub.status) as SubscriptionStatus;
        if (
          targetStatus !== sub.status &&
          violatesNonTerminalUnique(db, sub.teacherId, targetStatus, sub.id)
        ) {
          throw p2002();
        }
        sub.status = targetStatus;
        if (data.trialEndsAt !== undefined) sub.trialEndsAt = data.trialEndsAt;
        sub.updatedAt = new Date();
        count++;
      }
      return { count };
    }),
  };

  const invoiceTable = {
    create: jest.fn(async (args: any) => {
      const data = args.data;
      const inv: FakeInvoice = {
        id: db.nextId('inv'),
        kind: data.kind,
        status: data.status ?? INVOICE_STATUS.PENDING,
        amountUzs: data.amountUzs,
        teacherId: data.teacherId ?? null,
        subscriptionId: data.subscriptionId ?? null,
        studentId: data.studentId ?? null,
        groupId: data.groupId ?? null,
      };
      db.invoices.set(inv.id, inv);
      return { ...inv };
    }),
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
    updateMany: jest.fn(async () => ({ count: 0 })),
  };

  const teacherProfileTable = {
    upsert: jest.fn(async (args: any) => {
      const userId = args.where.userId;
      db.teacherProfiles.add(userId);
      return { userId };
    }),
  };

  const planTable = {
    findUnique: jest.fn(async (args: any) => {
      const slug = args?.where?.slug;
      const plan = slug ? db.plans.get(slug) : undefined;
      return plan ? { ...plan } : null;
    }),
  };

  const groupTable = {
    findUnique: jest.fn(async () => null),
  };

  // Outbox is a real Prisma table from BillingService's perspective.
  const outboxEventTable = {
    create: jest.fn(async (args: any) => {
      const data = args.data;
      db.outbox.push({
        topic: data.topic,
        payload: data.payload,
        idempotencyKey: data.idempotencyKey,
      });
      return { id: db.nextId('outbox') };
    }),
  };

  const fake: any = {
    subscription: subscriptionTable,
    invoice: invoiceTable,
    teacherProfile: teacherProfileTable,
    plan: planTable,
    group: groupTable,
    outboxEvent: outboxEventTable,
    $transaction: jest.fn(async (fn: any) => fn(fake)),
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

function checkInvariants(
  db: FakeDB,
  label: string,
  explicitCheckoutInvoicesPerTeacher: Map<string, number>,
): void {
  // I1 — at most one non-terminal subscription per teacher (Req 3.7)
  const nonTerminalByTeacher = new Map<string, number>();
  for (const sub of db.subscriptions.values()) {
    if (NON_TERMINAL.has(sub.status)) {
      nonTerminalByTeacher.set(
        sub.teacherId,
        (nonTerminalByTeacher.get(sub.teacherId) ?? 0) + 1,
      );
    }
  }
  for (const [teacherId, count] of nonTerminalByTeacher) {
    if (count > 1) {
      throw new Error(
        `[I1 violated after ${label}] teacher ${teacherId} has ${count} non-terminal subscriptions`,
      );
    }
  }

  // I2 — Billing never SPONTANEOUSLY mints a TEACHER_SUBSCRIPTION invoice
  //      for a teacher in TRIAL (Req 3.2 — refined to permit the explicit
  //      upgrade invoice produced by `POST /billing/checkout`, see Req 4.6).
  //
  //      Equivalent operational check: the count of TEACHER_SUBSCRIPTION
  //      invoices for T must never exceed the number of explicit
  //      `checkoutSubscription(T)` commands successfully applied so far.
  const teacherSubInvoicesByTeacher = new Map<string, number>();
  for (const inv of db.invoices.values()) {
    if (inv.kind !== INVOICE_KIND.TEACHER_SUBSCRIPTION) continue;
    if (!inv.teacherId) continue;
    teacherSubInvoicesByTeacher.set(
      inv.teacherId,
      (teacherSubInvoicesByTeacher.get(inv.teacherId) ?? 0) + 1,
    );
  }
  for (const [teacherId, invoiceCount] of teacherSubInvoicesByTeacher) {
    const explicitCount = explicitCheckoutInvoicesPerTeacher.get(teacherId) ?? 0;
    if (invoiceCount > explicitCount) {
      throw new Error(
        `[I2 violated after ${label}] teacher ${teacherId} has ${invoiceCount} TEACHER_SUBSCRIPTION invoices ` +
          `but only ${explicitCount} explicit checkoutSubscription calls succeeded — ` +
          `Billing module spontaneously minted invoices during TRIAL/ACTIVE/PAST_DUE state.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Command model
// ---------------------------------------------------------------------------

const TEACHERS = ['t1', 't2'] as const;
type Teacher = (typeof TEACHERS)[number];

type Command =
  | { kind: 'startTrial'; teacher: Teacher }
  | { kind: 'activate'; teacher: Teacher }
  | { kind: 'markPastDue'; teacher: Teacher }
  | { kind: 'expireTrial'; teacher: Teacher }
  | { kind: 'expirePastDue'; teacher: Teacher }
  | { kind: 'cancel'; teacher: Teacher }
  | { kind: 'checkoutSubscription'; teacher: Teacher };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('startTrial' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('activate' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('markPastDue' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('expireTrial' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('expirePastDue' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('cancel' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
  fc.record({
    kind: fc.constant('checkoutSubscription' as const),
    teacher: fc.constantFrom(...TEACHERS),
  }),
);

function findActive(db: FakeDB, teacherId: string): FakeSubscription | null {
  for (const sub of db.subscriptions.values()) {
    if (sub.teacherId === teacherId && NON_TERMINAL.has(sub.status))
      return sub;
  }
  return null;
}

/**
 * Apply a single command. We swallow the *expected* application-level
 * exceptions (BadRequest/NotFound/Forbidden) — those are the
 * service's correct response when the caller violates a precondition.
 * What we never tolerate is the invariant being broken or an unexpected
 * exception class.
 */
async function applyCommand(
  service: BillingService,
  db: FakeDB,
  cmd: Command,
  explicitCheckoutInvoicesPerTeacher: Map<string, number>,
): Promise<void> {
  const expected = (err: unknown): boolean => {
    if (!err || typeof err !== 'object') return false;
    const name = (err as { name?: string }).name;
    return (
      name === 'BadRequestException' ||
      name === 'NotFoundException' ||
      name === 'ForbiddenException' ||
      err instanceof SubscriptionTransitionConflictError
    );
  };

  try {
    switch (cmd.kind) {
      case 'startTrial':
        await service.startTrial(cmd.teacher);
        return;
      case 'checkoutSubscription':
        await service.checkout(cmd.teacher, 'TEACHER', {
          kind: 'TEACHER_SUBSCRIPTION',
          planSlug: 'teacher-monthly',
        } as any);
        // Only counted on success — failed checkouts don't mint an invoice.
        explicitCheckoutInvoicesPerTeacher.set(
          cmd.teacher,
          (explicitCheckoutInvoicesPerTeacher.get(cmd.teacher) ?? 0) + 1,
        );
        return;
      case 'activate': {
        const sub = findActive(db, cmd.teacher);
        if (!sub) return; // nothing to activate; service would 404
        await service.activate(sub.id);
        return;
      }
      case 'markPastDue': {
        const sub = findActive(db, cmd.teacher);
        if (!sub) return;
        await service.markPastDue(sub.id);
        return;
      }
      case 'expireTrial': {
        const sub = findActive(db, cmd.teacher);
        if (!sub) return;
        await service.expireTrial(sub.id);
        return;
      }
      case 'expirePastDue': {
        const sub = findActive(db, cmd.teacher);
        if (!sub) return;
        await service.expirePastDue(sub.id);
        return;
      }
      case 'cancel': {
        const sub = findActive(db, cmd.teacher);
        if (!sub) return;
        await service.cancel(sub.id);
        return;
      }
    }
  } catch (err) {
    if (!expected(err)) throw err;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('BillingService — Property 2: Trial / billing exclusivity', () => {
  it('preserves I1 (≤1 non-terminal subscription per teacher) and I2 (no spontaneously-minted TEACHER_SUBSCRIPTION invoices) over arbitrary command sequences [Validates: Requirements 3.2, 3.7]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(commandArb, { minLength: 1, maxLength: 25 }),
        async (commands) => {
          // Fresh world per run
          const db = new FakeDB();
          db.plans.set('teacher-monthly', {
            id: 'plan-1',
            slug: 'teacher-monthly',
            priceUzs: 99000,
          });

          const prisma = buildFakePrisma(db);
          const subscriptionRepository = new SubscriptionRepository(
            prisma as any,
          );
          const invoiceRepository = new InvoiceRepository(prisma as any);
          const outboxService = {
            create: jest.fn(async (tx: any, evt: any) => {
              await tx.outboxEvent.create({ data: evt });
              return 'outbox-id';
            }),
          } as unknown as OutboxService;
          const config = {
            get: (key: string) => {
              if (key === 'PAYME_MERCHANT_ID') return 'demo';
              if (key === 'PAYME_CHECKOUT_URL')
                return 'https://checkout.paycom.uz';
              return undefined;
            },
          } as any;

          const service = new BillingService(
            prisma,
            subscriptionRepository,
            outboxService,
            invoiceRepository,
            config,
          );

          // Tracks how many explicit `checkoutSubscription` calls have
          // succeeded per teacher — the upper bound on TEACHER_SUBSCRIPTION
          // invoices that may legally exist (Req 3.2 refined / Req 4.6).
          const explicitCheckoutInvoicesPerTeacher = new Map<string, number>();

          // Initial state trivially satisfies the invariants.
          checkInvariants(db, 'init', explicitCheckoutInvoicesPerTeacher);

          for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i]!;
            await applyCommand(
              service,
              db,
              cmd,
              explicitCheckoutInvoicesPerTeacher,
            );
            checkInvariants(
              db,
              `step ${i} (${cmd.kind} on ${cmd.teacher})`,
              explicitCheckoutInvoicesPerTeacher,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* eslint-disable @typescript-eslint/no-unused-vars */
type _AssertSubscriptionShape = Subscription;
