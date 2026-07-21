import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAuditLog,
  Invoice,
  NotificationDelivery,
  OutboxEvent,
  PaymeTransaction,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import {
  AdminAuditService,
  AUDIT_ACTIONS,
} from './admin-audit.service';
import {
  ListFailedDeliveriesQueryDto,
  ListPaymentsQueryDto,
  ListPendingOutboxQueryDto,
  ListTeachersQueryDto,
} from './dto';
import {
  AdminUserSummary,
  PaginatedResult,
} from './admin.service';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_OUTBOX_AGE_MIN = 5;

/**
 * Public projection for the admin teacher list — User + TeacherProfile +
 * the latest non-terminal Subscription. Operations needs the
 * onboarding state (`onboardingCompletedAt`) and the subscription
 * state at a glance to triage stuck onboardings vs. dunning workflows.
 */
export interface AdminTeacherSummary {
  user: AdminUserSummary;
  profile: {
    onboardingCompletedAt: Date | null;
    publicSlug: string | null;
    headline: string | null;
    fullName: string | null;
    specialtyId: string | null;
    rating: Prisma.Decimal | null;
    studentsCount: number;
  } | null;
  subscription: {
    id: string;
    status: string;
    trialEndsAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    planId: string | null;
  } | null;
}

/**
 * Joined Payme + Invoice projection for `GET /admin/payments`.
 * Returning the invoice as a nested object (instead of an `invoiceId`
 * string) keeps the operations UI free of follow-up reads when triaging
 * a single payment.
 */
export interface AdminPaymentRow {
  paymeTransaction: PaymeTransaction;
  invoices: Invoice[];
}

/** System-wide stats summary returned by `GET /admin/system/stats`. */
export interface AdminSystemStats {
  totalUsers: number;
  activeTeachers: number;
  paidInvoicesLast30Days: number;
  pendingEnrollmentRequests: number;
  /** Failed `NotificationDelivery` rows in the last 24h (ops health). */
  failedDeliveriesLast24h: number;
  /** PENDING `OutboxEvent` rows older than 5 minutes (ops health). */
  pendingOutboxOlderThan5m: number;
}

