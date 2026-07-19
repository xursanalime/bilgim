import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infra/bullmq/queue.constants';
import { GamificationService } from '../gamification.service';
import { StreakService } from '../streak.service';
import { ChallengeService } from '../challenge.service';

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATION_FANOUT)
export class GamificationOutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(GamificationOutboxProcessor.name);

  constructor(
    private readonly gamificationService: GamificationService,
    private readonly streakService: StreakService,
    private readonly challengeService: ChallengeService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    const { topic, payload } = job.data;
    this.logger.debug(`Processing outbox event for gamification: ${topic}`);

    switch (topic) {
      case 'submission.submitted':
        await this.gamificationService.awardXp(payload.studentId, 30, 'homework_submitted', {
          assignmentId: payload.submissionId,
        });
        await this.streakService.recordActivity(payload.studentId);
        await this.challengeService.incrementProgress(payload.studentId, 'homework_submitted');
        break;

      case 'homework.graded':
        await this.gamificationService.awardXp(payload.teacherId, 25, 'homework_graded');
        await this.challengeService.incrementProgress(payload.teacherId, 'homework_graded');
        break;

      case 'live.attended':
        if (payload.durationSeconds >= 300) {
          await this.gamificationService.awardXp(payload.userId, 40, 'live_attended', {
            sessionId: payload.sessionId,
          });
          await this.streakService.recordActivity(payload.userId);
          await this.challengeService.incrementProgress(payload.userId, 'live_attended');
        }
        break;

      case 'ai.tutor_used':
        await this.gamificationService.awardXp(payload.userId, 25, 'ai_tutor_used');
        await this.challengeService.incrementProgress(payload.userId, 'ai_tutor_used');
        break;
      
      case 'lesson.viewed':
        await this.challengeService.incrementProgress(payload.userId, 'lesson_viewed');
        break;

      case 'auth.login':
        await this.gamificationService.awardXp(payload.userId, 50, 'first_login');
        await this.streakService.recordActivity(payload.userId);
        break;

      default:
        // Not a gamification-relevant topic
        break;
    }
  }
}
