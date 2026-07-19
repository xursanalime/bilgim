import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient, UserRole } from '@prisma/client';
import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { GamificationProfileRepository } from './repositories/gamification-profile.repository';
import { XpEventRepository } from './repositories/xp-event.repository';
import { calculateLevel } from './gamification.constants';
import { LeaderboardService } from './leaderboard.service';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly profileRepo: GamificationProfileRepository,
    private readonly xpRepo: XpEventRepository,
    private readonly leaderboardService: LeaderboardService,
    @InjectQueue(QUEUE_NAMES.GAMIFICATION) private readonly gamificationQueue: Queue,
  ) {}

  /**
   * Enqueues an XP award job.
   */
  async awardXp(userId: string, amount: number, reason: string, metadata?: any) {
    await this.gamificationQueue.add('award-xp', {
      type: 'AWARD_XP',
      userId,
      amount,
      reason,
      metadata,
    });
  }

  /**
   * Handles the actual XP award logic (called by the processor).
   * Performed in a transaction to ensure consistency.
   */
  async handleAwardXp(userId: string, amount: number, reason: string, metadata?: any) {
    const result = await this.prisma.$transaction(async (tx) => {
      let profile = await tx.gamificationProfile.findUnique({
        where: { userId },
      });

      if (!profile) {
        // Auto-create profile if missing
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) {
          this.logger.error(`Cannot award XP: User ${userId} not found`);
          return;
        }

        profile = await tx.gamificationProfile.create({
          data: {
            userId,
            role: user.role,
          },
        });
      }

      // 1. Create XP Event
      await tx.xpEvent.create({
        data: {
          userId,
          amount,
          reason,
          metadata: metadata || {},
        },
      });

      // 2. Update Profile
      const newTotalXp = profile.totalXp + amount;
      const newWeeklyXp = profile.weeklyXp + amount;
      const newLevel = calculateLevel(newTotalXp, profile.role);

      const updatedProfile = await tx.gamificationProfile.update({
        where: { userId },
        data: {
          totalXp: newTotalXp,
          weeklyXp: newWeeklyXp,
          currentLevel: newLevel,
          lastActiveDate: new Date(),
        },
      });

      // 3. Check for level up
      if (newLevel > profile.currentLevel) {
        this.logger.log(`User ${userId} leveled up: ${profile.currentLevel} -> ${newLevel}`);
        await tx.notification.upsert({
          where: { idempotencyKey: `gamification.level_up:${userId}:${newLevel}` },
          create: {
            userId,
            kind: 'GAMIFICATION_LEVEL_UP' as any,
            title: `${newLevel}-darajaga ko'tarildingiz!`,
            body: `Tabriklaymiz! Siz yangi darajaga — ${newLevel}-darajaga erishdingiz. Davom eting!`,
            data: { oldLevel: profile.currentLevel, newLevel },
            idempotencyKey: `gamification.level_up:${userId}:${newLevel}`,
          },
          update: {},
        });
      }

      // 4. Enqueue badge check
      await this.gamificationQueue.add('check-badges', {
        type: 'CHECK_BADGES',
        userId,
        triggerEvent: reason,
      });

      return updatedProfile;
    });

    // 5. Update Leaderboard (Redis) — Outside the transaction
    try {
      if (result) {
        await this.leaderboardService.updateScore(userId, result.totalXp, result.weeklyXp);
      }
    } catch (err) {
      this.logger.error(`Failed to update leaderboard for user ${userId}:`, err);
    }

    return result;
  }

  async getProfile(userId: string) {
    try {
      let profile = await this.profileRepo.findByUserId(userId);

      if (!profile) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        if (!user) {
          // Null emas, default object qaytarish kerak
          return {
            userId,
            role: 'STUDENT' as const,
            totalXp: 0,
            weeklyXp: 0,
            currentLevel: 1,
            currentStreak: 0,
            longestStreak: 0,
            lastActiveDate: null,
            freezesLeft: 3,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            xpHistory: [],
          };
        }

        // Profil yaratishni try/catch bilan o'ra (race condition bo'lishi mumkin)
        try {
          profile = await this.prisma.gamificationProfile.create({
            data: { userId, role: user.role },
          });
        } catch (createError) {
          // Agar paralel so'rov profil yaratib qo'ygan bo'lsa — qaytadan qidir
          profile = await this.profileRepo.findByUserId(userId);
          if (!profile) {
            this.logger.error(
              'Failed to create or find gamification profile',
              createError,
            );
            throw createError;
          }
        }
      }

      // xpHistory ni ham try/catch bilan ol
      let xpHistory: any[] = [];
      try {
        xpHistory = await this.xpRepo.findByUserId(userId, 10);
      } catch (xpError) {
        this.logger.warn(
          'Failed to fetch xpHistory, returning empty array',
          xpError,
        );
      }

      return { ...profile, xpHistory };
    } catch (error) {
      this.logger.error(`getProfile failed for userId=${userId}`, error);
      // 500 o'rniga fallback object qaytarish
      return {
        userId,
        role: 'STUDENT' as const,
        totalXp: 0,
        weeklyXp: 0,
        currentLevel: 1,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        freezesLeft: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        xpHistory: [],
      };
    }
  }

  async getUsersDetails(userIds: string[]) {
    return this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, avatarUrl: true },
    });
  }
}
