import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';
import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { GamificationProfileRepository } from './repositories/gamification-profile.repository';
import { XpEventRepository } from './repositories/xp-event.repository';
import { BadgeRepository } from './repositories/badge.repository';
import { ChallengeRepository } from './repositories/challenge.repository';
import { GamificationProcessor } from './workers/gamification.processor';
import { GamificationOutboxProcessor } from './workers/gamification-outbox.processor';
import { BadgeService } from './badge.service';
import { StreakService } from './streak.service';
import { LeaderboardService } from './leaderboard.service';
import { ChallengeService } from './challenge.service';
import { RewardService } from './reward.service';
import { GamificationEventHandler } from './gamification-event.handler';
import { GamificationCron } from './gamification.cron';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.GAMIFICATION },
      { name: QUEUE_NAMES.NOTIFICATION_FANOUT },
    ),
    ScheduleModule.forRoot(),
  ],
  controllers: [GamificationController],
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
    GamificationService,
    GamificationProfileRepository,
    XpEventRepository,
    BadgeRepository,
    ChallengeRepository,
    GamificationProcessor,
    GamificationOutboxProcessor,
    BadgeService,
    StreakService,
    LeaderboardService,
    ChallengeService,
    RewardService,
    GamificationEventHandler,
    GamificationCron,
  ],
  exports: [GamificationService, StreakService, LeaderboardService, ChallengeService],
})
export class GamificationModule {}
