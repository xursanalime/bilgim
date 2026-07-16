import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, Badge, UserBadge, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';

@Injectable()
export class BadgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllActive(): Promise<Badge[]> {
    return this.prisma.badge.findMany({
      where: { isActive: true },
    });
  }

  async findAll(): Promise<Badge[]> {
    return this.prisma.badge.findMany();
  }

  async findBySlug(slug: string): Promise<Badge | null> {
    return this.prisma.badge.findUnique({
      where: { slug },
    });
  }

  /**
   * Idempotently create or update a badge by its slug. Used to sync the
   * English-themed badge catalog without touching historical awards.
   */
  async upsertBySlug(
    slug: string,
    data: Prisma.BadgeCreateInput,
  ): Promise<Badge> {
    return this.prisma.badge.upsert({
      where: { slug },
      create: data,
      update: data,
    });
  }

  /**
   * Toggle a badge's active state. Deactivating (isActive=false) retires a
   * badge from new awards while preserving existing UserBadge records
   * (non-destructive).
   */
  async setActive(slug: string, isActive: boolean): Promise<Badge> {
    return this.prisma.badge.update({
      where: { slug },
      data: { isActive },
    });
  }

  /**
   * Apply a re-theme patch (display metadata only) to an existing badge.
   * Does not alter awards, criteria, or the slug.
   */
  async updateBySlug(
    slug: string,
    data: Prisma.BadgeUpdateInput,
  ): Promise<Badge> {
    return this.prisma.badge.update({
      where: { slug },
      data,
    });
  }

  async findUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]> {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });
  }

  async awardBadge(userId: string, badgeId: string): Promise<UserBadge> {
    return this.prisma.userBadge.create({
      data: {
        userId,
        badgeId,
      },
    });
  }

  async hasBadge(userId: string, badgeId: string): Promise<boolean> {
    const count = await this.prisma.userBadge.count({
      where: { userId, badgeId },
    });
    return count > 0;
  }
}
