import { Job } from 'bullmq';

import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { PushDeviceRepository } from '../repositories/push-device.repository';
import { PushJob, PushProcessor } from './push.processor';

const NOTIF_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const baseJob = (overrides: Partial<PushJob> = {}): PushJob => ({
  notificationId: NOTIF_ID,
  userId: USER_ID,
  kind: 'LESSON_PUBLISHED',
  channel: 'PUSH',
  title: 'Yangi dars',
  body: 'Yangi dars chiqdi',
  data: { lessonId: 'lesson-1' },
  ...overrides,
});

const buildJob = (data: PushJob, attemptsMade = 0): Job<PushJob> =>
  ({
    id: 'job-1',
    data,
    attemptsMade,
  }) as unknown as Job<PushJob>;

/**
 * PushProcessor unit tests (Task 22.2, Req 16.1, 16.5, 16.6).
 *
 * The Expo Push Service is stubbed via a mocked `fetch`. We verify:
 *   - "no devices" path → SKIPPED delivery, success return.
 *   - happy path → SENT delivery with providerRef = first ticket id.
 *   - DeviceNotRegistered → token revoked, SENT only when at least one
 *     ticket succeeded.
 *   - HTTP 5xx → FAILED delivery + thrown error so BullMQ retries.
 */
describe('PushProcessor', () => {
  let processor: PushProcessor;
  let notificationRepository: jest.Mocked<NotificationRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let pushDeviceRepository: jest.Mocked<PushDeviceRepository>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    notificationRepository = {
      upsertDelivery: jest.fn(),
    } as any;
    notificationsService = {
      recordDispatch: jest.fn(),
      recordFailure: jest.fn(),
    } as any;
    pushDeviceRepository = {
      listActiveForUser: jest.fn(),
      revoke: jest.fn(),
    } as any;
    processor = new PushProcessor(
      notificationRepository,
      notificationsService,
      pushDeviceRepository,
    );

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ------------------------------------------------------------------

  it('records SKIPPED when the user has no active push devices', async () => {
    pushDeviceRepository.listActiveForUser.mockResolvedValue([]);

    const result = await processor.process(buildJob(baseJob()));

    expect(result).toEqual({ skipped: true });
    expect(pushDeviceRepository.listActiveForUser).toHaveBeenCalledWith(
      USER_ID,
    );
    expect(notificationRepository.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: NOTIF_ID,
        channel: 'PUSH',
        status: 'SKIPPED',
      }),
    );
    expect(notificationsService.recordDispatch).toHaveBeenCalledWith(
      'LESSON_PUBLISHED',
      'PUSH',
      'SKIPPED',
    );
  });

  it('records SENT and persists the first ticket id as providerRef', async () => {
    pushDeviceRepository.listActiveForUser.mockResolvedValue([
      { token: 'ExpoPushToken[a]', platform: 'ios' } as any,
      { token: 'ExpoPushToken[b]', platform: 'android' } as any,
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: 'ok', id: 'rcpt-a' },
          { status: 'ok', id: 'rcpt-b' },
        ],
      }),
    }) as any;

    const result = (await processor.process(buildJob(baseJob()))) as {
      sent: number;
      failed: number;
      ticketId: string;
    };

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.ticketId).toBe('rcpt-a');
    expect(notificationRepository.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SENT',
        providerRef: 'rcpt-a',
      }),
    );
    expect(notificationsService.recordDispatch).toHaveBeenCalledWith(
      'LESSON_PUBLISHED',
      'PUSH',
      'SENT',
    );
  });

  it('revokes a token returning DeviceNotRegistered while still recording SENT for the ok one', async () => {
    pushDeviceRepository.listActiveForUser.mockResolvedValue([
      { token: 'ExpoPushToken[ok]', platform: 'ios' } as any,
      { token: 'ExpoPushToken[dead]', platform: 'android' } as any,
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: 'ok', id: 'rcpt-ok' },
          {
            status: 'error',
            message: 'Device not registered',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      }),
    }) as any;

    const result = (await processor.process(buildJob(baseJob()))) as {
      sent: number;
      failed: number;
    };

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(pushDeviceRepository.revoke).toHaveBeenCalledWith(
      'ExpoPushToken[dead]',
    );
    expect(notificationRepository.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SENT' }),
    );
  });

  it('records FAILED and throws when the Expo API returns 500', async () => {
    pushDeviceRepository.listActiveForUser.mockResolvedValue([
      { token: 'ExpoPushToken[a]', platform: 'ios' } as any,
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as any;

    await expect(processor.process(buildJob(baseJob()))).rejects.toThrow();
    expect(notificationRepository.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
      }),
    );
    expect(notificationsService.recordDispatch).toHaveBeenCalledWith(
      'LESSON_PUBLISHED',
      'PUSH',
      'FAILED',
    );
  });

  it('records FAILED + provider_unavailable when every ticket errors', async () => {
    pushDeviceRepository.listActiveForUser.mockResolvedValue([
      { token: 'ExpoPushToken[a]', platform: 'ios' } as any,
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'error', message: 'Provider down' }],
      }),
    }) as any;

    const result = (await processor.process(buildJob(baseJob()))) as {
      sent: number;
      failed: number;
    };

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(notificationRepository.upsertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(notificationsService.recordFailure).toHaveBeenCalledWith(
      'LESSON_PUBLISHED',
      'PUSH',
      'provider_unavailable',
    );
  });
});