/**
 * AdminOpsService — operations-only admin endpoints (Task 23.1).
 *
 * Owns the read-and-act surfaces an SRE/admin team needs to triage live
 * incidents: paginated user/teacher/payment lists with filters, failed
 * notification triage with re-enqueue, stuck outbox visibility and a
 * system-stats overview. Every mutation goes through `AdminAuditService`
 * so the audit-log timeline reflects the action.
 *
 * Why a separate service? `AdminService` already handles the moderation
 * + catalog surfaces (Specialty / Plan / module catalog). Splitting the
 * operations surface keeps the original service focused and lets the
 * two evolve independently — admin moderation is governed by the
 * compliance team, ops endpoints by the SRE team.
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuditService: AdminAuditService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_FANOUT)
    private readonly notificationFanoutQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TELEGRAM) private readonly telegramQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PUSH) private readonly pushQueue: Queue,
  ) {}

  // ==================================================================
  // Teachers
  // ==================================================================

  /**
   * Page through teachers for the admin operations view. Joins User +
   * TeacherProfile + latest non-terminal Subscription so the operator
   * sees the lifecycle state without follow-up reads.
   *
   * Filtering on `subscriptionStatus` is implemented as a `some` filter
   * over the user's subscriptions — there is at most one non-terminal
   * row per teacher (partial unique index, see schema), so this is
   * effectively an "exists with status" check rather than an arbitrary
   * any-row scan.
   */
  async listTeachers(
    query: ListTeachersQueryDto,
  ): Promise<PaginatedResult<AdminTeacherSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const teacherProfileFilter: Prisma.TeacherProfileWhereInput = {
      ...(query.onboarding === 'complete' && {
        onboardingCompletedAt: { not: null },
      }),
      ...(query.onboarding === 'pending' && {
        onboardingCompletedAt: null,
      }),
      ...(query.subscriptionStatus && {
        subscriptions: {
          some: { status: query.subscriptionStatus },
        },
      }),
      ...(query.q && {
        OR: [
          {
            user: {
              email: { contains: query.q, mode: 'insensitive' },
            },
          },
          {
            user: {
              username: { contains: query.q, mode: 'insensitive' },
            },
          },
          { fullName: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };

    const where: Prisma.UserWhereInput = {
      role: 'TEACHER',
      teacherProfile: teacherProfileFilter,
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          role: true,
          status: true,
          fullName: true,
          avatarUrl: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
          teacherProfile: {
            select: {
              onboardingCompletedAt: true,
              publicSlug: true,
              headline: true,
              fullName: true,
              specialtyId: true,
              rating: true,
              studentsCount: true,
              subscriptions: {
                where: {
                  status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] },
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  trialEndsAt: true,
                  currentPeriodStart: true,
                  currentPeriodEnd: true,
                  planId: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: AdminTeacherSummary[] = users.map((u) => {
      const { teacherProfile, ...userFields } = u;
      const sub = teacherProfile?.subscriptions[0] ?? null;
      return {
        user: userFields,
        profile: teacherProfile
          ? {
              onboardingCompletedAt: teacherProfile.onboardingCompletedAt,
              publicSlug: teacherProfile.publicSlug,
              headline: teacherProfile.headline,
              fullName: teacherProfile.fullName,
              specialtyId: teacherProfile.specialtyId,
              rating: teacherProfile.rating,
              studentsCount: teacherProfile.studentsCount,
            }
          : null,
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodStart: sub.currentPeriodStart,
              currentPeriodEnd: sub.currentPeriodEnd,
              planId: sub.planId,
            }
          : null,
      };
    });

    return { items, page, pageSize, total };
  }

  // ==================================================================
  // Payments
  // ==================================================================

  /**
   * Page through `PaymeTransaction` rows for ops triage, eagerly loading
   * the joined invoices. Filters compose: state (Payme tx state),
   * `invoiceStatus` and `kind` (Invoice fields), plus a `createdAt`
   * range. Composite tx state + invoice filter is implemented as a
   * `some` invoice filter; PaymeTransaction → Invoice is 1:N (Invoice
   * holds the FK to PaymeTransaction).
   */
  async listPayments(
    query: ListPaymentsQueryDto,
  ): Promise<PaginatedResult<AdminPaymentRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const invoiceFilter: Prisma.InvoiceWhereInput = {
      ...(query.invoiceStatus && { status: query.invoiceStatus }),
      ...(query.kind && { kind: query.kind }),
    };
    const hasInvoiceFilter = Object.keys(invoiceFilter).length > 0;

    const where: Prisma.PaymeTransactionWhereInput = {
      ...(query.state && { state: query.state }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
      ...(hasInvoiceFilter && {
        invoices: { some: invoiceFilter },
      }),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.paymeTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { invoices: true },
      }),
      this.prisma.paymeTransaction.count({ where }),
    ]);

    const items: AdminPaymentRow[] = transactions.map((tx) => {
      const { invoices, ...paymeFields } = tx;
      return {
        paymeTransaction: paymeFields as PaymeTransaction,
        invoices,
      };
    });

    return { items, page, pageSize, total };
  }

  // ==================================================================
  // Notifications — failed delivery triage
  // ==================================================================

  /**
   * Page through `NotificationDelivery` rows that ops needs to triage.
   * By default returns `FAILED` rows; setting `includePendingRetry=true`
   * also surfaces `PENDING_RETRY` rows still backing off in BullMQ.
   *
   * The result includes the parent Notification (so ops can see what
   * was supposed to be delivered) and the recipient User's email /
   * username (so ops can contact the user out-of-band when the channel
   * fails repeatedly).
   */
  async listFailedDeliveries(
    query: ListFailedDeliveriesQueryDto,
  ): Promise<
    PaginatedResult<
      NotificationDelivery & {
        notification: {
          id: string;
          userId: string;
          kind: string;
          title: string;
          body: string;
          user: { email: string; username: string | null };
        };
      }
    >
  > {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const statusFilter = query.includePendingRetry
      ? { in: ['FAILED', 'PENDING_RETRY'] }
      : 'FAILED';

    const where: Prisma.NotificationDeliveryWhereInput = {
      status: statusFilter,
      ...(query.channel && { channel: query.channel }),
      ...((query.from || query.to) && {
        updatedAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          notification: {
            select: {
              id: true,
              userId: true,
              kind: true,
              title: true,
              body: true,
              user: { select: { email: true, username: true } },
            },
          },
        },
      }),
      this.prisma.notificationDelivery.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }

  /**
   * Re-enqueue a failed `NotificationDelivery` (Task 23.1).
   *
   * Steps:
   *   1. Look up the delivery + parent Notification + recipient User.
   *   2. Reset the delivery row to `QUEUED` (attempt counter preserved
   *      so the audit log shows the cumulative retry count).
   *   3. Push a fresh job onto the per-channel BullMQ queue with the
   *      same `jobId = "{notifId}:{channel}"` shape used by the
   *      fan-out worker. BullMQ rejects the duplicate `jobId` only
   *      while the job is still in the queue — failed jobs are
   *      automatically removed via `removeOnFail`, so re-enqueue
   *      lands cleanly.
   *   4. Append an `AdminAuditLog` entry pointing at the Notification.
   *
   * Returns `204 No Content` semantics from the controller.
   */
  async retryFailedDelivery(
    actorId: string,
    deliveryId: string,
    context: { ip?: string | null } = {},
  ): Promise<{ deliveryId: string; channel: string; status: string }> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          select: {
            id: true,
            userId: true,
            kind: true,
            title: true,
            body: true,
            data: true,
          },
        },
      },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: `NotificationDelivery ${deliveryId} not found`,
      });
    }

    if (delivery.channel === 'IN_APP') {
      // IN_APP has no out-of-process queue — the Notification row
      // itself is the delivery. Refuse the retry so the operator does
      // not silently no-op.
      throw new NotFoundException({
        code: 'DELIVERY_NOT_RETRIABLE',
        message: 'IN_APP deliveries cannot be retried',
      });
    }

    const queue = this.queueForChannel(delivery.channel);

    // Reset the row before enqueuing so a worker that picks up the
    // job immediately sees a `QUEUED` row rather than the stale
    // FAILED state.
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'QUEUED',
        errorMsg: null,
        // `attempt` is preserved — it represents cumulative attempts.
      },
    });

    const baseJob = {
      notificationId: delivery.notification.id,
      userId: delivery.notification.userId,
      kind: delivery.notification.kind,
      title: delivery.notification.title,
      body: delivery.notification.body,
      data: delivery.notification.data ?? null,
    };
    const jobId = `${delivery.notification.id}:${delivery.channel}:retry:${Date.now()}`;
    await queue.add(
      `notification.${delivery.channel.toLowerCase()}.retry`,
      { ...baseJob, channel: delivery.channel },
      { jobId },
    );

    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.NOTIFICATION_DELIVERY_RETRIED,
      `NotificationDelivery/${deliveryId}`,
      {
        deliveryId,
        notificationId: delivery.notification.id,
        channel: delivery.channel,
        previousAttempt: delivery.attempt,
      },
      { ip: context.ip ?? null },
    );

    this.logger.log(
      `Notification delivery ${deliveryId} (channel=${delivery.channel}) re-enqueued by admin ${actorId}`,
    );

    return {
      deliveryId,
      channel: delivery.channel,
      status: 'QUEUED',
    };
  }

  // ==================================================================
  // Outbox — pending events older than X minutes
  // ==================================================================

  /**
   * Page through `OutboxEvent` rows that are still `PENDING` and have
   * been waiting longer than `olderThanMinutes` (default 5). The
   * dispatcher polls every 2 seconds, so anything older than a few
   * minutes likely indicates a stuck queue or a downstream failure.
   *
   * Filters on `topic` are useful when a known topic is misbehaving
   * (e.g. all `live.started` rows piling up after an SFU outage).
   */
  async listPendingOutbox(
    query: ListPendingOutboxQueryDto,
  ): Promise<PaginatedResult<OutboxEvent>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const olderThanMinutes = query.olderThanMinutes ?? DEFAULT_OUTBOX_AGE_MIN;
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const where: Prisma.OutboxEventWhereInput = {
      status: 'PENDING',
      createdAt: { lte: cutoff },
      ...(query.topic && { topic: query.topic }),
    };

    const [items, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.outboxEvent.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }

  // ==================================================================
  // System stats
  // ==================================================================

  /**
   * Aggregate counts powering the admin "system at a glance" panel.
   *
   * Each count is a single indexed query; running them in parallel
   * keeps the endpoint cheap even at production data sizes.
   */
  async getSystemStats(): Promise<AdminSystemStats> {
    const now = Date.now();
    const last30d = new Date(now - 30 * 24 * 60 * 60_000);
    const last24h = new Date(now - 24 * 60 * 60_000);
    const outboxCutoff = new Date(now - DEFAULT_OUTBOX_AGE_MIN * 60_000);

    const [
      totalUsers,
      activeTeachers,
      paidInvoicesLast30Days,
      pendingEnrollmentRequests,
      failedDeliveriesLast24h,
      pendingOutboxOlderThan5m,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { status: { not: 'DELETED' } },
      }),
      this.prisma.user.count({
        where: { role: 'TEACHER', status: 'ACTIVE' },
      }),
      this.prisma.invoice.count({
        where: {
          status: 'PAID',
          paidAt: { gte: last30d },
        },
      }),
      this.prisma.enrollmentRequest.count({
        where: { status: 'PENDING_APPROVAL' },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: 'FAILED',
          updatedAt: { gte: last24h },
        },
      }),
      this.prisma.outboxEvent.count({
        where: {
          status: 'PENDING',
          createdAt: { lte: outboxCutoff },
        },
      }),
    ]);

    return {
      totalUsers,
      activeTeachers,
      paidInvoicesLast30Days,
      pendingEnrollmentRequests,
      failedDeliveriesLast24h,
      pendingOutboxOlderThan5m,
    };
  }

  // ==================================================================
  // Audit logs (forwarded for ops convenience)
  // ==================================================================

  /**
   * Convenience getter — recent audit-log rows for the ops dashboard
   * sidebar. Limits to 50 rows so the response stays small even when
   * the log is large.
   */
  async listRecentAuditLogs(limit = 50): Promise<AdminAuditLog[]> {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private queueForChannel(channel: string): Queue {
    switch (channel) {
      case 'EMAIL':
        return this.emailQueue;
      case 'TELEGRAM':
        return this.telegramQueue;
      case 'PUSH':
        return this.pushQueue;
      default:
        // We have already filtered IN_APP above; treating an unknown
        // channel as a 404 keeps the contract honest.
        throw new NotFoundException({
          code: 'DELIVERY_CHANNEL_UNKNOWN',
          message: `Unknown delivery channel "${channel}"`,
        });
    }
  }
}
