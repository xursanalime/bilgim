import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { R2Service } from './r2.service';
import { LocalStorage } from './local-storage';
import { StorageController } from './storage.controller';

/**
 * R2Module — provides the singleton R2 (S3-compatible) client wrapper.
 *
 * Marked `@Global` so any bounded context (initially Media; later Live's
 * recorder finalizer and the Transcoding worker) can inject `R2Service`
 * without re-registering it.
 *
 * Also wires the local-filesystem fallback ({@link LocalStorage}) and its
 * presigned-URL endpoints ({@link StorageController}) used when
 * `STORAGE_DRIVER=local` (single-box / dev media server).
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [StorageController],
  providers: [R2Service, LocalStorage],
  exports: [R2Service, LocalStorage],
})
export class R2Module {}
