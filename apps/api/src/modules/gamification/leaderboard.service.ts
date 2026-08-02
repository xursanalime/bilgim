import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Weekly leaderboard keys outlive their week by a day so a Monday-morning
 * request can still read the week that just closed. Must stay an integer —
 * Redis EXPIRE rejects fractional seconds with
 * "ERR value is not an integer or out of range".
 */
const WEEKLY_LEADERBOARD_TTL_SECONDS = 8 * 24 * 60 * 60;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Updates user score in global and weekly leaderboards.
   */
  async updateScore(userId: string, totalXp: number, weeklyXp: number) {
    const weekKey = this.buildWeeklyKey(new Date());
    const globalKey = 'lb:global';

    const client = this.redis.getClient();

    // Scores are XP totals; guard against a NaN/undefined leaking in from a
    // caller and poisoning the sorted set (ZADD would reject the whole call).
    await Promise.all([
      client.zadd(globalKey, this.toScore(totalXp), userId),
      client.zadd(weekKey, this.toScore(weeklyXp), userId),
    ]);

    await client.expire(weekKey, WEEKLY_LEADERBOARD_TTL_SECONDS);
  }

  async getGlobalTop(limit = 100, key = 'lb:global') {
    const client = this.redis.getClient();
    const results = await client.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    return this.formatRedisResults(results);
  }

  async getWeeklyKey() {
    return this.buildWeeklyKey(new Date());
  }

  async getUserRank(userId: string, key = 'lb:global') {
    const client = this.redis.getClient();
    const rank = await client.zrevrank(key, userId);
    const score = await client.zscore(key, userId);
    return { rank: rank !== null ? rank + 1 : null, score: score ? parseInt(score, 10) : 0 };
  }

  /**
   * `lb:weekly:<isoWeekYear>:<isoWeek>`.
   *
   * Both halves come from the same ISO-8601 calculation. Pairing a local
   * calendar year with an ISO week number breaks at year boundaries — 1 Jan
   * 2027 falls in ISO week 53 of 2026, which would otherwise be filed under
   * `2027:53`, a week that does not exist, splitting the leaderboard.
   */
  private buildWeeklyKey(d: Date): string {
    const { year, week } = this.getIsoWeek(d);
    return `lb:weekly:${year}:${week}`;
  }

  /** ISO-8601 week number *and* the week-year it belongs to. */
  private getIsoWeek(date: Date): { year: number; week: number } {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    // Shift to the Thursday of this ISO week — the week-year is whichever
    // year that Thursday falls in.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return { year, week };
  }

  /**
   * Coerce an XP value into a finite integer Redis will accept as a sorted-set
   * score. A single NaN rejects the entire ZADD, so callers upstream of a bad
   * XP calculation would silently lose every leaderboard write.
   */
  private toScore(xp: number): number {
    return Number.isFinite(xp) ? Math.trunc(xp) : 0;
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
