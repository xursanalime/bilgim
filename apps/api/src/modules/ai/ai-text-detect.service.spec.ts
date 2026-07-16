/**
 * Unit tests for AiTextDetectService (Task 20.3).
 *
 * The tests construct the service against a stub `AiGateway` so they
 * exercise the `flagged` decision logic + threshold handling without
 * any network calls. Cache behaviour is exercised against a tiny
 * in-memory `RedisService` stand-in so we can assert hit / miss /
 * TTL contracts without spinning up an actual Redis container.
 */

import type { AiGateway } from './ai.types';
import {
  AI_TEXT_DETECT_CACHE_PREFIX,
  AI_TEXT_DETECT_CACHE_TTL_SECONDS,
  AiTextDetectService,
} from './ai-text-detect.service';
import { AI_LIKELIHOOD_FLAG_THRESHOLD } from './ai.constants';
import { RedisService } from '../../infra/redis/redis.service';

function buildGatewayStub(): jest.Mocked<AiGateway> {
  return {
    tutor: jest.fn(),
    tutorExplain: jest.fn(),
    tutorTranslate: jest.fn(),
    tutorExample: jest.fn(),
    translateWord: jest.fn(),
    translateSentence: jest.fn(),
    precheckWritingSubmission: jest.fn(),
    detectAiText: jest.fn(),
    suggestRubric: jest.fn(),
  } as unknown as jest.Mocked<AiGateway>;
}

/**
 * In-memory `RedisService` stand-in. Records `set` arguments so the
 * caller can assert TTLs were applied; `get` reads from the same map.
 * Failure injection is exposed via `failGet`/`failSet` so the
 * fail-open contract can be exercised explicitly.
 */
function buildInMemoryRedis(opts: { failGet?: boolean; failSet?: boolean } = {}) {
  const store = new Map<string, string>();
  const setCalls: Array<{ key: string; value: string; ttl?: number }> = [];

  const get = jest.fn(async (key: string) => {
    if (opts.failGet) throw new Error('redis down');
    return store.get(key) ?? null;
  });

  const set = jest.fn(
    async (key: string, value: string, ttlSeconds?: number) => {
      if (opts.failSet) throw new Error('redis down');
      setCalls.push({ key, value, ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}) });
      store.set(key, value);
    },
  );

  const del = jest.fn(async (key: string) => {
    return store.delete(key) ? 1 : 0;
  });

  return {
    redis: {
      get,
      set,
      del,
      exists: jest.fn(),
      setnx: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      publish: jest.fn(),
      getClient: jest.fn(),
      onModuleDestroy: jest.fn(),
    } as unknown as RedisService,
    store,
    setCalls,
  };
}

