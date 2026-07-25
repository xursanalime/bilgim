import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, UserRole } from '@prisma/client';
import { GamificationService } from './gamification.service';

@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Records user activity and updates streak.
   * Called whenever a user performs a streak-eligible action.
   */
  async recordActivity(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.gamificationProfile.findUnique({
        where: { userId },
      });

      if (!profile) return;

      // Streaks are disabled for teachers.
      if (profile.role === UserRole.TEACHER) return;

      const lastActive = profile.lastActiveDate ? new Date(profile.lastActiveDate) : null;
      if (lastActive) lastActive.setHours(0, 0, 0, 0);

      // Already active today
      if (lastActive && lastActive.getTime() === today.getTime()) {
        return profile;
      }

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let newStreak = profile.currentStreak;

      if (lastActive && lastActive.getTime() === yesterday.getTime()) {
        // Continuous streak
        newStreak += 1;
      } else if (!lastActive || lastActive.getTime() < yesterday.getTime()) {
        // Streak broken, reset to 1
        newStreak = 1;
      }

      const newLongestStreak = Math.max(profile.longestStreak, newStreak);

      const updatedProfile = await tx.gamificationProfile.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak: newLongestStreak,
          lastActiveDate: new Date(),
        },
      });

      // Check milestones
      await this.checkStreakMilestones(userId, newStreak);

      return updatedProfile;
    });
  }

  async useFreeze(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.gamificationProfile.findUnique({
        where: { userId },
      });

      if (!profile || profile.role === UserRole.TEACHER || profile.freezesLeft <= 0) {
        throw new Error('No freezes left');
      }

      // Logic: Prevents streak reset if called before daily reset
      return tx.gamificationProfile.update({
        where: { userId },
        data: {
          freezesLeft: profile.freezesLeft - 1,
          lastActiveDate: new Date(), // Simulates activity
        },
      });
    });
  }

  private async checkStreakMilestones(userId: string, streak: number) {
    const milestones = [7, 14, 30, 60, 100, 365];
    if (milestones.includes(streak)) {
      const xpReward = streak === 7 ? 200 : streak === 30 ? 1000 : 500;
      await this.gamificationService.awardXp(userId, xpReward, 'streak_milestone', { streak });
    }
  }
}
