import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { NotificationsService } from '../notifications.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { PushDeviceRepository } from '../repositories/push-device.repository';

export interface PushJob {
  notificationId: string;
  userId: string;
  kind: string;
  channel: 'PUSH';
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

/** Minimal subset of the Expo Push Service response we care about. */
interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoBatchResponse {
  data?: ExpoTicket[];
  errors?: Array<{ code?: string; message: string }>;
}

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/**
 * Hard cap from the Expo Push docs — a single request must contain at
 * most 100 messages. Our fan-out worker only enqueues one PushJob per
 * recipient and a user typically has at most a handful of devices, so
 * we very rarely hit this. Belt-and-braces.
 */
const EXPO_BATCH_LIMIT = 100;

/**
 * PushProcessor — delivers a Notification to all of a user's
 * registered Expo push tokens (Task 22.2, Req 16.1, 16.5, 16.6).
 *
 * Flow:
 *   1. Look up the recipient's active `PushDevice` rows. If there are
 *      no tokens the delivery is recorded as `SKIPPED` and the job
 *      succeeds (no retries).
 *   2. Build the Expo Push API payload (title, body, `data` for
 *      deep-linking) and POST it to `https://exp.host/--/api/v2/push/send`.
 *   3. Walk the per-token tickets returned by Expo. Tokens with
 *      `DeviceNotRegistered` are revoked locally so the next
 *      fan-out skips them.
 *   4. Persist `SENT` (any ticket succeeded), `FAILED` (every ticket
 *      errored), or `SKIPPED` (no tokens) into `NotificationDelivery`
 *      with the first ticket id as `providerRef`.
 *
 * We hand-roll the HTTP call (rather than depending on
 * `expo-server-sdk`) so the API package keeps a small dependency
 * footprint. The Expo Push API is a stable, documented JSON endpoint.
 *
 * Mobile counterpart: see `apps/mobile/lib/notifications/*` (Task 22.2)
 * which obtains the token via `Notifications.getExpoPushTokenAsync()`
 * and registers it through `POST /notifications/devices`.
 */
@Processor(QUEUE_NAMES.PUSH)
export class PushProcessor extends WorkerHost {
  private readonly logger = new Logger(PushProcessor.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationsService: NotificationsService,
    private readonly pushDeviceRepository: PushDeviceRepository,
  ) {
    super();
  }

  async process(
    job: Job<PushJob>,
  ): Promise<
    | { skipped: true }
    | { sent: number; failed: number; ticketId?: string | undefined }
  > {
    const data = job.data;
    const devices = await this.pushDeviceRepository.listActiveForUser(
      data.userId,
    );

    if (devices.length === 0) {
      this.logger.debug(
        `No active push devices for user=${data.userId} notification=${data.notificationId} — recording SKIPPED`,
      );
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'PUSH',
        status: 'SKIPPED',
        attempt: job.attemptsMade + 1,
        errorMsg: 'No active push devices registered for user',
      });
      this.notificationsService.recordDispatch?.(data.kind, 'PUSH', 'SKIPPED');
      return { skipped: true };
    }

    // Build the Expo payload — one message per device. The mobile
    // notification handler routes on `data.kind` and the IDs in
    // `data.data` (see `apps/mobile/lib/notifications/handler.ts`).
    const messages = devices.slice(0, EXPO_BATCH_LIMIT).map((d) => ({
      to: d.token,
      title: data.title,
      body: data.body,
      sound: 'default' as const,
      data: {
        kind: data.kind,
        notificationId: data.notificationId,
        ...(data.data ?? {}),
      },
    }));

    let response: ExpoBatchResponse;
    try {
      const httpResp = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      if (!httpResp.ok) {
        throw new Error(
          `Expo push API returned HTTP ${httpResp.status}`,
        );
      }
      response = (await httpResp.json()) as ExpoBatchResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `Expo push call failed user=${data.userId}: ${message}`,
      );
      await this.notificationRepository.upsertDelivery({
        notificationId: data.notificationId,
        channel: 'PUSH',
        status: 'FAILED',
        attempt: job.attemptsMade + 1,
        errorMsg: `Expo push call failed: ${message}`,
      });
      this.notificationsService.recordDispatch?.(data.kind, 'PUSH', 'FAILED');
      throw err; // BullMQ retries with backoff (Req 16.5).
    }

    const tickets = response.data ?? [];
    let sent = 0;
    let failed = 0;
    let firstTicketId: string | undefined;

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      const device = devices[i];
      if (!ticket || !device) continue;
      if (ticket.status === 'ok') {
        sent += 1;
        if (!firstTicketId && ticket.id) firstTicketId = ticket.id;
      } else {
        failed += 1;
        // DeviceNotRegistered means Expo has invalidated the token
        // (uninstall, system reset, …). Revoke locally so we don't
        // keep paying for dead tokens.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await this.pushDeviceRepository.revoke(device.token);
        }
      }
    }

    const status = sent > 0 ? 'SENT' : 'FAILED';
    await this.notificationRepository.upsertDelivery({
      notificationId: data.notificationId,
      channel: 'PUSH',
      status,
      attempt: job.attemptsMade + 1,
      providerRef: firstTicketId ?? null,
      errorMsg:
        sent === 0
          ? `All ${failed} push tickets errored (see expo response)`
          : null,
    });
    this.notificationsService.recordDispatch?.(data.kind, 'PUSH', status);

    if (sent === 0) {
      this.notificationsService.recordFailure?.(
        data.kind,
        'PUSH',
        'provider_unavailable',
      );
    }

    return { sent, failed, ...(firstTicketId ? { ticketId: firstTicketId } : {}) };
  }
}
