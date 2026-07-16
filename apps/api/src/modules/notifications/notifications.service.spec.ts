import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { PushDeviceRepository } from './repositories/push-device.repository';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const NOTIF_ID = '11111111-1111-1111-1111-111111111111';

/**
 * NotificationsService unit tests — Requirements 16.1, 16.2, 16.3, 16.4.
 *
 * Coverage:
 *   - createNotification idempotency (same key returns the existing row).
 *   - listForUser pagination (cursor returned only when page is full).
 *   - markRead / markAllRead / unreadCount.
 *   - updatePreference upsert + listing.
 */
describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepository: jest.Mocked<NotificationRepository>;
  let preferenceRepository: jest.Mocked<NotificationPreferenceRepository>;
  let pushDeviceRepository: jest.Mocked<PushDeviceRepository>;

  beforeEach(() => {
    notificationRepository = {
      createIdempotent: jest.fn(),
      listForUser: jest.fn(),
      unreadCountForUser: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      findByIdForUser: jest.fn(),
      upsertDelivery: jest.fn(),
      findDelivery: jest.fn(),
    } as any;

    preferenceRepository = {
      defaultEnabled: jest.fn(),
      isEnabledForUser: jest.fn(),
      resolveChannelsForUser: jest.fn(),
      listForUser: jest.fn(),
      upsert: jest.fn(),
      bulkUpsert: jest.fn(),
    } as any;

    pushDeviceRepository = {
      register: jest.fn(),
      revoke: jest.fn(),
      listActiveForUser: jest.fn(),
      unregister: jest.fn(),
      clearForUser: jest.fn(),
    } as any;

    service = new NotificationsService(
      notificationRepository,
      preferenceRepository,
      pushDeviceRepository,
    );
  });

  // ------------------------------------------------------------------
  // createNotification — idempotency (Req 16.4)
  // ------------------------------------------------------------------

  describe('createNotification', () => {
    it('returns created=true on first insert', async () => {
      const row = {
        id: NOTIF_ID,
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        title: 't',
        body: 'b',
        idempotencyKey: 'key:1',
        createdAt: new Date(),
        readAt: null,
        data: null,
      } as any;
      notificationRepository.createIdempotent.mockResolvedValue({
        notification: row,
        created: true,
      });

      const result = await service.createNotification({
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        title: 't',
        body: 'b',
        idempotencyKey: 'key:1',
      });

      expect(result.created).toBe(true);
      expect(result.notification.id).toBe(NOTIF_ID);
    });

    it('returns created=false on duplicate idempotencyKey (returns existing row)', async () => {
      const existing = {
        id: NOTIF_ID,
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        idempotencyKey: 'key:1',
      } as any;
      notificationRepository.createIdempotent.mockResolvedValue({
        notification: existing,
        created: false,
      });

      const result = await service.createNotification({
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        title: 't',
        body: 'b',
        idempotencyKey: 'key:1',
      });

      expect(result.created).toBe(false);
      expect(result.notification.id).toBe(NOTIF_ID);
    });
  });

  // ------------------------------------------------------------------
  // listForUser — cursor-based pagination
  // ------------------------------------------------------------------

  describe('listForUser', () => {
    it('returns nextCursor=null when fewer items than limit', async () => {
      notificationRepository.listForUser.mockResolvedValue([
        {
          id: 'n-1',
          userId: USER_ID,
          createdAt: new Date('2024-01-01T00:00:00Z'),
        } as any,
      ]);

      const result = await service.listForUser(USER_ID, { limit: 20 });
      expect(result.nextCursor).toBeNull();
      expect(result.items).toHaveLength(1);
    });

    it('returns nextCursor (last item createdAt) when page is full', async () => {
      const last = new Date('2024-01-15T00:00:00Z');
      notificationRepository.listForUser.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          id: `n-${i}`,
          userId: USER_ID,
          createdAt: i === 4 ? last : new Date('2024-01-20T00:00:00Z'),
        })) as any,
      );

      const result = await service.listForUser(USER_ID, { limit: 5 });
      expect(result.nextCursor).toBe(last.toISOString());
    });

    it('passes through the unreadOnly filter to the repository', async () => {
      notificationRepository.listForUser.mockResolvedValue([]);
      await service.listForUser(USER_ID, { limit: 10, unreadOnly: true });
      expect(notificationRepository.listForUser).toHaveBeenCalledWith({
        userId: USER_ID,
        limit: 10,
        cursor: undefined,
        unreadOnly: true,
      });
    });
  });

  // ------------------------------------------------------------------
  // markRead / markAllRead / unreadCount
  // ------------------------------------------------------------------

  describe('markRead', () => {
    it('returns the updated row', async () => {
      const updated = {
        id: NOTIF_ID,
        userId: USER_ID,
        readAt: new Date(),
      } as any;
      notificationRepository.markRead.mockResolvedValue(updated);

      const result = await service.markRead(USER_ID, NOTIF_ID);
      expect(result).toBe(updated);
    });

    it('throws 404 NOTIFICATION_NOT_FOUND when missing or not owned', async () => {
      notificationRepository.markRead.mockResolvedValue(null);
      await expect(service.markRead(USER_ID, NOTIF_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('markAllRead', () => {
    it('returns the count of rows updated', async () => {
      notificationRepository.markAllRead.mockResolvedValue(7);
      const result = await service.markAllRead(USER_ID);
      expect(result).toEqual({ updated: 7 });
    });
  });

  describe('unreadCount', () => {
    it('proxies to the repository', async () => {
      notificationRepository.unreadCountForUser.mockResolvedValue(3);
      const count = await service.unreadCount(USER_ID);
      expect(count).toBe(3);
      expect(notificationRepository.unreadCountForUser).toHaveBeenCalledWith(
        USER_ID,
      );
    });
  });

  // ------------------------------------------------------------------
  // Preferences (Req 16.1, 16.3)
  // ------------------------------------------------------------------

  describe('preferences', () => {
    it('getPreferences returns the materialised matrix from repository', async () => {
      const matrix = [
        { kind: 'LESSON_PUBLISHED', channel: 'IN_APP', enabled: true },
        { kind: 'LESSON_PUBLISHED', channel: 'EMAIL', enabled: false },
      ] as any;
      preferenceRepository.listForUser.mockResolvedValue(matrix);

      const result = await service.getPreferences(USER_ID);
      expect(result).toBe(matrix);
      expect(preferenceRepository.listForUser).toHaveBeenCalledWith(USER_ID);
    });

    it('updatePreference upserts and returns the new flag', async () => {
      preferenceRepository.upsert.mockResolvedValue({
        id: 'p-1',
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: false,
      } as any);

      const result = await service.updatePreference(
        USER_ID,
        'LESSON_PUBLISHED',
        'EMAIL',
        false,
      );

      expect(preferenceRepository.upsert).toHaveBeenCalledWith({
        userId: USER_ID,
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: false,
      });
      expect(result).toEqual({
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: false,
      });
    });

    it('resolveChannelsForUser delegates to the preference repository', async () => {
      const matrix = {
        IN_APP: true,
        EMAIL: true,
        TELEGRAM: false,
        PUSH: false,
      } as any;
      preferenceRepository.resolveChannelsForUser.mockResolvedValue(matrix);
      const result = await service.resolveChannelsForUser(
        USER_ID,
        'LESSON_PUBLISHED',
      );
      expect(result).toBe(matrix);
    });

    it('updatePreferencesBulk calls bulkUpsert and returns the refreshed matrix', async () => {
      const items = [
        {
          kind: 'LESSON_PUBLISHED' as const,
          channel: 'EMAIL' as const,
          enabled: false,
        },
        {
          kind: 'PAYMENT_SUCCEEDED' as const,
          channel: 'TELEGRAM' as const,
          enabled: true,
        },
      ];
      preferenceRepository.bulkUpsert.mockResolvedValue([
        { id: 'p-1' } as any,
        { id: 'p-2' } as any,
      ]);
      const refreshed = [
        { kind: 'LESSON_PUBLISHED', channel: 'EMAIL', enabled: false },
        { kind: 'PAYMENT_SUCCEEDED', channel: 'TELEGRAM', enabled: true },
      ] as any;
      preferenceRepository.listForUser.mockResolvedValue(refreshed);

      const result = await service.updatePreferencesBulk(USER_ID, items);

      expect(preferenceRepository.bulkUpsert).toHaveBeenCalledWith(
        USER_ID,
        items,
      );
      expect(preferenceRepository.listForUser).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ updated: 2, preferences: refreshed });
    });

    it('updatePreferencesBulk handles an empty list as a no-op refresh', async () => {
      preferenceRepository.bulkUpsert.mockResolvedValue([]);
      preferenceRepository.listForUser.mockResolvedValue([
        { kind: 'LESSON_PUBLISHED', channel: 'IN_APP', enabled: true } as any,
      ]);

      const result = await service.updatePreferencesBulk(USER_ID, []);
      expect(result.updated).toBe(0);
      expect(result.preferences).toHaveLength(1);
    });
  });
});
