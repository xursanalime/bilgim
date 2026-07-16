import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  Subscription,
  SubscriptionStatus,
} from '@prisma/client';

/**
 * Thrown by `transitionStatus` when no row matched the
 * `(id, currentStatus)` precondition. Either the subscription does not exist
 * or another caller already moved it out of `fromStatus` (lost-update guard).
 */
export class SubscriptionTransitionConflictError extends Error {
  constructor(
    public readonly subscriptionId: string,
    public readonly fromStatus: SubscriptionStatus,
    public readonly toStatus: SubscriptionStatus,
  ) {
    super(
      `Subscription ${subscriptionId} is not in expected status ${fromStatus} (cannot transition to ${toStatus})`,
    );
    this.name = 'SubscriptionTransitionConflictError';
  }
}

/**
 * SubscriptionRepository — Prisma-based CRUD for the Subscription table
 * (mapped to the `subscriptions` SQL table via Prisma `@@map`).
 *
 * Owned by the billing module. Other modules MUST NOT write to this table
 * directly; they should call BillingService.
 */
@Injectable()
export class SubscriptionRepository {
  /** Statuses that count as a teacher's "currently usable" subscription. */
  static readonly NON_TERMINAL_STATUSES: SubscriptionStatus[] = [
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
  ];

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find the teacher's currently active (non-terminal) subscription, if any.
   *
   * The DB enforces that at most one row exists in `(TRIAL | ACTIVE | PAST_DUE)`
   * per teacher (partial unique index `subscriptions_teacher_active_uniq`), so
   * `findFirst` is safe here.
   */
  async findActiveByTeacherId(
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    const client = tx ?? this.prisma;
    return client.subscription.findFirst({
      where: {
        teacherId,
        status: { in: SubscriptionRepository.NON_TERMINAL_STATUSES },
      },
    });
  }

  /**
   * Lookup by primary key.
   */
  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    const client = tx ?? this.prisma;
    return client.subscription.findUnique({ where: { id } });
  }

  /**
   * Create a TRIAL subscription. Caller must ensure no active subscription
   * already exists; the DB partial unique index will reject duplicates with a
   * P2002 error if a race occurs.
   */
  async createTrial(
    input: { teacherId: string; trialEndsAt: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;
    return client.subscription.create({
      data: {
        teacherId: input.teacherId,
        planId: null,
        status: 'TRIAL',
        trialEndsAt: input.trialEndsAt,
      },
    });
  }

  /**
   * Find TRIAL subscriptions whose `trialEndsAt` has elapsed (Req 3.3).
   *
   * Used by the hourly cron `expireTrialsCron` to find candidates for
   * TRIAL → EXPIRED. Bounded by `take` to keep each batch small and avoid
   * lock contention.
   */
  async findExpiredTrials(
    now: Date,
    take = 50,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription[]> {
    const client = tx ?? this.prisma;
    return client.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: { lte: now },
      },
      orderBy: { trialEndsAt: 'asc' },
      take,
    });
  }

  /**
   * Find PAST_DUE subscriptions that have been stuck in PAST_DUE for ≥7 days
   * (Req 3.6).
   *
   * `thresholdDate` is `now - 7 days`. We compare against `updatedAt` because
   * PAST_DUE entry rewrites that column — there is no dedicated
   * `pastDueSince` field on Subscription. This is safe because the only
   * server-side write that touches a PAST_DUE row's `updatedAt` is a state
   * transition, and PAST_DUE → PAST_DUE is rejected by the state machine.
   */
  async findExpiredPastDue(
    thresholdDate: Date,
    take = 50,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription[]> {
    const client = tx ?? this.prisma;
    return client.subscription.findMany({
      where: {
        status: 'PAST_DUE',
        updatedAt: { lte: thresholdDate },
      },
      orderBy: { updatedAt: 'asc' },
      take,
    });
  }

  /**
   * Atomically transition a subscription from `fromStatus` to `toStatus`.
   *
   * Implemented as a single `UPDATE ... WHERE id = ? AND status = ?` so that
   * concurrent transition attempts cannot both succeed (the second one's
   * WHERE clause matches zero rows). If zero rows are updated we throw
   * `SubscriptionTransitionConflictError` so the caller can decide whether to
   * retry, ignore, or surface the error.
   *
   * The state-machine `canTransition` check is the caller's responsibility —
   * this repo only enforces the row-level precondition.
   */
  async transitionStatus(
    subscriptionId: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<Subscription> {
    const client = tx ?? this.prisma;

    // updateMany with a status precondition is atomic at the row level and
    // returns the count of affected rows — this is the standard pattern for
    // optimistic state transitions in Prisma.
    const result = await client.subscription.updateMany({
      where: { id: subscriptionId, status: fromStatus },
      data: { status: toStatus },
    });

    if (result.count === 0) {
      throw new SubscriptionTransitionConflictError(
        subscriptionId,
        fromStatus,
        toStatus,
      );
    }

    // Re-read the row so callers get the fresh state (updateMany doesn't
    // return the row in Prisma).
    const updated = await client.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!updated) {
      // Should be unreachable: we just updated it in the same tx.
      throw new SubscriptionTransitionConflictError(
        subscriptionId,
        fromStatus,
        toStatus,
      );
    }
    return updated;
  }
}
