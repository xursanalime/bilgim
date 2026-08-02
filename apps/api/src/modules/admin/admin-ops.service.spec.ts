import { NotFoundException } from '@nestjs/common';

import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import { AdminOpsService } from './admin-ops.service';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000aa';
const NOTIF_ID = '11111111-1111-1111-1111-111111111111';
const DELIVERY_ID = '22222222-2222-2222-2222-222222222222';
const TX_ID = '33333333-3333-3333-3333-333333333333';

/**
 * AdminOpsService unit tests — Task 23.1.
 *
 * Coverage:
 *   - listTeachers: filter projection (subscriptionStatus, onboarding, q),
 *     pagination math, joined subscription summary.
 *   - listPayments: filter projection (state, invoiceStatus, kind,
 *     date range), pagination, invoices joined.
 *   - listFailedDeliveries: defaults to FAILED, opt-in includes
 *     PENDING_RETRY, channel/date filters compose.
 *   - retryFailedDelivery: re-enqueues a fresh job onto the channel
 *     queue, resets the row to QUEUED, writes a single audit row, and
 *     refuses IN_APP / unknown deliveries.
 *   - listPendingOutbox: filters on age + topic, default 5 minutes.
 *   - getSystemStats: aggregates the documented counts in parallel.
 *   - listRecentAuditLogs: clamps the limit and orders desc.
 */
