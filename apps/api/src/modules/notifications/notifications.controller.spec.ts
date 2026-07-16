import { BadRequestException } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtPayload } from '../auth/tokens.service';
import {
  BulkUpdatePreferencesSchema,
  UpdatePreferenceSchema,
} from './dto';

const STUDENT: JwtPayload = {
  sub: '00000000-0000-0000-0000-000000000001',
  role: 'STUDENT',
} as JwtPayload;

/**
 * NotificationsController unit tests — Task 14.3 / Requirements 16.1, 16.3.
 *
 * Coverage:
 *   - GET  /notifications/preferences proxies the service.
 *   - PATCH /notifications/preferences accepts a valid Zod body, rejects
 *     a batch that tries to disable IN_APP, and returns the refreshed
 *     matrix from the service.
 *   - PUT  /notifications/preferences/:kind/:channel rejects unknown
 *     kinds/channels with 400, rejects IN_APP=false with 400
 *     (PREFERENCE_IN_APP_LOCKED) and short-circuits IN_APP=true as a
 *     no-op without hitting the service.
 *   - The Zod schema for bulk updates rejects IN_APP=false at the
 *     validation layer (defense in depth).
 */
describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<NotificationsService>;

  beforeEach(() => {
    service = {
      listForUser: jest.fn(),
      unreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      getPreferences: jest.fn(),
      updatePreference: jest.fn(),
      updatePreferencesBulk: jest.fn(),
      resolveChannelsForUser: jest.fn(),
      createNotification: jest.fn(),
    } as any;

    controller = new NotificationsController(service);
  });

  // ------------------------------------------------------------------
  // GET /notifications/preferences
  // ------------------------------------------------------------------

  describe('getPreferences', () => {
    it('returns the full matrix from the service for the calling user', async () => {
      const matrix = [
        { kind: 'LESSON_PUBLISHED', channel: 'IN_APP', enabled: true },
        { kind: 'LESSON_PUBLISHED', channel: 'EMAIL', enabled: false },
      ] as any;
      service.getPreferences.mockResolvedValue(matrix);

      const result = await controller.getPreferences(STUDENT);
      expect(result).toBe(matrix);
      expect(service.getPreferences).toHaveBeenCalledWith(STUDENT.sub);
    });
  });

  // ------------------------------------------------------------------
  // PATCH /notifications/preferences
  // ------------------------------------------------------------------

  describe('bulkUpdatePreferences', () => {
    it('passes the validated array to the service and returns the refreshed matrix', async () => {
      const dto = {
        preferences: [
          {
            kind: 'LESSON_PUBLISHED' as const,
            channel: 'EMAIL' as const,
            enabled: true,
          },
          {
            kind: 'PAYMENT_SUCCEEDED' as const,
            channel: 'TELEGRAM' as const,
            enabled: true,
          },
        ],
      };
      const refreshed = {
        updated: 2,
        preferences: [
          {
            kind: 'LESSON_PUBLISHED',
            channel: 'EMAIL',
            enabled: true,
          },
        ],
      } as any;
      service.updatePreferencesBulk.mockResolvedValue(refreshed);

      const result = await controller.bulkUpdatePreferences(STUDENT, dto);
      expect(result).toBe(refreshed);
      expect(service.updatePreferencesBulk).toHaveBeenCalledWith(
        STUDENT.sub,
        dto.preferences,
      );
    });

    it('Zod schema rejects a batch entry with channel=IN_APP and enabled=false', () => {
      const result = BulkUpdatePreferencesSchema.safeParse({
        preferences: [
          {
            kind: 'LESSON_PUBLISHED',
            channel: 'IN_APP',
            enabled: false,
          },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/IN_APP/);
      }
    });

    it('Zod schema accepts an empty array (no-op submission)', () => {
      const result = BulkUpdatePreferencesSchema.safeParse({
        preferences: [],
      });
      expect(result.success).toBe(true);
    });

    it('Zod schema rejects unknown kinds', () => {
      const result = BulkUpdatePreferencesSchema.safeParse({
        preferences: [
          {
            kind: 'NOT_A_KIND',
            channel: 'EMAIL',
            enabled: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('Zod schema caps the array at 64 entries', () => {
      const result = BulkUpdatePreferencesSchema.safeParse({
        preferences: Array.from({ length: 65 }, () => ({
          kind: 'LESSON_PUBLISHED',
          channel: 'EMAIL',
          enabled: true,
        })),
      });
      expect(result.success).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // PUT /notifications/preferences/:kind/:channel
  // ------------------------------------------------------------------

  describe('updatePreference', () => {
    it('happy path — calls the service with the parsed kind/channel', async () => {
      service.updatePreference.mockResolvedValue({
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: true,
      } as any);

      const result = await controller.updatePreference(
        STUDENT,
        'LESSON_PUBLISHED',
        'EMAIL',
        { enabled: true },
      );

      expect(service.updatePreference).toHaveBeenCalledWith(
        STUDENT.sub,
        'LESSON_PUBLISHED',
        'EMAIL',
        true,
      );
      expect(result).toEqual({
        kind: 'LESSON_PUBLISHED',
        channel: 'EMAIL',
        enabled: true,
      });
    });

    it('returns 400 PREFERENCE_INVALID for an unknown kind', async () => {
      await expect(
        controller.updatePreference(STUDENT, 'NOT_A_KIND', 'EMAIL', {
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 400 PREFERENCE_INVALID for an unknown channel', async () => {
      await expect(
        controller.updatePreference(STUDENT, 'LESSON_PUBLISHED', 'SMS', {
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 400 PREFERENCE_IN_APP_LOCKED when disabling IN_APP', async () => {
      await expect(
        controller.updatePreference(STUDENT, 'LESSON_PUBLISHED', 'IN_APP', {
          enabled: false,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PREFERENCE_IN_APP_LOCKED' },
      });
      expect(service.updatePreference).not.toHaveBeenCalled();
    });

    it('IN_APP enabled=true is a no-op that does not hit the service', async () => {
      const result = await controller.updatePreference(
        STUDENT,
        'LESSON_PUBLISHED',
        'IN_APP',
        { enabled: true },
      );
      expect(result).toEqual({
        kind: 'LESSON_PUBLISHED',
        channel: 'IN_APP',
        enabled: true,
      });
      expect(service.updatePreference).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Misc — single-update Zod schema sanity
  // ------------------------------------------------------------------

  describe('UpdatePreferenceSchema', () => {
    it('requires the boolean `enabled` field', () => {
      expect(UpdatePreferenceSchema.safeParse({}).success).toBe(false);
      expect(UpdatePreferenceSchema.safeParse({ enabled: true }).success).toBe(
        true,
      );
      expect(UpdatePreferenceSchema.safeParse({ enabled: 'yes' }).success).toBe(
        false,
      );
    });
  });

  // ------------------------------------------------------------------
  // POST /notifications/devices
  // ------------------------------------------------------------------

  describe('registerDevice', () => {
    beforeEach(() => {
      service.registerPushDevice = jest.fn();
      service.unregisterPushDevice = jest.fn();
    });

    it('proxies the call to NotificationsService.registerPushDevice', async () => {
      const stamp = new Date('2026-01-15T12:00:00.000Z');
      (service.registerPushDevice as jest.Mock).mockResolvedValue({
        id: 'device-1',
        platform: 'ios',
        lastSeenAt: stamp.toISOString(),
      });

      const result = await controller.registerDevice(STUDENT, {
        token: 'ExpoPushToken[abc]',
        platform: 'ios',
        deviceInfo: { modelName: 'iPhone 15' },
      });

      expect(service.registerPushDevice).toHaveBeenCalledWith({
        userId: STUDENT.sub,
        token: 'ExpoPushToken[abc]',
        platform: 'ios',
        deviceInfo: { modelName: 'iPhone 15' },
      });
      expect(result.platform).toBe('ios');
    });

    it('passes deviceInfo=null through when the mobile client omits it', async () => {
      (service.registerPushDevice as jest.Mock).mockResolvedValue({});
      await controller.registerDevice(STUDENT, {
        token: 'ExpoPushToken[xyz]',
        platform: 'android',
      } as any);
      expect((service.registerPushDevice as jest.Mock).mock.calls[0][0])
        .toEqual({
          userId: STUDENT.sub,
          token: 'ExpoPushToken[xyz]',
          platform: 'android',
          deviceInfo: null,
        });
    });
  });

  describe('unregisterDevice', () => {
    beforeEach(() => {
      service.unregisterPushDevice = jest.fn();
    });

    it('proxies to the service when token is provided', async () => {
      (service.unregisterPushDevice as jest.Mock).mockResolvedValue({
        deleted: true,
      });

      const result = await controller.unregisterDevice(STUDENT, 'token-1');
      expect(service.unregisterPushDevice).toHaveBeenCalledWith(
        STUDENT.sub,
        'token-1',
      );
      expect(result).toEqual({ deleted: true });
    });

    it('returns 400 PUSH_DEVICE_TOKEN_REQUIRED when token is empty', async () => {
      await expect(
        controller.unregisterDevice(STUDENT, ''),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.unregisterPushDevice).not.toHaveBeenCalled();
    });
  });
});
