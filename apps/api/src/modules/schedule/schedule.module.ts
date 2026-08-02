import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ScheduleRepository } from './repositories/schedule.repository';

/**
 * ScheduleModule — owns the per-group recurring `Schedule` lifecycle and
 * the `schedule.changed` outbox emission (Req 10.1, 10.2, 10.3, 10.5).
 *
 * Outbox events emitted: `schedule.changed`.
 *
 * Imports the global `OutboxModule` (already wired in `AppModule`) via
 * `OutboxService` injection. Owns its own `PrismaClient` instance,
 * matching the bounded-context pattern used by the other modules.
 */
@Module({
  imports: [ConfigModule],
  controllers: [ScheduleController],
  providers: [
    ScheduleService,
    ScheduleRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [ScheduleService, ScheduleRepository],
})
export class ScheduleModule {}
