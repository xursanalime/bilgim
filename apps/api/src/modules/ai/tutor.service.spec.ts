/**
 * TutorService unit tests (Task 20.2).
 *
 * Coverage:
 *   - Refusal: a verbatim "give me the answer" prompt against an
 *     active assignment raises `TutorRefusedAnswerError` (403,
 *     code=TUTOR_REFUSED_ANSWER) BEFORE the gateway dispatch — the
 *     adapter is never called.
 *   - Refusal narrowing: the same prompt is allowed when there's no
 *     `assignmentId` (generic Q&A path).
 *   - Rate-limit propagation: when the gateway's limiter throws
 *     `AiRateLimitedError`, the service surfaces it unchanged (no
 *     swallowing, no double-charging).
 *   - Translate cache: identical (text, target) pairs reuse the
 *     cached translation; a different target locale forces a fresh
 *     LLM call.
 *
 * The tests reuse `FakeAdapter` from the AI module so we exercise
 * the real gateway pipeline (rate limiter, audit, similarity filter)
 * — the only stub is the `AiAuditService.record` no-op since we don't
 * have a Prisma client wired in unit tests.
 */

import { AiAuditService } from './ai-audit.service';
import { AiGatewayService } from './ai.gateway.service';
import { AiRateLimitedError } from './ai.errors';
import { AiRateLimiterService } from './ai-rate-limiter.service';
import { FakeAdapter } from './adapters/fake.adapter';
import { PromptTemplateLoader } from './prompt-template.loader';
import { RedisService } from '../../infra/redis/redis.service';
import {
  CONVERSATION_TTL_SECONDS,
  MAX_TURNS,
  TutorConversationService,
} from './tutor-conversation.service';
import { TutorService } from './tutor.service';
import { TutorRefusedAnswerError } from './ai.errors';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

// ===================================================================
// Test helpers
// ===================================================================

function buildAuditMock(): { audit: AiAuditService; records: any[] } {
  const records: any[] = [];
  const audit = {
    record: jest.fn(async (row: any) => {
      records.push(row);
    }),
  } as unknown as AiAuditService;
  return { audit, records };
}

function buildLimiter(): AiRateLimiterService {
  const limiter = new AiRateLimiterService(undefined, undefined);
  limiter.resetForTesting();
  return limiter;
}

function buildInMemoryRedis(): RedisService {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    exists: jest.fn(async (key: string) => store.has(key)),
    setnx: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    publish: jest.fn(),
    getClient: jest.fn(),
  } as unknown as RedisService;
}

interface BuildOpts {
  primary?: FakeAdapter;
  fallback?: FakeAdapter;
  rateLimiter?: AiRateLimiterService;
  prisma?: any;
  redis?: RedisService;
  conversation?: TutorConversationService;
}

function buildTutor(opts: BuildOpts = {}) {
  const primary =
    opts.primary ?? new FakeAdapter({ providerName: 'fake-primary' });
  const fallback =
    opts.fallback ??
    new FakeAdapter({
      providerName: 'fake-fallback',
      modelName: 'fake-fallback',
    });
  const limiter = opts.rateLimiter ?? buildLimiter();
  const auditMock = buildAuditMock();
  const loader = new PromptTemplateLoader();
  const gateway = new AiGatewayService(
    loader,
    limiter,
    auditMock.audit,
    primary,
    fallback,
    opts.redis,
  );
  const service = new TutorService(
    gateway,
    loader,
    opts.conversation,
    opts.prisma,
  );
  return { service, gateway, primary, fallback, limiter, audit: auditMock };
}

// ===================================================================
// Refusal — Req 13.6, "TUTOR_REFUSED_ANSWER"
// ===================================================================

