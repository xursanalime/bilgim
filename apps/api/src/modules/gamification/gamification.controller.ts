import { Controller, Get, Post, Param, UseGuards, Query } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { LeaderboardService } from './leaderboard.service';
import { ChallengeService } from './challenge.service';
import { RewardService } from './reward.service';
import { BadgeRepository } from './repositories/badge.repository';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtPayload } from '../auth/tokens.service';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(
    private readonly gamificationService: GamificationService,
    private readonly leaderboardService: LeaderboardService,
    private readonly challengeService: ChallengeService,
    private readonly rewardService: RewardService,
    private readonly badgeRepo: BadgeRepository,
  ) {}

  @Get('me')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getMyProfile(@CurrentUser() user: JwtPayload) {
    return this.gamificationService.getProfile(user.sub);
  }

  @Get('me/badges')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getMyBadges(@CurrentUser() user: JwtPayload) {
    return this.badgeRepo.findUserBadges(user.sub);
  }

  @Get('leaderboard/global')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getGlobalLeaderboard(
    @CurrentUser() user: JwtPayload, 
    @Query('limit') limit = 100,
    @Query('type') type: 'GLOBAL' | 'WEEKLY' = 'GLOBAL'
  ) {
    const key = type === 'WEEKLY' ? await this.leaderboardService.getWeeklyKey() : 'lb:global';
    const top = await this.leaderboardService.getGlobalTop(limit, key);
    
    // Fetch user details for the top list
    const userIds = top.map(t => t.userId);
    const users = await this.gamificationService.getUsersDetails(userIds);

    const enrichedTop = top.map(t => {
      const u = users.find(user => user.id === t.userId);
      return {
        ...t,
        fullName: u?.fullName || `Foydalanuvchi ${t.userId.slice(0, 4)}`,
        avatarUrl: u?.avatarUrl,
      };
    });

    const myRank = await this.leaderboardService.getUserRank(user.sub, key);
    return { top: enrichedTop, myRank };
  }

  @Get('challenges/today')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getTodayChallenges(@CurrentUser() user: JwtPayload) {
    return this.challengeService.getTodayChallenges(user.sub);
  }

  @Get('badges')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getAllBadges() {
    return this.badgeRepo.findAllActive();
  }

  @Get('rewards')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async getRewards() {
    return this.rewardService.listItems();
  }

  @Post('rewards/:id/purchase')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN)
  async purchaseReward(@CurrentUser() user: JwtPayload, @Param('id') itemId: string) {
    return this.rewardService.purchaseItem(user.sub, itemId);
  }

  // Admin endpoints
  @Post('admin/challenges/seed')
  @Roles(UserRole.ADMIN)
  async seedChallenges(@Query('date') dateStr?: string) {
    const date = dateStr ? new Date(dateStr) : new Date();
    date.setHours(0, 0, 0, 0);
    await this.challengeService.seedDailyChallenges(date);
    return { success: true };
  }
}
