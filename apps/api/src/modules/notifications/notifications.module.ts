import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationPreferenceRepository } from './repositories/notification-preference.repository';
import { PushDeviceRepository } from './repositories/push-device.repository';
import { NotificationFanoutProcessor } from './workers/notification-fanout.processor';
import { EmailProcessor } from './workers/email.processor';
import { TelegramProcessor } from './workers/telegram.processor';
import { PushProcessor } from './workers/push.processor';

/**
 * NotificationsModule — Notification, NotificationDelivery and
 * NotificationPreference lifecycle owner (Req 16.1 – 16.6).
 *
 * Responsibilities:
 *   - REST API for in-app notifications and per-user preferences.
 *   - Multi-channel fan-out worker that consumes the NOTIFICATION_FANOUT
 *     queue, expands events to recipients and enqueues per-channel
 *     delivery jobs.
 *   - Per-channel delivery workers (EMAIL, TELEGRAM, PUSH).
 *
 * BullMQ access: queues are registered globally in `BullMqModule`, so the
 * `@InjectQueue(...)` and `@Processor(...)` decorators work without
 * importing anything here.
 *
 * Owns its own `PrismaClient` instance, matching the pattern used by the
 * Auth, Billing, Catalog and Enrollment modules.
 */
@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRepository,
    NotificationPreferenceRepository,
    PushDeviceRepository,
    NotificationFanoutProcessor,
    EmailProcessor,
    TelegramProcessor,
    PushProcessor,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [
    NotificationsService,
    NotificationRepository,
    NotificationPreferenceRepository,
    PushDeviceRepository,
  ],
})
export class NotificationsModule {}
