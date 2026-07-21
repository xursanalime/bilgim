import { Global, Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';
import { CacheService } from './cache.service';

/**
 * `CacheModule` exposes a single `CacheService` provider globally so
 * any bounded-context module can wrap a slow query (or AI call, or R2
 * fetch) in `getOrSet`. RedisModule is already `@Global()` but we
 * import it explicitly here to make the dependency direction obvious
 * and to keep the `CacheService` provider testable in isolation.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
