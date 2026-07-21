import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';
import { EncryptionService } from '../../common/crypto';

import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingCron } from './billing.cron';
import { SubscriptionRepository } from './repositories/subscription.repository';
import { InvoiceRepository } from './repositories/invoice.repository';
import { PaymeAuthGuard } from './payme/payme-auth.guard';
import { PaymeController } from './payme/payme.controller';
import { PaymeService } from './payme/payme.service';

/**
 * BillingModule — owns Subscription, Plan, Invoice, and Payme integration.
 *
 * The `PrismaClient` provider is wrapped with the encryption extension
 * (Task 28.1) so `PaymeTransaction.account` (the payer-account JSON
 * payload, which can contain phone numbers / user identifiers) is
 * auto-encrypted at rest.
 */
@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule],
  controllers: [PaymeController, BillingController],
  providers: [
    BillingService,
    BillingCron,
    SubscriptionRepository,
    InvoiceRepository,
    PaymeService,
    PaymeAuthGuard,
    {
      provide: PrismaClient,
      useFactory: (encryption?: EncryptionService) =>
        createPrismaClient(
          encryption ? { encryption: { service: encryption } } : {},
        ),
      inject: [{ token: EncryptionService, optional: true }],
    },
  ],
  exports: [BillingService, SubscriptionRepository, InvoiceRepository, PaymeService],
})
export class BillingModule {}
