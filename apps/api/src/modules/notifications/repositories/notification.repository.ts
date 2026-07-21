import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationDelivery,
  NotificationKind,
  NotificationChannel,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  idempotencyKey: string;
}

export interface ListNotificationsInput {
  userId: string;
  limit: number;
  cursor?: Date;
  unreadOnly: boolean;
}

/**
 * NotificationRepository — Prisma access for the `Notification` and
 * `NotificationDelivery` tables (Req 16.4, 16.6).
 *
 * The `create` method uses raw SQL `ON CONFLICT (idempotencyKey) DO NOTHING`
 * so that a re-played fan-out (worker retry, webhook re-delivery, …) cannot
 * create a second `Notification` row for the same business event. When the
 * insert is skipped we re-read the existing row so the caller always gets a
 * usable Notification handle.
 */
@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotently create a Notification.
   *
   * Returns `{ notification, created }` where `created=true` iff this call
   * was the one that inserted the row. On `created=false` we return the
   * pre-existing row matched by `idempotencyKey`.
   */
  async createIdempotent(
    input: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ notification: Notification; created: boolean }> {
    const client = tx ?? this.prisma;
    const id = randomUUID();
    const dataJson = input.data === undefined ? null : input.data;

    const inserted = await client.$executeRaw`
      INSERT INTO "Notification" (
        id, "userId", kind, title, body, data, "idempotencyKey", "createdAt"
      )
      VALUES (
        ${id}::uuid,
        ${input.userId}::uuid,
        ${input.kind}::"NotificationKind",
        ${input.title},
        ${input.body},
        ${dataJson === null ? null : JSON.stringify(dataJson)}::jsonb,
        ${input.idempotencyKey},
        NOW()
      )
      ON CONFLICT ("idempotencyKey") DO NOTHING
    `;

    if (inserted === 0) {
      // Already existed — fetch the current row.
      const existing = await client.notification.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (!existing) {
        // Should be unreachable: the unique constraint guarantees a row.
        throw new Error(
          `Notification idempotencyKey="${input.idempotencyKey}" reported conflict but row not found`,
        );
      }
      this.logger.debug(
        `Notification idempotencyKey="${input.idempotencyKey}" already exists, returning existing row`,
      );
      return { notification: existing, created: false };
    }

    const created = await client.notification.findUnique({ where: { id } });
    if (!created) {
      throw new Error(`Notification ${id} not found after insert`);
    }
    return { notification: created, created: true };
  }

  async listForUser(
    input: ListNotificationsInput,
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        userId: input.userId,
        ...(input.unreadOnly ? { readAt: null } : {}),
        ...(input.cursor ? { createdAt: { lt: input.cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
  }

  async unreadCountForUser(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Mark a single notification as read. Scoped by `userId` so a caller
   * cannot mark someone else's notifications.
   * Returns the updated row, or `null` if not found / not owned.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<Notification | null> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      // Either the row does not exist, belongs to someone else, or was
      // already read. We don't differentiate here — the service will
      // return the current state if the row exists.
      return this.prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });
    }
    return this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async findByIdForUser(
    userId: string,
    notificationId: string,
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
  }

  // ------------------------------------------------------------------
  // NotificationDelivery (Req 16.5, 16.6)
  // ------------------------------------------------------------------

  /**
   * Create or update a `NotificationDelivery` row for `(notificationId,
   * channel)`. Useful when a worker wants to record a queued / sent /
   * failed attempt for the user-facing channel.
   *
   * The `@@unique([notificationId, channel])` constraint guarantees a
   * single row per channel per notification.
   */
  async upsertDelivery(input: {
    notificationId: string;
    channel: NotificationChannel;
    status: string;
    attempt?: number;
    providerRef?: string | null;
    errorMsg?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<NotificationDelivery> {
    const client = input.tx ?? this.prisma;
    return client.notificationDelivery.upsert({
      where: {
        notificationId_channel: {
          notificationId: input.notificationId,
          channel: input.channel,
        },
      },
      create: {
        notificationId: input.notificationId,
        channel: input.channel,
        status: input.status,
        attempt: input.attempt ?? 0,
        providerRef: input.providerRef ?? null,
        errorMsg: input.errorMsg ?? null,
      },
      update: {
        status: input.status,
        ...(input.attempt !== undefined && { attempt: input.attempt }),
        ...(input.providerRef !== undefined && {
          providerRef: input.providerRef,
        }),
        ...(input.errorMsg !== undefined && { errorMsg: input.errorMsg }),
      },
    });
  }

  async findDelivery(
    notificationId: string,
    channel: NotificationChannel,
  ): Promise<NotificationDelivery | null> {
    return this.prisma.notificationDelivery.findUnique({
      where: { notificationId_channel: { notificationId, channel } },
    });
  }
}
