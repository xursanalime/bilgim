import { Injectable } from '@nestjs/common';
import { PrismaClient, DailyChallenge, ChallengeProgress, UserRole } from '@prisma/client';

@Injectable()
export class ChallengeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findDailyChallenges(date: Date, role: UserRole): Promise<DailyChallenge[]> {
    return this.prisma.dailyChallenge.findMany({
      where: {
        date: {
          equals: date,
        },
        targetRole: role,
      },
    });
  }

  async findUserProgress(userId: string, challengeIds: string[]): Promise<ChallengeProgress[]> {
    return this.prisma.challengeProgress.findMany({
      where: {
        userId,
        challengeId: { in: challengeIds },
      },
    });
  }

  async upsertProgress(userId: string, challengeId: string, increment: number): Promise<ChallengeProgress> {
    const progress = await this.prisma.challengeProgress.findUnique({
      where: { userId_challengeId: { userId, challengeId } },
    });

    if (progress && progress.completed) return progress;

    return this.prisma.challengeProgress.upsert({
      where: { userId_challengeId: { userId, challengeId } },
      create: {
        userId,
        challengeId,
        currentCount: increment,
      },
      update: {
        currentCount: { increment },
      },
    });
  }

  async markAsCompleted(id: string): Promise<ChallengeProgress> {
    return this.prisma.challengeProgress.update({
      where: { id },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });
  }
}
