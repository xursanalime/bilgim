import {
  deriveChannelStates,
  setChannelEnabled,
  MANAGED_CHANNELS,
  LOCKED_CHANNELS,
} from './channel-preferences';
import {
  notificationsApi,
  NOTIFICATION_KINDS,
  type NotificationPreference,
} from './api/notifications';

describe('channel-preferences pure logic (Req 14.5)', () => {
  describe('deriveChannelStates', () => {
    it('returns one entry per managed channel in declared order', () => {
      const states = deriveChannelStates([]);
      expect(states.map((s) => s.channel)).toEqual([...MANAGED_CHANNELS]);
    });

    it('always reports IN_APP as enabled and locked', () => {
      const inApp = deriveChannelStates([]).find((s) => s.channel === 'IN_APP');
      expect(inApp).toMatchObject({ enabled: true, locked: true });
      expect(LOCKED_CHANNELS).toContain('IN_APP');
    });

    it('marks a channel enabled when any kind enables it', () => {
      const prefs: NotificationPreference[] = [
        { kind: 'HOMEWORK_ASSIGNED', channel: 'EMAIL', enabled: false },
        { kind: 'PAYMENT_SUCCEEDED', channel: 'EMAIL', enabled: true },
        { kind: 'LESSON_PUBLISHED', channel: 'TELEGRAM', enabled: false },
      ];
      const states = deriveChannelStates(prefs);
      expect(states.find((s) => s.channel === 'EMAIL')?.enabled).toBe(true);
      expect(states.find((s) => s.channel === 'TELEGRAM')?.enabled).toBe(false);
    });

    it('treats absent rows as disabled (non-IN_APP)', () => {
      const states = deriveChannelStates([]);
      expect(states.find((s) => s.channel === 'EMAIL')?.enabled).toBe(false);
      expect(states.find((s) => s.channel === 'TELEGRAM')?.enabled).toBe(false);
    });
  });

  describe('setChannelEnabled', () => {
    afterEach(() => jest.restoreAllMocks());

    it('rejects attempts to disable the locked IN_APP channel', async () => {
      const spy = jest.spyOn(notificationsApi, 'bulkUpdatePreferences');
      await expect(setChannelEnabled('IN_APP', false)).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it('writes the value across every notification kind for a channel', async () => {
      const spy = jest
        .spyOn(notificationsApi, 'bulkUpdatePreferences')
        .mockResolvedValue({ updated: NOTIFICATION_KINDS.length, preferences: [] });

      await setChannelEnabled('TELEGRAM', true);

      expect(spy).toHaveBeenCalledTimes(1);
      const rows = spy.mock.calls[0]![0] as NotificationPreference[];
      expect(rows).toHaveLength(NOTIFICATION_KINDS.length);
      expect(rows.every((r) => r.channel === 'TELEGRAM' && r.enabled)).toBe(true);
      expect(new Set(rows.map((r) => r.kind))).toEqual(
        new Set(NOTIFICATION_KINDS),
      );
    });
  });
});
