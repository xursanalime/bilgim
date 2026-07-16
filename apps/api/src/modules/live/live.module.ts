import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { LiveGateway } from './live.gateway';
import { LiveSessionRepository } from './repositories/live-session.repository';
import {
  FakeRecorderAdapter,
  MediasoupRecorderAdapter,
  RECORDER_PORT,
  RecordingFinalizer,
  RecordingProcessor,
  RecordingRepository,
  RecordingService,
} from './recording';
import { SfuModule } from './sfu/sfu.module';
import { AuthModule } from '../auth/auth.module';

/**
 * LiveModule — owns the LiveSession lifecycle (Req 9.1 – 9.8) AND the
 * recording orchestration (Req 9.5 – 9.8, Task 12.3).
 */
@Module({
  imports: [ConfigModule, SfuModule, forwardRef(() => AuthModule)],
  controllers: [LiveController],
  providers: [
    LiveService,
    LiveSessionRepository,
    LessonAccessGuard,
    LiveGateway,
    // Recording orchestration (Task 12.3, Req 9.5 – 9.8).
    RecordingRepository,
    RecordingService,
    RecordingProcessor,
    // Content-protection finalize hook (Task 4.1, Req 5.1 – 5.3).
    RecordingFinalizer,
    FakeRecorderAdapter,
    MediasoupRecorderAdapter,
    {
      // Recorder selection by environment:
      //   - Production → MediasoupRecorderAdapter (the real pipeline; currently
      //     a stub that fails finalize until implemented).
      //   - Dev/test  → FakeRecorderAdapter, which returns a synthetic success
      //     so the end → finalize → READY recording flow works end-to-end
      //     locally (no real ffmpeg/R2). Override with LIVE_RECORDER=fake|real.
      provide: RECORDER_PORT,
      useFactory: (
        fake: FakeRecorderAdapter,
        mediasoup: MediasoupRecorderAdapter,
      ) => {
        const override = process.env.LIVE_RECORDER?.toLowerCase();
        if (override === 'fake') return fake;
        if (override === 'real') return mediasoup;
        return process.env.NODE_ENV === 'production' ? mediasoup : fake;
      },
      inject: [FakeRecorderAdapter, MediasoupRecorderAdapter],
    },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [LiveService, LiveSessionRepository, RecordingService, RecordingFinalizer],
})
export class LiveModule {}
