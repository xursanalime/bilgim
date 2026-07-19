import { Injectable } from '@nestjs/common';
import { PrismaClient, XpEvent, Prisma } from '@prisma/client';

@Injectable()
export class XpEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: { userId: string; amount: number; reason: string; metadata?: any }): Promise<XpEvent> {
    return this.prisma.xpEvent.create({
      data: {
        userId: data.userId,
        amount: data.amount,
        reason: data.reason,
        metadata: data.metadata || Prisma.DbNull,
      },
    });
  }

  async findByUserId(userId: string, limit = 20, offset = 0): Promise<XpEvent[]> {
    return this.prisma.xpEvent.findMany({
      where: { userId },
      orderBy: { earnedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
