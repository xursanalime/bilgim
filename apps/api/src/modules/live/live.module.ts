import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { LiveCron } from './live.cron';
import { LiveGateway } from './live.gateway';
import { LiveSessionRepository } from './repositories/live-session.repository';
import {
  FakeRecorderAdapter,
  LiveKitEgressRecorderAdapter,
  MediasoupRecorderAdapter,
  RECORDER_PORT,
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
  imports: [ConfigModule, ScheduleModule.forRoot(), SfuModule, forwardRef(() => AuthModule)],
  controllers: [LiveController],
  providers: [
    LiveService,
    LiveCron,
    LiveSessionRepository,
    LessonAccessGuard,
    LiveGateway,
    // Recording orchestration (Task 12.3, Req 9.5 – 9.8).
    RecordingRepository,
    RecordingService,
    RecordingProcessor,
    FakeRecorderAdapter,
    MediasoupRecorderAdapter,
    LiveKitEgressRecorderAdapter,
    {
      provide: RECORDER_PORT,
      useExisting: LiveKitEgressRecorderAdapter,
    },
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [LiveService, LiveSessionRepository, RecordingService],
})
export class LiveModule {}
