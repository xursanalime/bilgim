import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EnvConfig } from '../../config/env.schema';
import { NoopSentryAdapter } from './noop-sentry.adapter';
import { RealSentryAdapter } from './real-sentry.adapter';
import { SENTRY_ADAPTER } from './sentry.port';

/**
 * SentryModule — wires the `SENTRY_ADAPTER` token to the right
 * implementation based on the runtime environment (Task 24.3).
 *
 * Selection logic:
 *   - `NODE_ENV === 'production'`  → RealSentryAdapter (logs to the
 *     Nest logger today; will swap in the SDK once Phase 9 ships).
 *   - everything else              → NoopSentryAdapter, which drops
 *     events silently so test runs don't spam the real Sentry
 *     project.
 *
 * The module is `@Global()` so any feature can `@Inject(SENTRY_ADAPTER)`
 * without an extra import line.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    NoopSentryAdapter,
    RealSentryAdapter,
    {
      provide: SENTRY_ADAPTER,
      inject: [ConfigService, NoopSentryAdapter, RealSentryAdapter],
      useFactory: (
        config: ConfigService<EnvConfig, true>,
        noop: NoopSentryAdapter,
        real: RealSentryAdapter,
      ) => {
        const env = config.get('NODE_ENV', { infer: true });
        return env === 'production' ? real : noop;
      },
    },
  ],
  exports: [SENTRY_ADAPTER, NoopSentryAdapter, RealSentryAdapter],
})
export class SentryModule {}
