import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';
import { BadgeRepository } from './repositories/badge.repository';
import { GamificationService } from './gamification.service';
import {
  ENGLISH_BADGE_DEFINITIONS,
  EnglishBadgeDefinition,
  BadgeRethemePatch,
  BadgeRethemeSchema,
  toBadgePersistencePayload,
  isLegacyBadgeSlug,
} from './english-badges.constants';

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

  // ===========================================================================
  // English re-theming (Task 7.3 — Req 13.1/13.2/13.3)
  //
  // The badge *mechanics* above are untouched. The methods below let the
  // platform present an English-learning themed catalog and retire/re-theme
  // legacy non-English badges without deleting historical awards.
  // ===========================================================================

  /** Return the static English-learning badge catalog (catalog-only metadata). */
  getEnglishBadgeCatalog(): readonly EnglishBadgeDefinition[] {
    return ENGLISH_BADGE_DEFINITIONS;
  }

  /**
   * Idempotently upsert every English-themed badge definition. Re-running is
   * safe and never deletes existing UserBadge awards (Req 13.1/13.2).
   */
  async syncEnglishBadges(): Promise<number> {
    for (const def of ENGLISH_BADGE_DEFINITIONS) {
      const payload = toBadgePersistencePayload(def);
      await this.badgeRepo.upsertBySlug(payload.slug, payload);
    }
    this.logger.log(
      `Synced ${ENGLISH_BADGE_DEFINITIONS.length} English-themed badges`,
    );
    return ENGLISH_BADGE_DEFINITIONS.length;
  }

  /**
   * Deactivate (retire) a badge so it can no longer be awarded, while keeping
   * the Badge row and all historical UserBadge awards intact (Req 13.3,
   * non-destructive). Typically used for legacy non-English badges.
   */
  async deactivateBadge(slug: string) {
    const badge = await this.badgeRepo.findBySlug(slug);
    if (!badge) {
      throw new NotFoundException(`Badge not found: ${slug}`);
    }
    const updated = await this.badgeRepo.setActive(slug, false);
    this.logger.log(
      `Retired badge '${slug}'${isLegacyBadgeSlug(slug) ? ' (legacy non-English)' : ''}; historical awards preserved`,
    );
    return updated;
  }

  /** Re-activate a previously retired badge. */
  async reactivateBadge(slug: string) {
    const badge = await this.badgeRepo.findBySlug(slug);
    if (!badge) {
      throw new NotFoundException(`Badge not found: ${slug}`);
    }
    return this.badgeRepo.setActive(slug, true);
  }

  /**
   * Re-theme an existing badge's display metadata (name/description/icon/
   * rarity/category) for English learning. Does not change the slug, criteria,
   * or any awarded UserBadge records (Req 13.3).
   */
  async rethemeBadge(slug: string, patch: BadgeRethemePatch) {
    const parsed = BadgeRethemeSchema.parse(patch);
    const badge = await this.badgeRepo.findBySlug(slug);
    if (!badge) {
      throw new NotFoundException(`Badge not found: ${slug}`);
    }
    // Drop any undefined keys so the update payload satisfies Prisma's
    // strict (exactOptionalPropertyTypes) update input type.
    const data = Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== undefined),
    );
    const updated = await this.badgeRepo.updateBySlug(slug, data);
    this.logger.log(`Re-themed badge '${slug}' for English learning`);
    return updated;
  }
}