describe('AdminOpsService', () => {
  let service: AdminOpsService;
  let prisma: any;
  let auditService: jest.Mocked<AdminAuditService>;
  let notificationFanoutQueue: { add: jest.Mock };
  let emailQueue: { add: jest.Mock };
  let telegramQueue: { add: jest.Mock };
  let pushQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      paymeTransaction: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      notificationDelivery: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      outboxEvent: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      adminAuditLog: {
        findMany: jest.fn(),
      },
      invoice: { count: jest.fn() },
      enrollmentRequest: { count: jest.fn() },
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    notificationFanoutQueue = { add: jest.fn().mockResolvedValue({ id: 'f' }) };
    emailQueue = { add: jest.fn().mockResolvedValue({ id: 'e' }) };
    telegramQueue = { add: jest.fn().mockResolvedValue({ id: 't' }) };
    pushQueue = { add: jest.fn().mockResolvedValue({ id: 'p' }) };

    service = new AdminOpsService(
      prisma,
      auditService,
      notificationFanoutQueue as any,
      emailQueue as any,
      telegramQueue as any,
      pushQueue as any,
    );
  });

  // ==================================================================
  // listTeachers
  // ==================================================================

  describe('listTeachers', () => {
    it('builds a TeacherProfile filter from subscriptionStatus/onboarding/q and projects the joined summary', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          email: 't@e.com',
          username: 'tt',
          phone: null,
          role: 'TEACHER',
          status: 'ACTIVE',
          fullName: 'T',
          avatarUrl: null,
          locale: 'uz',
          createdAt: new Date(),
          updatedAt: new Date(),
          teacherProfile: {
            onboardingCompletedAt: new Date('2024-01-01'),
            publicSlug: 't',
            headline: 'h',
            fullName: 'T full',
            specialtyId: 'sp1',
            rating: null,
            studentsCount: 0,
            subscriptions: [
              {
                id: 'sub1',
                status: 'PAST_DUE',
                trialEndsAt: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
                planId: 'plan1',
              },
            ],
          },
        },
      ]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.listTeachers({
        subscriptionStatus: 'PAST_DUE',
        onboarding: 'complete',
        q: 'alice',
        page: 1,
        pageSize: 10,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'TEACHER',
            teacherProfile: expect.objectContaining({
              onboardingCompletedAt: { not: null },
              subscriptions: { some: { status: 'PAST_DUE' } },
              OR: expect.arrayContaining([
                expect.objectContaining({
                  user: { email: { contains: 'alice', mode: 'insensitive' } },
                }),
              ]),
            }),
          }),
          skip: 0,
          take: 10,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.subscription).toEqual(
        expect.objectContaining({ id: 'sub1', status: 'PAST_DUE' }),
      );
      expect(result.items[0]!.profile?.onboardingCompletedAt).toEqual(
        new Date('2024-01-01'),
      );
      expect(result.total).toBe(1);
    });

    it('translates onboarding=pending to onboardingCompletedAt: null', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.listTeachers({ onboarding: 'pending' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            teacherProfile: expect.objectContaining({
              onboardingCompletedAt: null,
            }),
          }),
        }),
      );
    });
  });

  // ==================================================================
  // listPayments
  // ==================================================================

  describe('listPayments', () => {
    it('applies state/date filters and the invoice some-filter when invoiceStatus/kind are supplied', async () => {
      prisma.paymeTransaction.findMany.mockResolvedValue([
        {
          id: TX_ID,
          paymeId: 'pid',
          state: 'PAID',
          amountUzs: 100_000,
          createdAt: new Date('2024-06-15'),
          invoices: [
            {
              id: 'inv1',
              status: 'PAID',
              kind: 'STUDENT_COURSE',
              amountUzs: 100_000,
            },
          ],
        },
      ]);
      prisma.paymeTransaction.count.mockResolvedValue(1);

      const from = new Date('2024-06-01');
      const to = new Date('2024-06-30');
      const result = await service.listPayments({
        state: 'PAID',
        invoiceStatus: 'PAID',
        kind: 'STUDENT_COURSE',
        from,
        to,
        page: 2,
        pageSize: 5,
      });

      expect(prisma.paymeTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            state: 'PAID',
            createdAt: { gte: from, lte: to },
            invoices: {
              some: { status: 'PAID', kind: 'STUDENT_COURSE' },
            },
          },
          skip: 5,
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: { invoices: true },
        }),
      );
      expect(result.items[0]!.invoices).toHaveLength(1);
      expect(result.items[0]!.paymeTransaction.id).toBe(TX_ID);
    });

    it('omits the invoice some-filter when invoiceStatus/kind are not supplied', async () => {
      prisma.paymeTransaction.findMany.mockResolvedValue([]);
      prisma.paymeTransaction.count.mockResolvedValue(0);

      await service.listPayments({});

      const call = prisma.paymeTransaction.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('invoices');
    });
  });

  // ==================================================================
  // listFailedDeliveries
  // ==================================================================

  describe('listFailedDeliveries', () => {
    it('defaults to FAILED-only and applies channel + date filters', async () => {
      prisma.notificationDelivery.findMany.mockResolvedValue([]);
      prisma.notificationDelivery.count.mockResolvedValue(0);

      const from = new Date('2024-01-01');
      const to = new Date('2024-12-31');
      await service.listFailedDeliveries({
        channel: 'EMAIL',
        from,
        to,
      });

      expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'FAILED',
            channel: 'EMAIL',
            updatedAt: { gte: from, lte: to },
          },
        }),
      );
    });

    it('includes PENDING_RETRY when includePendingRetry=true', async () => {
      prisma.notificationDelivery.findMany.mockResolvedValue([]);
      prisma.notificationDelivery.count.mockResolvedValue(0);

      await service.listFailedDeliveries({ includePendingRetry: true });

      expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['FAILED', 'PENDING_RETRY'] } },
        }),
      );
    });
  });

  // ==================================================================
  // retryFailedDelivery
  // ==================================================================

  describe('retryFailedDelivery', () => {
    const buildDelivery = (overrides: Record<string, unknown> = {}) => ({
      id: DELIVERY_ID,
      channel: 'EMAIL',
      status: 'FAILED',
      attempt: 3,
      notification: {
        id: NOTIF_ID,
        userId: 'user-1',
        kind: 'PAYMENT_SUCCEEDED',
        title: 'Title',
        body: 'Body',
        data: { paymeId: 'pid' },
      },
      ...overrides,
    });

    it('re-enqueues to the EMAIL queue, resets the row to QUEUED, and writes a single audit row', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(buildDelivery());

      const result = await service.retryFailedDelivery(
        ADMIN_ID,
        DELIVERY_ID,
        { ip: '127.0.0.1' },
      );

      expect(prisma.notificationDelivery.update).toHaveBeenCalledWith({
        where: { id: DELIVERY_ID },
        data: { status: 'QUEUED', errorMsg: null },
      });
      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = emailQueue.add.mock.calls[0];
      expect(jobName).toBe('notification.email.retry');
      expect(payload).toEqual(
        expect.objectContaining({
          notificationId: NOTIF_ID,
          userId: 'user-1',
          channel: 'EMAIL',
        }),
      );
      expect(opts.jobId).toMatch(new RegExp(`^${NOTIF_ID}:EMAIL:retry:`));
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.NOTIFICATION_DELIVERY_RETRIED,
        `NotificationDelivery/${DELIVERY_ID}`,
        expect.objectContaining({
          deliveryId: DELIVERY_ID,
          notificationId: NOTIF_ID,
          channel: 'EMAIL',
          previousAttempt: 3,
        }),
        { ip: '127.0.0.1' },
      );
      expect(telegramQueue.add).not.toHaveBeenCalled();
      expect(pushQueue.add).not.toHaveBeenCalled();
      expect(result).toEqual({
        deliveryId: DELIVERY_ID,
        channel: 'EMAIL',
        status: 'QUEUED',
      });
    });

    it('routes TELEGRAM channels to the telegram queue', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(
        buildDelivery({ channel: 'TELEGRAM' }),
      );

      await service.retryFailedDelivery(ADMIN_ID, DELIVERY_ID);

      expect(telegramQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).not.toHaveBeenCalled();
    });

    it('refuses IN_APP deliveries with DELIVERY_NOT_RETRIABLE and writes no audit row', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(
        buildDelivery({ channel: 'IN_APP' }),
      );

      await expect(
        service.retryFailedDelivery(ADMIN_ID, DELIVERY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(emailQueue.add).not.toHaveBeenCalled();
      expect(prisma.notificationDelivery.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('returns 404 DELIVERY_NOT_FOUND when the delivery does not exist', async () => {
      prisma.notificationDelivery.findUnique.mockResolvedValue(null);

      await expect(
        service.retryFailedDelivery(ADMIN_ID, DELIVERY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // listPendingOutbox
  // ==================================================================

  describe('listPendingOutbox', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:10:00Z'));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('filters PENDING events older than `olderThanMinutes` (default 5)', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([]);
      prisma.outboxEvent.count.mockResolvedValue(0);

      await service.listPendingOutbox({});

      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PENDING',
            createdAt: { lte: new Date('2024-01-01T00:05:00Z') },
          },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('honors a custom olderThanMinutes and a topic filter', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([]);
      prisma.outboxEvent.count.mockResolvedValue(0);

      await service.listPendingOutbox({
        olderThanMinutes: 30,
        topic: 'payment.succeeded',
      });

      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PENDING',
            createdAt: { lte: new Date('2023-12-31T23:40:00Z') },
            topic: 'payment.succeeded',
          },
        }),
      );
    });
  });

  // ==================================================================
  // getSystemStats
  // ==================================================================

  describe('getSystemStats', () => {
    it('aggregates documented counts in parallel and returns them as a single payload', async () => {
      prisma.user.count
        .mockResolvedValueOnce(100) // total users
        .mockResolvedValueOnce(7); // active teachers
      prisma.invoice.count.mockResolvedValue(42);
      prisma.enrollmentRequest.count.mockResolvedValue(5);
      prisma.notificationDelivery.count.mockResolvedValue(3);
      prisma.outboxEvent.count.mockResolvedValue(2);

      const result = await service.getSystemStats();

      expect(result).toEqual({
        totalUsers: 100,
        activeTeachers: 7,
        paidInvoicesLast30Days: 42,
        pendingEnrollmentRequests: 5,
        failedDeliveriesLast24h: 3,
        pendingOutboxOlderThan5m: 2,
      });
      // totalUsers excludes DELETED rows; activeTeachers narrows on
      // role=TEACHER and status=ACTIVE.
      expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
        where: { status: { not: 'DELETED' } },
      });
      expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
        where: { role: 'TEACHER', status: 'ACTIVE' },
      });
      // paid invoices in the last 30 days
      const invoiceCall = prisma.invoice.count.mock.calls[0][0];
      expect(invoiceCall.where.status).toBe('PAID');
      expect(invoiceCall.where.paidAt.gte).toBeInstanceOf(Date);
      // pending enrollment requests
      expect(prisma.enrollmentRequest.count).toHaveBeenCalledWith({
        where: { status: 'PENDING_APPROVAL' },
      });
    });
  });

  // ==================================================================
  // listRecentAuditLogs
  // ==================================================================

  describe('listRecentAuditLogs', () => {
    it('clamps the limit between 1 and 200 and orders by createdAt desc', async () => {
      prisma.adminAuditLog.findMany.mockResolvedValue([]);

      await service.listRecentAuditLogs(0);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      await service.listRecentAuditLogs(500);
      expect(prisma.adminAuditLog.findMany).toHaveBeenLastCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });
  });
});