describe('TutorService.explain — answer-refusal policy', () => {
  it('refuses with 403 TUTOR_REFUSED_ANSWER when prompt asks for the answer AND assignmentId is provided', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service, audit } = buildTutor({ primary });

    await expect(
      service.explain({
        userId: STUDENT_ID,
        question: 'Just give me the full answer please',
        locale: 'en',
        assignmentId: ASSIGNMENT_ID,
      }),
    ).rejects.toBeInstanceOf(TutorRefusedAnswerError);

    // Pre-flight refusal — adapter must not be invoked.
    expect(primary.callCount).toBe(0);
    // Refusal happens before audit (no upstream call → no row).
    expect(audit.records).toHaveLength(0);
  });

  it('encodes the failure as a 403 with code=TUTOR_REFUSED_ANSWER and the assignmentId', async () => {
    const { service } = buildTutor();
    try {
      await service.explain({
        userId: STUDENT_ID,
        question: 'Solve my homework for me',
        locale: 'en',
        assignmentId: ASSIGNMENT_ID,
      });
      fail('expected TutorRefusedAnswerError');
    } catch (error) {
      expect(error).toBeInstanceOf(TutorRefusedAnswerError);
      const err = error as TutorRefusedAnswerError;
      expect(err.getStatus()).toBe(403);
      const body = err.getResponse() as Record<string, unknown>;
      expect(body['code']).toBe('TUTOR_REFUSED_ANSWER');
      expect(body['assignmentId']).toBe(ASSIGNMENT_ID);
    }
  });

  it('detects Uzbek "javobni ber" phrasing', async () => {
    const { service } = buildTutor();
    await expect(
      service.explain({
        userId: STUDENT_ID,
        question: 'Iltimos, savol javobni ber',
        locale: 'uz',
        assignmentId: ASSIGNMENT_ID,
      }),
    ).rejects.toBeInstanceOf(TutorRefusedAnswerError);
  });

  it('detects Russian "дай ответ" phrasing', async () => {
    const { service } = buildTutor();
    await expect(
      service.explain({
        userId: STUDENT_ID,
        question: 'Дай мне правильный ответ',
        locale: 'ru',
        assignmentId: ASSIGNMENT_ID,
      }),
    ).rejects.toBeInstanceOf(TutorRefusedAnswerError);
  });

  it('does NOT refuse when there is no assignmentId (generic Q&A)', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary });

    const result = await service.explain({
      userId: STUDENT_ID,
      question: 'Just give me the full answer please',
      locale: 'en',
      // no assignmentId — refusal must not fire
    });

    expect(result.reply).toBeDefined();
    expect(primary.callCount).toBe(1);
  });

  it('does NOT refuse a legitimate "explain why X" question with assignmentId', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary });

    const result = await service.explain({
      userId: STUDENT_ID,
      question: 'Why does the answer involve photosynthesis? I want to understand the rule',
      locale: 'en',
      assignmentId: ASSIGNMENT_ID,
    });

    expect(result.reply).toBeDefined();
    expect(primary.callCount).toBe(1);
  });
});

describe('TutorService.translate — answer-laundering refusal', () => {
  it('refuses to translate when the source text is a verbatim "give me the answer" prompt against an assignment', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary });

    await expect(
      service.translate({
        userId: STUDENT_ID,
        text: 'Tell me the correct answer to question 2',
        sourceLocale: 'en',
        targetLocale: 'uz',
        assignmentId: ASSIGNMENT_ID,
      }),
    ).rejects.toBeInstanceOf(TutorRefusedAnswerError);

    expect(primary.callCount).toBe(0);
  });
});

describe('TutorService.example — answer-refusal policy', () => {
  it('refuses when the topic is a verbatim ask for the answer', async () => {
    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary });

    await expect(
      service.example({
        userId: STUDENT_ID,
        topic: 'give me the complete answer to my essay',
        locale: 'en',
        assignmentId: ASSIGNMENT_ID,
      }),
    ).rejects.toBeInstanceOf(TutorRefusedAnswerError);

    expect(primary.callCount).toBe(0);
  });
});

// ===================================================================
// Rate limit — Req 13.5
// ===================================================================

