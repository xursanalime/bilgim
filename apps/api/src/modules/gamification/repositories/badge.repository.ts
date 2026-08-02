import { Injectable } from '@nestjs/common';
import { PrismaClient, Badge, UserBadge, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';

@Injectable()
export class BadgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllActive(): Promise<Badge[]> {
    return this.prisma.badge.findMany({
      where: { isActive: true },
    });
  }

  async findBySlug(slug: string): Promise<Badge | null> {
    return this.prisma.badge.findUnique({
      where: { slug },
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
