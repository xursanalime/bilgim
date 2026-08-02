import { Test } from '@nestjs/testing';

import { RedisService } from '../../infra/redis/redis.service';
import { LeaderboardService } from './leaderboard.service';

/**
 * LeaderboardService unit tests.
 *
 * Regression origin: every XP award logged
 *   `ReplyError: ERR value is not an integer or out of range`
 * because the weekly TTL was computed as `604800 * 1.14`, which is
 * 689472.0000000001 — a float. Redis EXPIRE only accepts integers, so the
 * weekly leaderboard key never got a TTL and the error fired on every
 * submission, login and enrollment.
 */
describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let client: {
    zadd: jest.Mock;
    expire: jest.Mock;
    zrevrange: jest.Mock;
    zrevrank: jest.Mock;
    zscore: jest.Mock;
  };

  beforeEach(async () => {
    client = {
      zadd: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zrevrange: jest.fn().mockResolvedValue([]),
      zrevrank: jest.fn().mockResolvedValue(null),
      zscore: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: RedisService, useValue: { getClient: () => client } },
      ],
    }).compile();

    service = moduleRef.get(LeaderboardService);
  });

  describe('updateScore', () => {
    it('passes an integer TTL to EXPIRE', async () => {
      await service.updateScore('user-1', 500, 120);

      expect(client.expire).toHaveBeenCalledTimes(1);
      const [, ttl] = client.expire.mock.calls[0]!;
      expect(Number.isInteger(ttl)).toBe(true);
      expect(ttl).toBe(8 * 24 * 60 * 60);
    });

    it('writes both the global and weekly sorted sets', async () => {
      await service.updateScore('user-1', 500, 120);

      expect(client.zadd).toHaveBeenCalledWith('lb:global', 500, 'user-1');
      expect(client.zadd).toHaveBeenCalledWith(
        expect.stringMatching(/^lb:weekly:\d{4}:\d{1,2}$/),
        120,
        'user-1',
      );
    });

    it('TTLs the weekly key, never the global one', async () => {
      await service.updateScore('user-1', 500, 120);

      const [key] = client.expire.mock.calls[0]!;
      expect(key).toMatch(/^lb:weekly:/);
    });

    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['undefined', undefined as unknown as number],
    ])('coerces a %s score to 0 rather than rejecting the ZADD', async (_l, bad) => {
      await service.updateScore('user-1', bad, bad);

      for (const call of client.zadd.mock.calls) {
        expect(Number.isInteger(call[1])).toBe(true);
      }
    });

    it('truncates fractional XP — Redis scores must be integers here', async () => {
      await service.updateScore('user-1', 500.7, 120.9);

      expect(client.zadd).toHaveBeenCalledWith('lb:global', 500, 'user-1');
    });
  });

  describe('weekly key', () => {
    it('pairs the ISO week with its ISO week-year', async () => {
      // 1 Jan 2027 is a Friday and belongs to ISO week 53 of 2026. Naively
      // pairing the calendar year with the ISO week would file it under
      // "2027:53" — a week that does not exist — splitting the board.
      jest.useFakeTimers().setSystemTime(new Date(2027, 0, 1));
      try {
        expect(await service.getWeeklyKey()).toBe('lb:weekly:2026:53');
      } finally {
        jest.useRealTimers();
      }
    });

    it('is stable across a single week', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 6, 27)); // Monday
      const monday = await service.getWeeklyKey();
      jest.setSystemTime(new Date(2026, 7, 2)); // the Sunday that closes it
      const sunday = await service.getWeeklyKey();
      jest.useRealTimers();

      expect(monday).toBe(sunday);
    });
  });

  describe('getUserRank', () => {
    it('converts a 0-based Redis rank to a 1-based position', async () => {
      client.zrevrank.mockResolvedValue(0);
      client.zscore.mockResolvedValue('550');

      await expect(service.getUserRank('user-1')).resolves.toEqual({
        rank: 1,
        score: 550,
      });
    });

    it('reports rank null for a user absent from the board', async () => {
      await expect(service.getUserRank('nobody')).resolves.toEqual({
        rank: null,
        score: 0,
      });
    });
  });
});