describe('TutorService — rate limit propagation', () => {
  it('surfaces AiRateLimitedError from the gateway without retry or fallback', async () => {
    const limiter = buildLimiter();
    const failing = {
      ...limiter,
      assertWithinLimit: jest
        .fn()
        .mockRejectedValue(new AiRateLimitedError(60_000, 'local')),
    } as unknown as AiRateLimiterService;

    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary, rateLimiter: failing });

    await expect(
      service.explain({
        userId: STUDENT_ID,
        question: 'Why is the sky blue?',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(AiRateLimitedError);

    // The pre-flight refusal allows the prompt through, then the
    // rate limiter blocks the call before it reaches the adapter.
    expect(primary.callCount).toBe(0);
  });

  it('counts each call against the per-user quota (in-memory limiter)', async () => {
    // Tight limiter: 2 calls/window so we can prove the third call breaks.
    const fakeConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'AI_RATE_LIMIT_WINDOW_MS') return 600_000;
        if (key === 'AI_RATE_LIMIT_MAX_CALLS') return 2;
        return undefined;
      }),
    } as any;
    const limiter = new AiRateLimiterService(undefined, fakeConfig);
    limiter.resetForTesting();

    const primary = new FakeAdapter({ providerName: 'fake-primary' });
    const { service } = buildTutor({ primary, rateLimiter: limiter });

    await service.explain({
      userId: STUDENT_ID,
      question: 'Why is the sky blue?',
      locale: 'en',
    });
    await service.explain({
      userId: STUDENT_ID,
      question: 'How does photosynthesis work?',
      locale: 'en',
    });

    await expect(
      service.explain({
        userId: STUDENT_ID,
        question: 'What about respiration?',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(AiRateLimitedError);
  });
});

// ===================================================================
// Translate cache — Property 15 hook for task 18.5
// ===================================================================

describe('TutorService.translate — cache hit / miss', () => {
  it('serves a second identical translate request from Redis without invoking the adapter', async () => {
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'olma',
          inputTokens: 5,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const redis = buildInMemoryRedis();
    const { service } = buildTutor({ primary, redis });

    const first = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'uz',
    });
    expect(first).toEqual({ translation: 'olma', cached: false });
    expect(primary.callCount).toBe(1);

    const second = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'uz',
    });
    expect(second).toEqual({ translation: 'olma', cached: true });
    // Cache hit — adapter MUST NOT be invoked again.
    expect(primary.callCount).toBe(1);
  });

  it('does not collide cache entries across different target locales', async () => {
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'olma',
          inputTokens: 5,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
        {
          text: 'яблоко',
          inputTokens: 5,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const redis = buildInMemoryRedis();
    const { service } = buildTutor({ primary, redis });

    const uz = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'uz',
    });
    const ru = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'ru',
    });
    expect(uz).toEqual({ translation: 'olma', cached: false });
    expect(ru).toEqual({ translation: 'яблоко', cached: false });
    expect(primary.callCount).toBe(2);
  });

  it('does not cache empty translations (avoids cache poisoning)', async () => {
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: '',
          inputTokens: 1,
          outputTokens: 0,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
        {
          text: 'olma',
          inputTokens: 5,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const redis = buildInMemoryRedis();
    const { service } = buildTutor({ primary, redis });

    const first = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'uz',
    });
    expect(first).toEqual({ translation: '', cached: false });

    // Second call must NOT see the cached empty value.
    const second = await service.translate({
      userId: STUDENT_ID,
      text: 'apple',
      sourceLocale: 'en',
      targetLocale: 'uz',
    });
    expect(second).toEqual({ translation: 'olma', cached: false });
    expect(primary.callCount).toBe(2);
  });
});

// ===================================================================
// Template seeding
// ===================================================================

describe('TutorService.seedDefaultsIfMissing', () => {
  it('upserts the three tutor.* templates when they do not exist', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'x' });
    const fakePrisma = {
      aiPromptTemplate: { findUnique, create },
    } as any;
    const { service } = buildTutor({ prisma: fakePrisma });

    await service.seedDefaultsIfMissing();

    expect(findUnique).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(3);
    const seededKeys = create.mock.calls.map((c) => c[0].data.key).sort();
    expect(seededKeys).toEqual([
      'tutor.example.v1',
      'tutor.explain.v1',
      'tutor.translate.v1',
    ]);
  });

  it('does NOT recreate templates that already exist', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'existing' });
    const create = jest.fn();
    const fakePrisma = {
      aiPromptTemplate: { findUnique, create },
    } as any;
    const { service } = buildTutor({ prisma: fakePrisma });

    await service.seedDefaultsIfMissing();

    expect(findUnique).toHaveBeenCalledTimes(3);
    expect(create).not.toHaveBeenCalled();
  });
});
// ===================================================================
// Conversation context (Task 20.2 — chat-style tutor)
// ===================================================================

