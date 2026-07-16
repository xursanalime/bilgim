import {
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  PrismaClient,
} from '@prisma/client';

import {
  NotificationPreferenceRepository,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
} from './notification-preference.repository';

const USER_ID = '00000000-0000-0000-0000-000000000010';

/**
 * Repository unit tests — Requirements 10.5, 10.7, 16.1, 16.3.
 *
 * The Prisma client is mocked so the suite is hermetic. We verify:
 *   - default-on matrix (IN_APP always on, EMAIL on for "important" kinds),
 *   - per-row override semantics (a stored row beats the default),
 *   - `listForUser` materialisation covers every (kind, channel) pair,
 *   - `resolveChannelsForUser` returns one entry per channel,
 *   - `upsert` writes through to Prisma with the correct unique key,
 *   - `bulkUpsert` runs every item inside `prisma.$transaction`.
 */
describe('NotificationPreferenceRepository', () => {
  let prisma: jest.Mocked<PrismaClient> & {
    notificationPreference: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repo: NotificationPreferenceRepository;

  beforeEach(() => {
    prisma = {
      notificationPreference: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;
    repo = new NotificationPreferenceRepository(prisma as unknown as PrismaClient);
  });

  // ------------------------------------------------------------------
  // defaultEnabled — Req 16.1, 16.2
  // ------------------------------------------------------------------

  describe('defaultEnabled', () => {
    it('IN_APP is default-on for every supported kind', () => {
      for (const kind of NOTIFICATION_KINDS) {
        expect(repo.defaultEnabled(kind, 'IN_APP')).toBe(true);
      }
    });

    it('EMAIL defaults on for payment, enrollment, schedule and trial kinds', () => {
      const emailOn: NotificationKind[] = [
        'PAYMENT_SUCCEEDED',
        'PAYMENT_FAILED',
        'ENROLLMENT_APPROVED',
        'ENROLLMENT_REJECTED',
        'SCHEDULE_CHANGED',
        'TRIAL_ENDING',
        'SUBSCRIPTION_PAST_DUE',
      ];
      for (const kind of emailOn) {
        expect(repo.defaultEnabled(kind, 'EMAIL')).toBe(true);
      }
    });

    it('EMAIL defaults off for non-critical kinds (lesson, homework, AI)', () => {
      const emailOff: NotificationKind[] = [
        'LESSON_PUBLISHED',
        'LIVE_STARTED',
        'LIVE_REMINDER',
        'HOMEWORK_ASSIGNED',
        'HOMEWORK_GRADED',
        'AI_REVIEW_READY',
      ];
      for (const kind of emailOff) {
        expect(repo.defaultEnabled(kind, 'EMAIL')).toBe(false);
      }
    });

    it('TELEGRAM and PUSH default off for every kind (opt-in)', () => {
      for (const kind of NOTIFICATION_KINDS) {
        expect(repo.defaultEnabled(kind, 'TELEGRAM')).toBe(false);
        expect(repo.defaultEnabled(kind, 'PUSH')).toBe(false);
      }
    });
  });

  // ------------------------------------------------------------------
  // isEnabledForUser — Req 16.3
  // ------------------------------------------------------------------

  describe('isEnabledForUser', () => {
    it('returns the stored row value when one exists', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        id: 'p-1',
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED' as NotificationKind,
        channel: 'EMAIL' as NotificationChannel,
        enabled: true,
      } as NotificationPreference);

      const result = await repo.isEnabledForUser(
        USER_ID,
        'LESSON_PUBLISHED',
        'EMAIL',
      );
      expect(result).toBe(true);
      expect(prisma.notificationPreference.findUnique).toHaveBeenCalledWith({
        where: {
          userId_kind_channel: {
            userId: USER_ID,
            kind: 'LESSON_PUBLISHED',
            channel: 'EMAIL',
          },
        },
      });
    });

    it('falls back to the default when no row exists', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      // PUSH default = false.
      expect(
        await repo.isEnabledForUser(USER_ID, 'LESSON_PUBLISHED', 'PUSH'),
      ).toBe(false);
    });

    it('IN_APP always returns true regardless of stored row (always-on)', async () => {
      // Even if some legacy row has enabled=false, the always-on rule wins.
      prisma.notificationPreference.findUnique.mockResolvedValue({
        id: 'p-stale',
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        channel: 'IN_APP',
        enabled: false,
      } as NotificationPreference);
      const result = await repo.isEnabledForUser(
        USER_ID,
        'LESSON_PUBLISHED',
        'IN_APP',
      );
      expect(result).toBe(true);
      // Short-circuit — no DB read needed.
      expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    });

    it('honours an explicit OFF row even when the default is ON', async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        id: 'p-1',
        userId: USER_ID,
        kind: 'PAYMENT_SUCCEEDED' as NotificationKind,
        channel: 'EMAIL' as NotificationChannel,
        enabled: false,
      } as NotificationPreference);

      const result = await repo.isEnabledForUser(
        USER_ID,
        'PAYMENT_SUCCEEDED',
        'EMAIL',
      );
      expect(result).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // resolveChannelsForUser — Req 10.5, 16.1
  // ------------------------------------------------------------------

  describe('resolveChannelsForUser', () => {
    it('returns one entry per channel (IN_APP, EMAIL, TELEGRAM, PUSH)', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      const result = await repo.resolveChannelsForUser(
        USER_ID,
        'LESSON_PUBLISHED',
      );
      expect(Object.keys(result).sort()).toEqual(
        [...NOTIFICATION_CHANNELS].sort(),
      );
    });

    it('uses defaults for channels with no stored row', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      const result = await repo.resolveChannelsForUser(
        USER_ID,
        'LESSON_PUBLISHED',
      );
      expect(result).toEqual({
        IN_APP: true,
        EMAIL: false,
        TELEGRAM: false,
        PUSH: false,
        SMS: false,
      });
    });

    it('overrides the default when a stored row disagrees (IN_APP stays true regardless)', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([
        {
          id: 'p-1',
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'IN_APP',
          enabled: false, // stale row — must be ignored, IN_APP is always-on
        },
        {
          id: 'p-2',
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'TELEGRAM',
          enabled: true, // user opted INTO Telegram (default off)
        },
      ] as NotificationPreference[]);

      const result = await repo.resolveChannelsForUser(
        USER_ID,
        'LESSON_PUBLISHED',
      );
      expect(result).toEqual({
        IN_APP: true, // always-on (Task 14.3)
        EMAIL: false,
        TELEGRAM: true,
        PUSH: false,
        SMS: false,
      });
    });

    it('queries Prisma scoped to (userId, kind)', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      await repo.resolveChannelsForUser(USER_ID, 'PAYMENT_SUCCEEDED');
      expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, kind: 'PAYMENT_SUCCEEDED' },
      });
    });
  });

  // ------------------------------------------------------------------
  // listForUser — Req 16.3 (settings page)
  // ------------------------------------------------------------------

  describe('listForUser', () => {
    it('materialises a row for every (kind, channel) pair', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      const result = await repo.listForUser(USER_ID);
      expect(result).toHaveLength(
        NOTIFICATION_KINDS.length * NOTIFICATION_CHANNELS.length,
      );
      // Quick spot-check the matrix is consistent with the defaults.
      const lesson = result.find(
        (r) => r.kind === 'LESSON_PUBLISHED' && r.channel === 'IN_APP',
      );
      expect(lesson?.enabled).toBe(true);
    });

    it('overrides defaults with stored rows (IN_APP stays true regardless)', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([
        {
          id: 'p-1',
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'IN_APP',
          enabled: false, // stale row — IN_APP is always-on, ignored
        },
        {
          id: 'p-2',
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'EMAIL',
          enabled: true,
        },
      ] as NotificationPreference[]);
      const result = await repo.listForUser(USER_ID);
      const lessonInApp = result.find(
        (r) => r.kind === 'LESSON_PUBLISHED' && r.channel === 'IN_APP',
      );
      expect(lessonInApp?.enabled).toBe(true);
      const lessonEmail = result.find(
        (r) => r.kind === 'LESSON_PUBLISHED' && r.channel === 'EMAIL',
      );
      expect(lessonEmail?.enabled).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // upsert / bulkUpsert — Req 16.3
  // ------------------------------------------------------------------

  describe('upsert', () => {
    it('upserts via the (userId, kind, channel) unique constraint', async () => {
      const row = {
        id: 'p-1',
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED' as NotificationKind,
        channel: 'EMAIL' as NotificationChannel,
        enabled: true,
      } as NotificationPreference;
      prisma.notificationPreference.upsert.mockResolvedValue(row);

      const result = await repo.upsert({
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: true,
      });

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_kind_channel: {
            userId: USER_ID,
            kind: 'LESSON_PUBLISHED',
            channel: 'EMAIL',
          },
        },
        create: {
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'EMAIL',
          enabled: true,
        },
        update: { enabled: true },
      });
      expect(result).toBe(row);
    });

    it('rejects disabling IN_APP (always-on per Task 14.3)', async () => {
      await expect(
        repo.upsert({
          userId: USER_ID,
          kind: 'LESSON_PUBLISHED',
          channel: 'IN_APP',
          enabled: false,
        }),
      ).rejects.toThrow(/IN_APP/);
      expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpsert', () => {
    it('returns an empty array when no items are provided (no DB call)', async () => {
      const result = await repo.bulkUpsert(USER_ID, []);
      expect(result).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('runs every upsert inside a single $transaction', async () => {
      const items = [
        {
          kind: 'LESSON_PUBLISHED' as NotificationKind,
          channel: 'EMAIL' as NotificationChannel,
          enabled: true,
        },
        {
          kind: 'PAYMENT_SUCCEEDED' as NotificationKind,
          channel: 'TELEGRAM' as NotificationChannel,
          enabled: true,
        },
      ];
      const upsertCall = jest.fn().mockReturnValue('upsert-promise');
      prisma.notificationPreference.upsert =
        upsertCall as unknown as typeof prisma.notificationPreference.upsert;
      prisma.$transaction.mockResolvedValue([
        { id: 'p-1' } as NotificationPreference,
        { id: 'p-2' } as NotificationPreference,
      ]);

      const result = await repo.bulkUpsert(USER_ID, items);

      expect(upsertCall).toHaveBeenCalledTimes(items.length);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0]?.[0] as unknown[];
      expect(transactionArg).toHaveLength(items.length);
      expect(result).toHaveLength(2);
    });

    it('rejects a batch containing IN_APP enabled=false', async () => {
      await expect(
        repo.bulkUpsert(USER_ID, [
          {
            kind: 'LESSON_PUBLISHED',
            channel: 'EMAIL',
            enabled: true,
          },
          {
            kind: 'LESSON_PUBLISHED',
            channel: 'IN_APP',
            enabled: false,
          },
        ]),
      ).rejects.toThrow(/IN_APP/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('silently drops IN_APP enabled=true entries (always-on no-op)', async () => {
      const items = [
        {
          kind: 'LESSON_PUBLISHED' as NotificationKind,
          channel: 'IN_APP' as NotificationChannel,
          enabled: true,
        },
        {
          kind: 'LESSON_PUBLISHED' as NotificationKind,
          channel: 'EMAIL' as NotificationChannel,
          enabled: true,
        },
      ];
      prisma.notificationPreference.upsert = jest
        .fn()
        .mockReturnValue('upsert-promise') as any;
      prisma.$transaction.mockResolvedValue([
        { id: 'p-email' } as NotificationPreference,
      ]);

      const result = await repo.bulkUpsert(USER_ID, items);

      // Only the EMAIL upsert is sent through; IN_APP true is dropped.
      const transactionArg = prisma.$transaction.mock.calls[0]?.[0] as unknown[];
      expect(transactionArg).toHaveLength(1);
      expect(result).toHaveLength(1);
    });
  });
});
