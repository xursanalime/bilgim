import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { R2Service } from './r2.service';

/**
 * R2Module — provides the singleton R2 (S3-compatible) client wrapper.
 *
 * Marked `@Global` so any bounded context (initially Media; later Live's
 * recorder finalizer and the Transcoding worker) can inject `R2Service`
 * without re-registering it.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [R2Service],
  exports: [R2Service],
})
export class R2Module {}
