import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationKind,
  Prisma,
} from '@prisma/client';

import { MetricsService } from '../../infra/metrics/metrics.service';
import {
  CreateNotificationInput,
  NotificationRepository,
} from './repositories/notification.repository';
import {
  NotificationPreferenceRepository,
  NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
} from './repositories/notification-preference.repository';
import {
  PushDeviceRepository,
  RegisterDeviceInput,
} from './repositories/push-device.repository';

/**
 * NotificationsService — owns the Notification, NotificationDelivery and
 * NotificationPreference lifecycles (Req 16.1 – 16.6).
 *
 * Notification creation is **idempotent** — the underlying repository uses
 * `INSERT ... ON CONFLICT (idempotencyKey) DO NOTHING` (Req 16.4), so a
 * fan-out worker retry never duplicates the in-app row. The service is
 * intentionally thin: most invariants are encoded at the repository / DB
 * layer, and the controller is responsible for auth scoping.
 *
 * Per-channel preferences (Req 16.1, 16.3) are resolved with a default
 * "on" matrix in the repository — users do not need a backfilled
 * preference row to receive their first notification.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly preferenceRepository: NotificationPreferenceRepository,
    private readonly pushDeviceRepository: PushDeviceRepository,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Centralised counter increment for delivery dispatch
   * (Task 24.3, Req 26.2). Workers call this with their own
   * channel + status so dashboards can slice the
   * `notifications_dispatched_total` series by failure mode.
   */
  recordDispatch(
    kind: string,
    channel: NotificationChannel | string,
    status: string,
  ): void {
    this.metrics?.recordNotificationDispatched(kind, String(channel), status);
  }

  /**
   * Centralised terminal-failure recorder
   * (Task 24.3, Req 26.2). Per-channel workers call this from their
   * `onFailure` branch when `willRetry === false` — i.e. the final
   * retry has been exhausted or the failure is unrecoverable
   * (chat-id missing, user not found, provider 5xx). The `reason`
   * label is one of a small stable set the dashboard understands:
   * `upstream_5xx`, `chat_id_missing`, `user_not_found`,
   * `provider_unavailable`, `unknown`. Cardinality is bounded so the
   * counter does not explode.
   */
  recordFailure(
    kind: string,
    channel: NotificationChannel | string,
    reason: string,
  ): void {
    this.metrics?.recordNotificationFailed(kind, String(channel), reason);
  }

  // ------------------------------------------------------------------
  // Notification creation (Req 16.1, 16.4)
  // ------------------------------------------------------------------

  /**
   * Idempotently create a Notification.
   *
   * When the worker processes a fan-out event it calls this method with a
   * deterministic `idempotencyKey` (e.g. `lesson.published:{lessonId}:{studentId}`).
   * Subsequent calls with the same key short-circuit at the DB level.
   */
  async createNotification(
    input: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ notification: Notification; created: boolean }> {
    return this.notificationRepository.createIdempotent(input, tx);
  }

  // ------------------------------------------------------------------
  // User-facing reads (Req 16.1)
  // ------------------------------------------------------------------

  async listForUser(
    userId: string,
    opts: {
      cursor?: string | undefined;
      limit?: number | undefined;
      unreadOnly?: boolean | undefined;
    },
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const limit = opts.limit ?? 20;
    const cursorDate = opts.cursor ? new Date(opts.cursor) : undefined;
    const items = await this.notificationRepository.listForUser({
      userId,
      limit,
      ...(cursorDate ? { cursor: cursorDate } : {}),
      unreadOnly: opts.unreadOnly ?? false,
    });

    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last ? last.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationRepository.unreadCountForUser(userId);
  }

  // ------------------------------------------------------------------
  // Read-state mutations
  // ------------------------------------------------------------------

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    const updated = await this.notificationRepository.markRead(
      userId,
      notificationId,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: `Notification ${notificationId} not found`,
      });
    }
    return updated;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.notificationRepository.markAllRead(userId);
    return { updated };
  }

  // ------------------------------------------------------------------
  // Preferences (Req 16.1, 16.3)
  // ------------------------------------------------------------------

  /**
   * Materialise the full kind × channel preference matrix for a user.
   * Combinations not stored in the DB return their default value.
   */
  async getPreferences(userId: string): Promise<
    Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }>
  > {
    return this.preferenceRepository.listForUser(userId);
  }

  async updatePreference(
    userId: string,
    kind: NotificationKind,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<{
    kind: NotificationKind;
    channel: NotificationChannel;
    enabled: boolean;
  }> {
    const row = await this.preferenceRepository.upsert({
      userId,
      kind,
      channel,
      enabled,
    });
    this.logger.log(
      `Preference updated user=${userId} kind=${kind} channel=${channel} → ${row.enabled}`,
    );
    return { kind: row.kind, channel: row.channel, enabled: row.enabled };
  }

  /**
   * Bulk update — applies a list of `(kind, channel, enabled)` triples
   * in one transaction. Returns the post-update full matrix so the
   * client can refresh the settings page without a second `GET`.
   *
   * Empty `items` is a no-op that still returns the current matrix —
   * useful for clients that "submit" with no edits.
   */
  async updatePreferencesBulk(
    userId: string,
    items: Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }>,
  ): Promise<{
    updated: number;
    preferences: Array<{
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }>;
  }> {
    const written = await this.preferenceRepository.bulkUpsert(userId, items);
    if (written.length > 0) {
      this.logger.log(
        `Preferences bulk-updated user=${userId} count=${written.length}`,
      );
    }
    const preferences = await this.preferenceRepository.listForUser(userId);
    return { updated: written.length, preferences };
  }

  /**
   * Resolve the `(channel → enabled)` matrix for a given user/kind.
   * Used by the fan-out worker to decide which delivery jobs to enqueue.
   */
  async resolveChannelsForUser(
    userId: string,
    kind: NotificationKind,
  ): Promise<Record<NotificationChannel, boolean>> {
    return this.preferenceRepository.resolveChannelsForUser(userId, kind);
  }

  // ------------------------------------------------------------------
  // Push devices (Task 22.2, Req 16.1)
  // ------------------------------------------------------------------

  /**
   * Register an Expo push token for the calling user. Idempotent —
   * re-registering the same token bumps `lastSeenAt` and re-activates
   * a previously revoked row.
   */
  async registerPushDevice(input: RegisterDeviceInput) {
    const row = await this.pushDeviceRepository.register(input);
    this.logger.log(
      `Push device registered user=${input.userId} platform=${input.platform}`,
    );
    return {
      id: row.id,
      platform: row.platform,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }

  /** Forget a single push token (logout from a particular device). */
  async unregisterPushDevice(
    userId: string,
    token: string,
  ): Promise<{ deleted: boolean }> {
    return this.pushDeviceRepository.unregister(userId, token);
  }

  /** Hard-delete every push device row for a user. */
  async clearPushDevicesForUser(
    userId: string,
  ): Promise<{ deleted: number }> {
    return this.pushDeviceRepository.clearForUser(userId);
  }

  /** Active tokens for a user — used by the push delivery worker. */
  async listActivePushDevices(userId: string) {
    return this.pushDeviceRepository.listActiveForUser(userId);
  }
}

export { NOTIFICATION_KINDS, NOTIFICATION_CHANNELS };
