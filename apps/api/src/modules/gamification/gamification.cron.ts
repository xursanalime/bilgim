import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient, UserRole } from '@prisma/client';
import { StreakService } from './streak.service';
import { ChallengeService } from './challenge.service';
import { LeaderboardService } from './leaderboard.service';

@Injectable()
export class GamificationCron {
  private readonly logger = new Logger(GamificationCron.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly streakService: StreakService,
    private readonly challengeService: ChallengeService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  /**
   * Reset daily streaks for inactive users.
   * Runs daily at 00:05 UTC+5 (Tashkent).
   * Note: Cron is typically UTC, so 19:05 UTC.
   */
  @Cron('5 19 * * *', { timeZone: 'UTC' })
  async resetDailyStreak() {
    this.logger.log('Starting daily streak reset job');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // Users whose lastActiveDate is before yesterday and who didn't use a freeze
    // In a real system, we'd batch this.
    const profilesToReset = await this.prisma.gamificationProfile.findMany({
      where: {
        role: { not: UserRole.TEACHER },
        currentStreak: { gt: 0 },
        lastActiveDate: { lt: yesterday },
      },
      select: { userId: true, freezesLeft: true },
    });

    for (const profile of profilesToReset) {
      if (profile.freezesLeft > 0) {
        // Auto-use freeze if available? Spec says manual, but we can auto-use to be nice
        // For now, follow spec: reset if no activity
        await this.prisma.gamificationProfile.update({
          where: { userId: profile.userId },
          data: { currentStreak: 0 },
        });
      } else {
        await this.prisma.gamificationProfile.update({
          where: { userId: profile.userId },
          data: { currentStreak: 0 },
        });
      }
    }
    this.logger.log(`Streak reset job finished. Reset ${profilesToReset.length} users.`);
  }

  /**
   * Generate daily challenges at 06:00 Tashkent (01:00 UTC).
   */
  @Cron('0 1 * * *', { timeZone: 'UTC' })
  async generateDailyChallenges() {
    this.logger.log('Generating daily challenges');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await this.challengeService.seedDailyChallenges(today);
  }

  /**
   * Weekly leaderboard finalization: Monday 00:01 Tashkent (Sunday 19:01 UTC).
   */
  @Cron('1 19 * * 0', { timeZone: 'UTC' })
  async finalizeWeeklyLeaderboard() {
    this.logger.log('Finalizing weekly leaderboard');
    // 1. Get winners from Redis
    const top10 = await this.leaderboardService.getGlobalTop(10); // Placeholder for weekly
    
    // 2. Award badges / XP to top 3
    for (let i = 0; i < Math.min(top10.length, 3); i++) {
      // await this.badgeService.awardBadge(top10[i].userId, 'weekly_champion');
    }

    // 3. Reset weekly XP in DB
    await this.prisma.gamificationProfile.updateMany({
      where: { role: { not: UserRole.TEACHER } },
      data: { weeklyXp: 0 },
    });
  }
}
