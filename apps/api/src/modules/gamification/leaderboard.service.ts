import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Updates user score in global and weekly leaderboards.
   */
  async updateScore(userId: string, totalXp: number, weeklyXp: number) {
    const now = new Date();
    const weekKey = `lb:weekly:${now.getFullYear()}:${this.getWeekNumber(now)}`;
    const globalKey = 'lb:global';

    const client = this.redis.getClient();
    
    await Promise.all([
      client.zadd(globalKey, totalXp, userId),
      client.zadd(weekKey, weeklyXp, userId),
    ]);

    // Set TTL for weekly leaderboard (8 days)
    await client.expire(weekKey, 604800 * 1.14);
  }

  async getGlobalTop(limit = 100, key = 'lb:global') {
    const client = this.redis.getClient();
    const results = await client.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    return this.formatRedisResults(results);
  }

  async getWeeklyKey() {
    const now = new Date();
    return `lb:weekly:${now.getFullYear()}:${this.getWeekNumber(now)}`;
  }

  async getUserRank(userId: string, key = 'lb:global') {
    const client = this.redis.getClient();
    const rank = await client.zrevrank(key, userId);
    const score = await client.zscore(key, userId);
    return { rank: rank !== null ? rank + 1 : null, score: score ? parseInt(score, 10) : 0 };
  }

  private getWeekNumber(d: Date): number {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
  }

  private formatRedisResults(results: (string | undefined)[]) {
    const formatted: { userId: string; xp: number; rank: number }[] = [];
    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const xpStr = results[i + 1];
      if (userId !== undefined && xpStr !== undefined) {
        formatted.push({
          userId,
          xp: parseInt(xpStr, 10),
          rank: (i / 2) + 1,
        });
      }
    }
    return formatted;
  }
}
