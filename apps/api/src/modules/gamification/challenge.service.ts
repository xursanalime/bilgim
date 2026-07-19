import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import { ChallengeRepository } from './repositories/challenge.repository';
import { GamificationService } from './gamification.service';

@Injectable()
export class ChallengeService {
  private readonly logger = new Logger(ChallengeService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly challengeRepo: ChallengeRepository,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Increments progress for all active challenges matching the event type.
   */
  async incrementProgress(userId: string, eventType: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return;

    const challenges = await this.prisma.dailyChallenge.findMany({
      where: {
        date: today,
        eventType,
        targetRole: user.role,
      },
    });

    for (const challenge of challenges) {
      const progress = await this.challengeRepo.upsertProgress(userId, challenge.id, 1);
      
      if (!progress.completed && progress.currentCount >= challenge.targetCount) {
        await this.challengeRepo.markAsCompleted(progress.id);
        await this.gamificationService.awardXp(userId, challenge.xpReward, 'challenge_completed', {
          challengeId: challenge.id,
          challengeName: challenge.nameUz,
        });
        this.logger.log(`User ${userId} completed challenge: ${challenge.nameUz}`);
      }
    }
  }

  async getTodayChallenges(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return [];

    const challenges = await this.challengeRepo.findDailyChallenges(today, user.role);
    const progress = await this.challengeRepo.findUserProgress(userId, challenges.map(c => c.id));

    return challenges.map(challenge => ({
      ...challenge,
      progress: progress.find(p => p.challengeId === challenge.id) || { currentCount: 0, completed: false },
    }));
  }

  /**
   * Seeds daily challenges for a specific date.
   */
  async seedDailyChallenges(date: Date) {
    const templates = [
      { nameUz: 'Bugun 2 ta uy vazifa topshir', targetCount: 2, eventType: 'homework_submitted', xpReward: 100, role: UserRole.STUDENT },
      { nameUz: 'Jonli darsga qatnash', targetCount: 1, eventType: 'live_attended', xpReward: 80, role: UserRole.STUDENT },
      { nameUz: 'AI tutordan 3 ta savol so\'ra', targetCount: 3, eventType: 'ai_tutor_used', xpReward: 60, role: UserRole.STUDENT },
      { nameUz: 'Talabalar vazifasini bahola', targetCount: 5, eventType: 'homework_graded', xpReward: 150, role: UserRole.TEACHER },
    ];

    for (const t of templates) {
      await this.prisma.dailyChallenge.upsert({
        where: {
          date_eventType_targetRole: {
            date,
            eventType: t.eventType,
            targetRole: t.role,
          },
        },
        create: {
          date,
          nameUz: t.nameUz,
          description: t.nameUz,
          xpReward: t.xpReward,
          targetCount: t.targetCount,
          eventType: t.eventType,
          targetRole: t.role,
        },
        update: {},
      });
    }
  }
}