describe('AiTextDetectService.detect', () => {
  it('forwards text to the gateway and reports flagged=true above the default threshold', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.85,
      signals: ['perplexity-low'],
    });
    const service = new AiTextDetectService(gateway);

    const result = await service.detect({
      userId: 'user-1',
      text: 'A long suspicious essay about AI.',
    });

    expect(gateway.detectAiText).toHaveBeenCalledWith({
      userId: 'user-1',
      text: 'A long suspicious essay about AI.',
    });
    expect(result.likelihood).toBeCloseTo(0.85);
    expect(result.flagged).toBe(true);
    expect(result.threshold).toBe(AI_LIKELIHOOD_FLAG_THRESHOLD);
    expect(result.signals).toEqual(['perplexity-low']);
    expect(result.cached).toBe(false);
  });

  it('reports flagged=false when likelihood is below the threshold', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.4,
      signals: [],
    });
    const service = new AiTextDetectService(gateway);

    const result = await service.detect({ text: 'human text' });
    expect(result.flagged).toBe(false);
  });

  it('honours the custom threshold parameter', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.6,
      signals: [],
    });
    const service = new AiTextDetectService(gateway);

    // 0.6 >= 0.5 → flagged.
    const flagged = await service.detect({ text: 'x', threshold: 0.5 });
    expect(flagged.flagged).toBe(true);
    expect(flagged.threshold).toBe(0.5);

    // 0.6 < 0.75 → not flagged. Use a different text body so the
    // earlier cache write doesn't short-circuit the gateway call.
    const notFlagged = await service.detect({ text: 'y', threshold: 0.75 });
    expect(notFlagged.flagged).toBe(false);
  });

  it('clamps the gateway likelihood into [0, 1] before computing flagged', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 2,
      signals: [],
    });
    const service = new AiTextDetectService(gateway);

    const result = await service.detect({ text: 'x' });
    expect(result.likelihood).toBe(1);
    expect(result.flagged).toBe(true);
  });

  it('skips the gateway and returns 0 for empty / whitespace-only text', async () => {
    const gateway = buildGatewayStub();
    const service = new AiTextDetectService(gateway);

    for (const text of ['', '   ', '\n\t']) {
      const result = await service.detect({ text });
      expect(result.likelihood).toBe(0);
      expect(result.flagged).toBe(false);
      expect(result.signals).toContain('empty-text');
    }
    expect(gateway.detectAiText).not.toHaveBeenCalled();
  });

  it('degrades to flagged=false when the gateway is not wired', async () => {
    const service = new AiTextDetectService();

    const result = await service.detect({ text: 'classify me' });
    expect(result.likelihood).toBe(0);
    expect(result.flagged).toBe(false);
    expect(result.signals).toContain('gateway-unavailable');
  });

  it('treats out-of-range custom threshold values by clamping them safely', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({ likelihood: 0.5, signals: [] });
    const service = new AiTextDetectService(gateway);

    // -1 → clamped to 0 → 0.5 >= 0 is true.
    const negative = await service.detect({ text: 'x', threshold: -1 });
    expect(negative.threshold).toBe(0);
    expect(negative.flagged).toBe(true);

    // 5 → clamped to 1 → 0.5 < 1 is false. Use a fresh text body so
    // the cache from the previous call doesn't return early.
    const tooHigh = await service.detect({ text: 'z', threshold: 5 });
    expect(tooHigh.threshold).toBe(1);
    expect(tooHigh.flagged).toBe(false);
  });

  it('propagates gateway errors so the caller can decide how to handle them', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockRejectedValue(new Error('upstream 429'));
    const service = new AiTextDetectService(gateway);

    await expect(service.detect({ text: 'classify' })).rejects.toThrow(
      /upstream 429/,
    );
  });
});

// =====================================================================
// Cache hit / miss path (Task 20.3 — `ai:text-detect:{sha256}` 24h TTL)
// =====================================================================

