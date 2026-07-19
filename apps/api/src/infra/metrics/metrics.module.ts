import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * MetricsModule — exposes Prometheus metrics on `/metrics`
 * (Task 24.3, Req 26.2).
 *
 * The module is `@Global()` so feature modules (notifications,
 * billing, ai, outbox) can inject `MetricsService` directly without
 * having to import `MetricsModule` themselves.
 *
 * The HTTP duration histogram is observed via `MetricsInterceptor`,
 * which is wired globally through `APP_INTERCEPTOR`. The interceptor
 * runs alongside the `LoggingInterceptor` — order is irrelevant
 * because each only reads the request and writes to its own sink.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
