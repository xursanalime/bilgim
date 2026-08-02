import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class RewardService {
  constructor(private readonly prisma: PrismaClient) {}

  async listItems() {
    return this.prisma.rewardItem.findMany({
      where: { isActive: true },
    });
  }

  async purchaseItem(userId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.rewardItem.findUnique({
        where: { id: itemId, isActive: true },
      });

      if (!item) throw new BadRequestException('Item not found or inactive');

      const profile = await tx.gamificationProfile.findUnique({
        where: { userId },
      });

      if (!profile || profile.totalXp < item.xpCost) {
        throw new BadRequestException('Insufficient XP');
      }

      // 1. Create purchase record
      const purchase = await tx.rewardPurchase.create({
        data: {
          userId,
          itemId,
          xpSpent: item.xpCost,
        },
      });

      // 2. Deduct XP
      await tx.gamificationProfile.update({
        where: { userId },
        data: {
          totalXp: { decrement: item.xpCost },
        },
      });

      // 3. Apply item effect if applicable
      if (item.itemType === 'streak_freeze') {
        await tx.gamificationProfile.update({
          where: { userId },
          data: {
            freezesLeft: { increment: 1 },
          },
        });
      }

      return purchase;
    });
  }
}
