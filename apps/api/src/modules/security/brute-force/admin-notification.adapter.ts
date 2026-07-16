import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import { AdminNotifier } from './brute-force.service';

/**
 * Concrete `AdminNotifier` adapter used by `BruteForceService` when
 * a `PERM_LOCKED` or `IP_BLOCKED` event fires. The brute-force service
 * holds a structural reference (`AdminNotifier` interface) so the
 * core security logic stays test-friendly; this adapter is the
 * production wiring that:
 *
 *   1. Looks up every active `ADMIN` user via Prisma.
 *   2. Inside a single transaction, appends one
 *      `security.admin_alert` outbox event so the existing
 *      notifications fan-out worker turns it into per-channel
 *      notifications.
 *
 * Idempotency:
 *   - The outbox `idempotencyKey` is stable per `(email, reason)`
 *     so re-firing the same admin alert (e.g. retried failure
 *     pipeline) lands on `ON CONFLICT DO NOTHING` and is skipped.
 *
 * Failures are caught and logged but never re-thrown — admin paging
 * MUST NOT break the user-facing login flow. The brute-force service
 * already wraps its own call in `try/catch` as a defence in depth.
 */
@Injectable()
export class AdminNotificationAdapter implements AdminNotifier {
  private readonly logger = new Logger(AdminNotificationAdapter.name);

  /** Outbox topic consumed by the notifications fan-out worker. */
  static readonly TOPIC = 'security.admin_alert';

  constructor(
    @Optional() private readonly prisma?: PrismaClient,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  async notifyAdmins(payload: {
    email: string;
    reason: string;
    emittedAt: Date;
  }): Promise<void> {
    if (!this.prisma || !this.outboxService) {
      this.logger.debug(
        'AdminNotificationAdapter: prisma/outbox not wired, skipping fan-out',
      );
      return;
    }

    let adminIds: string[] = [];
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      adminIds = admins.map((a) => a.id);
    } catch (err) {
      this.logger.warn(
        `notifyAdmins: failed to load admin recipients: ${(err as Error).message}`,
      );
      return;
    }

    if (adminIds.length === 0) {
      // Nothing to do — log so SREs can spot a misconfigured fleet
      // (no active admin users at all).
      this.logger.warn(
        'notifyAdmins: no active ADMIN users found — skipping fan-out',
      );
      return;
    }

    const idempotencyKey = `${AdminNotificationAdapter.TOPIC}:${payload.email}:${payload.emittedAt.toISOString()}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.outboxService!.create(tx, {
          topic: AdminNotificationAdapter.TOPIC,
          payload: {
            email: payload.email,
            reason: payload.reason,
            emittedAt: payload.emittedAt.toISOString(),
            adminIds,
          },
          idempotencyKey,
        });
      });
    } catch (err) {
      this.logger.warn(
        `notifyAdmins: outbox emit failed: ${(err as Error).message}`,
      );
    }
  }
}
