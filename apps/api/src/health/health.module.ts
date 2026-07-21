import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';

import { QUEUE_NAMES } from '../infra/bullmq/queue.constants';
import { createPrismaClient } from '../infra/prisma';
import { HealthController } from './health.controller';

/**
 * HealthModule — exposes `/health`, `/health/live`, `/health/ready`
 * (Task 24.3).
 *
 * Probe wiring:
 *   - `PrismaClient` — provided locally so the health pod has its own
 *     client and a Prisma outage in one feature module can't starve
 *     the probe.
 *   - `RedisService` — injected from the global `RedisModule`.
 *   - `OutboxDispatcher` — injected from the global `OutboxModule`,
 *     re-exported under the `OutboxDispatcherHealth` contract.
 *   - `Queue('notification-fanout')` — used as the BullMQ probe.
 *     The queue is already registered globally by `BullMqModule`, but
 *     re-registering it here is a no-op at runtime AND makes
 *     `@InjectQueue` resolve in unit tests that import `HealthModule`
 *     in isolation.
 *
 * Every dependency is `@Optional()` on the controller so unit tests can
 * mount the module against an in-memory stack without a live infra
 * dependency.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATION_FANOUT })],
  controllers: [HealthController],
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
})
export class HealthModule {}
