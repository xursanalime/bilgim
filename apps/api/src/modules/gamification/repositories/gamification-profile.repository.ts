import { Injectable } from '@nestjs/common';
import { PrismaClient, GamificationProfile, XpEvent } from '@prisma/client';

@Injectable()
export class GamificationProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<GamificationProfile | null> {
    return this.prisma.gamificationProfile.findUnique({
      where: { userId },
    });
  }

  async create(data: { userId: string; role: any }): Promise<GamificationProfile> {
    return this.prisma.gamificationProfile.create({
      data: {
        userId: data.userId,
        role: data.role,
      },
    });
  }

  async updateXp(userId: string, totalXp: number, weeklyXp: number, currentLevel: number): Promise<GamificationProfile> {
    return this.prisma.gamificationProfile.update({
      where: { userId },
      data: {
        totalXp,
        weeklyXp,
        currentLevel,
      },
    });
  }
}
