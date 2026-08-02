import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';

/** How long before `scheduledAt` students should be reminded — mirrors `EARLY_JOIN_MS` in `live.service.ts` (the waiting-room window opens at the same instant the reminder fires). */
const REMINDER_LEAD_MS = 15 * 60 * 1000;

/**
 * LiveCron — fires a `live.reminder` outbox event ~15 minutes before a
 * scheduled LIVE lesson starts, so `NotificationFanoutProcessor` can alert
 * every APPROVED student in the lesson's group (Task: "dars boshlanishidan
 * 15 daqiqa avval studentlarga habar berilishi kerak").
 *
 * Runs every minute and scans a 1-minute lookahead window centered on
 * `now + REMINDER_LEAD_MS`, so each lesson is caught by exactly one tick
 * under normal operation. The outbox's `idempotencyKey` — which embeds the
 * lesson's current `scheduledAt` — is the real safety net: a slow/missed
 * tick that re-scans an already-notified lesson produces zero duplicate
 * notifications, while a *rescheduled* lesson (new `scheduledAt`) correctly
 * gets a fresh reminder.
 */
@Injectable()
export class LiveCron {
  private readonly logger = new Logger(LiveCron.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly outboxService: OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'live.send-reminders' })
  async sendUpcomingReminders(): Promise<void> {
    try {
      const now = Date.now();
      const windowStart = new Date(now + REMINDER_LEAD_MS);
      const windowEnd = new Date(now + REMINDER_LEAD_MS + 60_000);

      const lessons = await this.prisma.lesson.findMany({
        where: {
          type: 'LIVE',
          status: 'READY',
          scheduledAt: { gte: windowStart, lt: windowEnd },
        },
        select: { id: true, title: true, groupId: true, scheduledAt: true },
      });

      if (lessons.length === 0) return;

      this.logger.log(
        `sendUpcomingReminders: ${lessons.length} lesson(s) entering the 15-minute reminder window`,
      );

      for (const lesson of lessons) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await this.outboxService.create(tx, {
              topic: 'live.reminder',
              payload: {
                lessonId: lesson.id,
                groupId: lesson.groupId,
                title: lesson.title,
                scheduledAt: lesson.scheduledAt?.toISOString() ?? null,
              },
              idempotencyKey: `live.reminder:${lesson.id}:${lesson.scheduledAt?.toISOString() ?? 'unscheduled'}`,
            });
          });
        } catch (error) {
          // Don't abort the batch — one lesson's failure shouldn't block reminders for the rest.
          this.logger.error(
            `sendUpcomingReminders: failed for lesson ${lesson.id}: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `sendUpcomingReminders: batch error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