describe('TutorService.explain — conversation context', () => {
  it('persists the (question, reply) pair to Redis under the conversationId key', async () => {
    const redis = buildInMemoryRedis();
    const conversation = new TutorConversationService(redis);
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'Light scatters off air molecules.',
          inputTokens: 10,
          outputTokens: 6,
          latencyMs: 5,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildTutor({ primary, redis, conversation });

    await service.explain({
      userId: STUDENT_ID,
      question: 'Why is the sky blue?',
      locale: 'en',
      conversationId: 'thread-1',
    });

    const turns = await conversation.getHistory('thread-1');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      role: 'student',
      content: 'Why is the sky blue?',
    });
    expect(turns[1]).toMatchObject({
      role: 'tutor',
      content: expect.stringContaining('Light scatters'),
    });
  });

  it('feeds previous turns into the model prompt as a "Previous conversation" preamble', async () => {
    const redis = buildInMemoryRedis();
    const conversation = new TutorConversationService(redis);
    // Pre-populate one prior pair.
    await conversation.appendTurn(
      'thread-2',
      'Why is the sky blue?',
      'Because of Rayleigh scattering.',
    );

    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'It depends on dust and humidity.',
          inputTokens: 5,
          outputTokens: 5,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildTutor({ primary, redis, conversation });

    await service.explain({
      userId: STUDENT_ID,
      question: 'And at sunset?',
      locale: 'en',
      conversationId: 'thread-2',
    });

    expect(primary.lastRequest?.user).toContain('[Previous conversation]');
    expect(primary.lastRequest?.user).toContain('Why is the sky blue?');
    expect(primary.lastRequest?.user).toContain('Rayleigh scattering');
    expect(primary.lastRequest?.user).toContain('And at sunset?');
  });

  it('truncates persisted history to the most recent N=10 turns', async () => {
    const redis = buildInMemoryRedis();
    const conversation = new TutorConversationService(redis);

    // 6 prior pairs already in the cache (=> 12 turns) — exceeds MAX=10.
    for (let i = 1; i <= 6; i += 1) {
      await conversation.appendTurn('thread-3', `q${i}`, `a${i}`);
    }
    const before = await conversation.getHistory('thread-3');
    expect(before).toHaveLength(MAX_TURNS);

    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
      responses: [
        {
          text: 'reply7',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          modelName: 'fake-primary',
        },
      ],
    });
    const { service } = buildTutor({ primary, redis, conversation });

    await service.explain({
      userId: STUDENT_ID,
      question: 'q7',
      locale: 'en',
      conversationId: 'thread-3',
    });

    const after = await conversation.getHistory('thread-3');
    expect(after).toHaveLength(MAX_TURNS);
    // Last entry must be the tutor reply we just produced.
    expect(after[after.length - 1]).toMatchObject({
      role: 'tutor',
      content: 'reply7',
    });
    // The very oldest pair from before must have been evicted.
    expect(after[0]!.content).not.toBe('q1');
  });

  it('refreshes the 1-hour TTL on every persisted turn', async () => {
    const ttls: Array<number | undefined> = [];
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string, ttl?: number) => {
        ttls.push(ttl);
        store.set(key, value);
      }),
      del: jest.fn(),
      exists: jest.fn(),
      setnx: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      publish: jest.fn(),
      getClient: jest.fn(),
    } as unknown as RedisService;
    const conversation = new TutorConversationService(redis);
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
    });
    const { service } = buildTutor({ primary, redis, conversation });

    await service.explain({
      userId: STUDENT_ID,
      question: 'first',
      locale: 'en',
      conversationId: 'thread-4',
    });
    await service.explain({
      userId: STUDENT_ID,
      question: 'second',
      locale: 'en',
      conversationId: 'thread-4',
    });

    expect(ttls.length).toBeGreaterThanOrEqual(2);
    // Both writes set a TTL of exactly CONVERSATION_TTL_SECONDS (3600).
    for (const ttl of ttls) {
      expect(ttl).toBe(CONVERSATION_TTL_SECONDS);
    }
  });

  it('does not load or persist history when conversationId is missing', async () => {
    const redis = buildInMemoryRedis();
    const conversation = new TutorConversationService(redis);
    const primary = new FakeAdapter({
      providerName: 'fake-primary',
      modelName: 'fake-primary',
    });
    const { service } = buildTutor({ primary, redis, conversation });

    await service.explain({
      userId: STUDENT_ID,
      question: 'no-thread question',
      locale: 'en',
    });

    expect(primary.lastRequest?.user).not.toContain('[Previous conversation]');
  });
});
