import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxService } from './outbox.service';
import { OutboxDispatcher } from './outbox.dispatcher';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../prisma';

/**
 * OutboxModule provides the transactional outbox pattern:
 * - OutboxService: Creates OutboxEvent within a Prisma transaction (same DB tx as business op)
 * - OutboxDispatcher: Polls PENDING events and dispatches to BullMQ queues
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5
 *
 * This module is Global so any bounded context module can inject OutboxService.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    OutboxService,
    OutboxDispatcher,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [OutboxService, OutboxDispatcher],
})
export class OutboxModule {}
