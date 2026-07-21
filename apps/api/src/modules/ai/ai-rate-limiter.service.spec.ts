import { AiRateLimiterService } from './ai-rate-limiter.service';
import { AiRateLimitedError } from './ai.errors';

const fakeConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'AI_RATE_LIMIT_WINDOW_MS') return 600_000;
    if (key === 'AI_RATE_LIMIT_MAX_CALLS') return 3;
    return undefined;
  }),
} as any;

describe('AiRateLimiterService (in-memory fallback)', () => {
  let limiter: AiRateLimiterService;

  beforeEach(() => {
    limiter = new AiRateLimiterService(undefined, fakeConfig);
    limiter.resetForTesting();
  });

  it('allows the first N calls and counts down `remaining`', async () => {
    const r1 = await limiter.check('user:1');
    const r2 = await limiter.check('user:1');
    const r3 = await limiter.check('user:1');
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
    expect(r3.remaining).toBe(0);
    expect(r1.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });

  it('rejects calls past the limit and reports retryAfterMs > 0', async () => {
    await limiter.check('user:2');
    await limiter.check('user:2');
    await limiter.check('user:2');
    const breached = await limiter.check('user:2');
    expect(breached.allowed).toBe(false);
    expect(breached.retryAfterMs).toBeGreaterThan(0);
  });

  it('throws AiRateLimitedError from assertWithinLimit on breach', async () => {
    await limiter.assertWithinLimit('user:3');
    await limiter.assertWithinLimit('user:3');
    await limiter.assertWithinLimit('user:3');
    await expect(limiter.assertWithinLimit('user:3')).rejects.toBeInstanceOf(
      AiRateLimitedError,
    );
  });

  it('skips the check when subject is null/undefined (server-side traffic)', async () => {
    await expect(limiter.assertWithinLimit(null)).resolves.toBeUndefined();
    await expect(limiter.assertWithinLimit(undefined)).resolves.toBeUndefined();
    await expect(limiter.assertWithinLimit('')).resolves.toBeUndefined();
  });

  it('isolates buckets across subjects', async () => {
    await limiter.assertWithinLimit('user:a');
    await limiter.assertWithinLimit('user:a');
    await limiter.assertWithinLimit('user:a');
    // subject `a` is at the limit; `b` should still be wide open
    const ok = await limiter.check('user:b');
    expect(ok.allowed).toBe(true);
    expect(ok.remaining).toBe(2);
  });
});

describe('AiRateLimiterService (Redis path, fail-open)', () => {
  it('allows the call when Redis throws — does not block traffic', async () => {
    const failingClient = {
      multi: () => ({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('redis down')),
      }),
      expire: jest.fn(),
    };
    const fakeRedis = { getClient: () => failingClient } as any;
    const limiter = new AiRateLimiterService(fakeRedis, fakeConfig);

    const r = await limiter.check('user:x');
    expect(r.allowed).toBe(true);
    expect(r.retryAfterMs).toBe(0);
  });
});
