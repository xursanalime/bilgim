import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GamificationService } from './gamification.service';
import { StreakService } from './streak.service';
import { ChallengeService } from './challenge.service';

@Injectable()
export class GamificationEventHandler {
  private readonly logger = new Logger(GamificationEventHandler.name);

  constructor(
    private readonly gamificationService: GamificationService,
    private readonly streakService: StreakService,
    private readonly challengeService: ChallengeService,
  ) {}

  @OnEvent('homework.submitted')
  async handleHomeworkSubmitted(payload: { studentId: string; assignmentId: string; submittedAt: Date }) {
    this.logger.debug(`Handling homework.submitted for user ${payload.studentId}`);
    
    // 1. Award XP
    await this.gamificationService.awardXp(payload.studentId, 30, 'homework_submitted', {
      assignmentId: payload.assignmentId,
    });

    // 2. Record Streak Activity
    await this.streakService.recordActivity(payload.studentId);
    
    // 3. Increment Challenge Progress
    await this.challengeService.incrementProgress(payload.studentId, 'homework_submitted');
  }

  @OnEvent('live.attended')
  async handleLiveAttended(payload: { userId: string; sessionId: string; durationSeconds: number }) {
    if (payload.durationSeconds < 300) return; // Min 5 minutes

    await this.gamificationService.awardXp(payload.userId, 40, 'live_attended', {
      sessionId: payload.sessionId,
    });

    await this.streakService.recordActivity(payload.userId);
    await this.challengeService.incrementProgress(payload.userId, 'live_attended');
  }

  @OnEvent('auth.login')
  async handleUserLogin(payload: { userId: string }) {
    // Award XP for first login (need to check if already awarded)
    await this.gamificationService.awardXp(payload.userId, 50, 'first_login');
    await this.streakService.recordActivity(payload.userId);
  }

  @OnEvent('ai.tutor_used')
  async handleAiTutorUsed(payload: { userId: string }) {
    await this.gamificationService.awardXp(payload.userId, 25, 'ai_tutor_used');
    await this.challengeService.incrementProgress(payload.userId, 'ai_tutor_used');
  }

  @OnEvent('lesson.viewed')
  async handleLessonViewed(payload: { userId: string; lessonId: string }) {
    await this.challengeService.incrementProgress(payload.userId, 'lesson_viewed');
  }

  @OnEvent('homework.graded')
  async handleHomeworkGraded(payload: { teacherId: string; submissionId: string; score: number }) {
    await this.gamificationService.awardXp(payload.teacherId, 25, 'homework_graded');
    await this.challengeService.incrementProgress(payload.teacherId, 'homework_graded');
  }
}
