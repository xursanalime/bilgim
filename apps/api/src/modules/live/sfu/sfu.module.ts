import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MediasoupAdapter } from './mediasoup.adapter';
import { MEDIASOUP_PORT } from './mediasoup.port';
import { SfuService } from './sfu.service';
import { LiveKitService } from './livekit.service';

/**
 * SfuModule — wires `SfuService`, `LiveKitService` and binds the production
 * `MediasoupAdapter` to the `MEDIASOUP_PORT` token.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    SfuService,
    LiveKitService,
    {
      provide: MEDIASOUP_PORT,
      useClass: MediasoupAdapter,
    },
  ],
  exports: [SfuService, LiveKitService, MEDIASOUP_PORT],
})
export class SfuModule {}
