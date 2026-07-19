import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';
import { BadgeRepository } from './repositories/badge.repository';
import { GamificationService } from './gamification.service';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly badgeRepo: BadgeRepository,
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * Main entry point for badge checking.
   * Can be triggered by specific events (e.g. 'homework_submitted') or general XP award.
   */
  async checkAndAwardBadges(userId: string, triggerEvent?: string) {
    const activeBadges = await this.badgeRepo.findAllActive();
    
    for (const badge of activeBadges) {
      // 1. Skip if user already has it
      if (await this.badgeRepo.hasBadge(userId, badge.id)) continue;

      // 2. Check role restriction
      if (badge.targetRole) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (user?.role !== badge.targetRole) continue;
      }

      // 3. Evaluate criteria based on slug
      const shouldAward = await this.evaluateBadgeCriteria(userId, badge.slug, triggerEvent);

      if (shouldAward) {
        await this.awardBadge(userId, badge.slug);
      }
    }
  }

  private async awardBadge(userId: string, badgeSlug: string) {
    const badge = await this.badgeRepo.findBySlug(badgeSlug);
    if (!badge) return;

    try {
      await this.badgeRepo.awardBadge(userId, badge.id);
      this.logger.log(`User ${userId} earned badge: ${badgeSlug}`);

      // Reward XP if defined
      if (badge.xpReward > 0) {
        await this.gamificationService.awardXp(userId, badge.xpReward, 'badge_earned', { badgeSlug });
      }

      // TODO: Emit notification
    } catch (e) {
      // Handle race condition (already earned)
      this.logger.debug(`Badge ${badgeSlug} already earned by ${userId}`);
    }
  }

  private async evaluateBadgeCriteria(userId: string, slug: string, triggerEvent?: string): Promise<boolean> {
    switch (slug) {
      case 'first_live':
        return triggerEvent === 'live.attended';
      
      case 'early_bird':
        if (triggerEvent !== 'homework.submitted') return false;
        // Logic: 24h before deadline
        return false; // Placeholder

      case 'platform_pioneer':
        const userCount = await this.prisma.user.count({
          where: { createdAt: { lt: new Date() } } // This is tricky, need a fixed date or sequence
        });
        return userCount <= 1000;

      // Add more cases for all badges in the spec
      default:
        return false;
    }
  }
}
