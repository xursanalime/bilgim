import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { GamificationService } from '../gamification.service';
import { BadgeService } from '../badge.service';

export type GamificationJob =
  | { type: 'AWARD_XP'; userId: string; amount: number; reason: string; metadata?: any }
  | { type: 'CHECK_BADGES'; userId: string; triggerEvent?: string };

@Injectable()
@Processor(QUEUE_NAMES.GAMIFICATION)
export class GamificationProcessor extends WorkerHost {
  private readonly logger = new Logger(GamificationProcessor.name);

  constructor(
    private readonly gamificationService: GamificationService,
    private readonly badgeService: BadgeService,
  ) {
    super();
  }

  async process(job: Job<GamificationJob>): Promise<void> {
    const { data } = job;
    this.logger.debug(`Processing gamification job: ${data.type} for user ${data.userId}`);

    switch (data.type) {
      case 'AWARD_XP':
        await this.gamificationService.handleAwardXp(data.userId, data.amount, data.reason, data.metadata);
        break;
      case 'CHECK_BADGES':
        await this.badgeService.checkAndAwardBadges(data.userId, data.triggerEvent);
        break;
      default:
        this.logger.warn(`Unknown gamification job type: ${(data as any).type}`);
    }
  }
}