describe('AiTextDetectService.detect — Redis cache (Task 20.3)', () => {
  it('writes the gateway result to Redis with a 24h TTL on cache miss', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.42,
      signals: ['heuristic:low-perplexity'],
    });
    const { redis, setCalls } = buildInMemoryRedis();
    const service = new AiTextDetectService(gateway, redis);

    const result = await service.detect({ text: 'first call', userId: 'u1' });

    expect(result.cached).toBe(false);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(1);
    const write = setCalls[0]!;
    expect(write.key.startsWith(AI_TEXT_DETECT_CACHE_PREFIX)).toBe(true);
    expect(write.ttl).toBe(AI_TEXT_DETECT_CACHE_TTL_SECONDS);
    const payload = JSON.parse(write.value);
    expect(payload).toEqual({
      likelihood: 0.42,
      signals: ['heuristic:low-perplexity'],
    });
  });

  it('serves a second identical detect request from Redis without invoking the gateway', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.65,
      signals: ['cached-signal'],
    });
    const { redis } = buildInMemoryRedis();
    const service = new AiTextDetectService(gateway, redis);

    const first = await service.detect({ text: 'identical body', userId: 'u1' });
    const second = await service.detect({ text: 'identical body', userId: 'u2' });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.likelihood).toBeCloseTo(0.65);
    expect(second.signals).toEqual(['cached-signal']);
    // Cache hit MUST NOT trigger a second upstream call.
    expect(gateway.detectAiText).toHaveBeenCalledTimes(1);
  });

  it('treats trivial whitespace differences as the same cache entry', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.55,
      signals: [],
    });
    const { redis } = buildInMemoryRedis();
    const service = new AiTextDetectService(gateway, redis);

    await service.detect({ text: 'hello world' });
    const second = await service.detect({ text: '  hello world  \n' });

    expect(second.cached).toBe(true);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(1);
  });

  it('recomputes flagged against the caller threshold on cache hit', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.6,
      signals: [],
    });
    const { redis } = buildInMemoryRedis();
    const service = new AiTextDetectService(gateway, redis);

    // Prime the cache.
    await service.detect({ text: 'same text', threshold: 0.5 });

    // Cache hit but a different threshold — flagged must be recomputed.
    const lower = await service.detect({ text: 'same text', threshold: 0.5 });
    const higher = await service.detect({ text: 'same text', threshold: 0.9 });

    expect(lower.cached).toBe(true);
    expect(lower.flagged).toBe(true);
    expect(higher.cached).toBe(true);
    expect(higher.flagged).toBe(false);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(1);
  });

  it('skipCache=true forces a fresh gateway call AND repopulates the cache', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText
      .mockResolvedValueOnce({ likelihood: 0.3, signals: [] })
      .mockResolvedValueOnce({ likelihood: 0.7, signals: ['fresh'] });
    const { redis, store } = buildInMemoryRedis();
    const service = new AiTextDetectService(gateway, redis);

    await service.detect({ text: 'doc', userId: 'u1' });
    const fresh = await service.detect({
      text: 'doc',
      userId: 'u1',
      skipCache: true,
    });

    expect(fresh.cached).toBe(false);
    expect(fresh.likelihood).toBeCloseTo(0.7);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(2);
    // The fresh result overwrote the cache.
    expect(store.size).toBe(1);
    const [, raw] = [...store.entries()][0]!;
    expect(JSON.parse(raw)).toEqual({
      likelihood: 0.7,
      signals: ['fresh'],
    });
  });

  it('fails open when Redis read throws — falls through to the gateway', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.2,
      signals: [],
    });
    const { redis } = buildInMemoryRedis({ failGet: true });
    const service = new AiTextDetectService(gateway, redis);

    const result = await service.detect({ text: 'text', userId: 'u1' });
    expect(result.cached).toBe(false);
    expect(result.likelihood).toBeCloseTo(0.2);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(1);
  });

  it('fails open when Redis write throws — still returns the gateway result', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.5,
      signals: [],
    });
    const { redis } = buildInMemoryRedis({ failSet: true });
    const service = new AiTextDetectService(gateway, redis);

    const result = await service.detect({ text: 'text', userId: 'u1' });
    expect(result.cached).toBe(false);
    expect(result.likelihood).toBeCloseTo(0.5);
  });

  it('treats malformed cache entries as a miss (defensive parsing)', async () => {
    const gateway = buildGatewayStub();
    gateway.detectAiText.mockResolvedValue({
      likelihood: 0.4,
      signals: ['recovered'],
    });
    const { redis, store } = buildInMemoryRedis();
    // Pre-seed the cache with garbage that doesn't match the schema.
    const text = 'corrupt entry';
    const service = new AiTextDetectService(gateway, redis);
    // Compute the same cache key the service will use.
    const probe = await service.detect({ text, skipCache: true });
    expect(probe).toBeDefined();
    const [key] = [...store.keys()];
    expect(key).toBeDefined();
    store.set(key!, '{"not":"valid"}');

    const fallthrough = await service.detect({ text });
    expect(fallthrough.cached).toBe(false);
    expect(fallthrough.likelihood).toBeCloseTo(0.4);
    expect(gateway.detectAiText).toHaveBeenCalledTimes(2);
  });
});
