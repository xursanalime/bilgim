import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { HomeworkModule } from '../homework/homework.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminService } from './admin.service';

/**
 * AdminModule — Phase 9, Task 23.1.
 *
 * Surface area: `/admin/*` REST endpoints used by the admin moderation,
 * catalog and operations dashboards. Owns user moderation (suspend /
 * restore), Specialty CRUD, SpecialtyModule catalog management
 * (delegates the cap-enforced bulk upsert to `HomeworkService`), Plan
 * CRUD, the AdminAuditLog read surface, and the operations-only
 * surfaces added in Task 23.1: paginated teacher / payment lists,
 * failed `NotificationDelivery` triage with BullMQ re-enqueue, stuck
 * `OutboxEvent` visibility and the system-stats panel.
 *
 * Imports:
 *   - `HomeworkModule` to delegate the cap-enforced
 *     `bulkUpsertSpecialtyModules`. This keeps the cap logic in one
 *     place (`HomeworkService`) rather than duplicating it here.
 *   - `BullModule.registerQueue` for the EMAIL / TELEGRAM / PUSH /
 *     NOTIFICATION_FANOUT queues so the operations service can push
 *     a fresh delivery job onto the appropriate queue. The global
 *     `BullMqModule` already registers every queue at runtime; the
 *     re-registration here makes `@InjectQueue` resolve in unit tests
 *     that import AdminModule in isolation.
 *
 * Owns its own `PrismaClient` instance, matching the bounded-context
 * pattern used by every other module.
 */
@Module({
  imports: [
    ConfigModule,
    HomeworkModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.NOTIFICATION_FANOUT },
      { name: QUEUE_NAMES.EMAIL },
      { name: QUEUE_NAMES.TELEGRAM },
      { name: QUEUE_NAMES.PUSH },
    ),
  ],
  controllers: [AdminController, AdminOpsController],
  providers: [
    AdminService,
    AdminOpsService,
    AdminAuditService,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [AdminService, AdminOpsService, AdminAuditService],
})
export class AdminModule {}
