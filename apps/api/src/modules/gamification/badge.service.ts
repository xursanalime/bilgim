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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    // Badges are disabled for teachers.
    if (user?.role === UserRole.TEACHER) return;

    const activeBadges = await this.badgeRepo.findAllActive();

    for (const badge of activeBadges) {
      // 1. Skip if user already has it
      if (await this.badgeRepo.hasBadge(userId, badge.id)) continue;

      // 2. Check role restriction
      if (badge.targetRole && user?.role !== badge.targetRole) continue;

      // 3. Evaluate criteria based on slug
      const shouldAward = await this.evaluateBadgeCriteria(userId, badge.slug, triggerEvent);

      if (shouldAward) {
        await this.awardBadge(userId, badge.slug);
      }
    }
  }

  /**
   * Award a badge by slug, from outside the criteria loop (e.g. the
   * weekly-leaderboard cron). Idempotent: re-awarding is swallowed by the
   * unique constraint on `(userId, badgeId)`.
   */
  async awardBadgeBySlug(userId: string, badgeSlug: string): Promise<void> {
    return this.awardBadge(userId, badgeSlug);
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
        return this.hasEarlySubmission(userId);

      case 'platform_pioneer':
        return this.isAmongFirstUsers(userId);

      // Add more cases for all badges in the spec
      default:
        return false;
    }
  }

  /**
   * `early_bird` — the student submitted some assignment at least
   * {@link EARLY_BIRD_LEAD_MS} before its deadline.
   *
   * Evaluated by querying the student's own submissions rather than
   * relying on the trigger payload, because `checkAndAwardBadges` only
   * receives `(userId, triggerEvent)` — there is no submission id to work
   * from. Assignments with no `dueAt` are excluded: "early" is meaningless
   * without a deadline.
   */
  private async hasEarlySubmission(userId: string): Promise<boolean> {
    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId: userId,
        submittedAt: { not: null },
        assignment: { dueAt: { not: null } },
      },
      select: {
        submittedAt: true,
        assignment: { select: { dueAt: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: EARLY_BIRD_SCAN_LIMIT,
    });

    return submissions.some(({ submittedAt, assignment }) => {
      if (!submittedAt || !assignment.dueAt) return false;
      return (
        assignment.dueAt.getTime() - submittedAt.getTime() >= EARLY_BIRD_LEAD_MS
      );
    });
  }

  /**
   * `platform_pioneer` — this user is one of the first
   * {@link PLATFORM_PIONEER_CUTOFF} accounts created.
   *
   * Counts accounts registered strictly *before this user*. The previous
   * implementation counted every row with `createdAt < now()` — i.e. the
   * whole table — so the badge was awarded to everyone while the platform
   * had under 1000 users and to nobody afterwards, regardless of when the
   * recipient actually joined.
   */
  private async isAmongFirstUsers(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user) return false;

    const earlierUsers = await this.prisma.user.count({
      where: { createdAt: { lt: user.createdAt } },
    });
    return earlierUsers < PLATFORM_PIONEER_CUTOFF;
  }
}

/** `early_bird`: how far ahead of the deadline counts as "early". */
const EARLY_BIRD_LEAD_MS = 24 * 60 * 60 * 1000;

/**
 * How many of the student's most recent submissions to scan for
 * `early_bird`. Bounded so the check stays O(1)-ish for prolific
 * students; the badge is awarded once, so an older qualifying submission
 * falling out of the window is not worth an unbounded query.
 */
const EARLY_BIRD_SCAN_LIMIT = 50;

/** `platform_pioneer`: the first N accounts on the platform. */
const PLATFORM_PIONEER_CUTOFF = 1000;
