/**
 * TutorConversationService unit tests (Task 20.2 — chat-style tutor).
 *
 * Coverage:
 *   - getHistory returns [] when no Redis is wired or no key exists.
 *   - appendTurn persists both turns and refreshes a 1-hour TTL.
 *   - FIFO truncation: at most MAX_TURNS entries survive across many
 *     appends.
 *   - Empty turn pairs are no-ops (no cache write).
 *   - Corrupt cache values are treated as a miss (no throw).
 *   - renderForPrompt produces the deterministic preamble used by the
 *     tutor service.
 */

import { RedisService } from '../../infra/redis/redis.service';
import {
  CONVERSATION_TTL_SECONDS,
  MAX_TURNS,
  TutorConversationService,
} from './tutor-conversation.service';

interface RecordedSet {
  key: string;
  value: string;
  ttl: number | undefined;
}

function buildRedisStub(): {
  redis: RedisService;
  store: Map<string, string>;
  sets: RecordedSet[];
} {
  const store = new Map<string, string>();
  const sets: RecordedSet[] = [];
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ttl?: number) => {
      sets.push({ key, value, ttl });
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
  return { redis, store, sets };
}

describe('TutorConversationService.getHistory', () => {
  it('returns an empty array when Redis is not wired', async () => {
    const svc = new TutorConversationService(undefined);
    expect(await svc.getHistory('any-id')).toEqual([]);
  });

  it('returns an empty array when conversationId is missing', async () => {
    const { redis } = buildRedisStub();
    const svc = new TutorConversationService(redis);
    expect(await svc.getHistory(undefined)).toEqual([]);
    expect(await svc.getHistory('')).toEqual([]);
  });

  it('returns an empty array on cache miss', async () => {
    const { redis } = buildRedisStub();
    const svc = new TutorConversationService(redis);
    expect(await svc.getHistory('conv-1')).toEqual([]);
  });

  it('returns an empty array when stored value cannot be parsed', async () => {
    const { redis, store } = buildRedisStub();
    store.set('ai:tutor:conversation:conv-1', '{not json');
    const svc = new TutorConversationService(redis);
    expect(await svc.getHistory('conv-1')).toEqual([]);
  });

  it('returns persisted turns when present', async () => {
    const { redis, store } = buildRedisStub();
    store.set(
      'ai:tutor:conversation:conv-1',
      JSON.stringify({
        turns: [
          { role: 'student', content: 'hi', at: '2025-01-01T00:00:00.000Z' },
          { role: 'tutor', content: 'hello', at: '2025-01-01T00:00:01.000Z' },
        ],
        updatedAt: '2025-01-01T00:00:01.000Z',
      }),
    );
    const svc = new TutorConversationService(redis);
    const turns = await svc.getHistory('conv-1');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'student', content: 'hi' });
    expect(turns[1]).toMatchObject({ role: 'tutor', content: 'hello' });
  });
});

describe('TutorConversationService.appendTurn', () => {
  it('writes both turns under the conversation key with a 1-hour TTL', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);

    await svc.appendTurn('conv-1', 'why?', 'because.');

    expect(sets).toHaveLength(1);
    const first = sets[0]!;
    expect(first.key).toBe('ai:tutor:conversation:conv-1');
    expect(first.ttl).toBe(CONVERSATION_TTL_SECONDS);

    const env = JSON.parse(first.value);
    expect(env.turns).toHaveLength(2);
    expect(env.turns[0]).toMatchObject({ role: 'student', content: 'why?' });
    expect(env.turns[1]).toMatchObject({ role: 'tutor', content: 'because.' });
  });

  it('refreshes the 1-hour TTL on every write', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);
    await svc.appendTurn('conv-1', 'q1', 'a1');
    await svc.appendTurn('conv-1', 'q2', 'a2');
    await svc.appendTurn('conv-1', 'q3', 'a3');
    expect(sets).toHaveLength(3);
    for (const op of sets) {
      expect(op.ttl).toBe(CONVERSATION_TTL_SECONDS);
    }
  });

  it('truncates to MAX_TURNS entries (FIFO oldest-first)', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);

    // 6 pairs → 12 turns → must truncate to MAX_TURNS=10.
    for (let i = 1; i <= 6; i += 1) {
      await svc.appendTurn('conv-1', `q${i}`, `a${i}`);
    }

    const last = sets[sets.length - 1]!;
    const env = JSON.parse(last.value);
    expect(env.turns).toHaveLength(MAX_TURNS);
    // Oldest pair (q1, a1) must have been evicted.
    expect(env.turns[0].content).not.toBe('q1');
    // The most recent pair must be at the tail.
    expect(env.turns[env.turns.length - 2].content).toBe('q6');
    expect(env.turns[env.turns.length - 1].content).toBe('a6');
  });

  it('is a no-op when both contents are empty', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);
    await svc.appendTurn('conv-1', '', '   ');
    expect(sets).toHaveLength(0);
  });

  it('is a no-op when conversationId is missing', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);
    await svc.appendTurn(undefined, 'q', 'a');
    await svc.appendTurn('', 'q', 'a');
    expect(sets).toHaveLength(0);
  });

  it('clamps long contents to bound the prompt size', async () => {
    const { redis, sets } = buildRedisStub();
    const svc = new TutorConversationService(redis);

    const huge = 'x'.repeat(10_000);
    await svc.appendTurn('conv-1', huge, 'a');

    const env = JSON.parse(sets[0]!.value);
    expect(env.turns[0].content.length).toBeLessThanOrEqual(4_000);
  });
});

describe('TutorConversationService.renderForPrompt', () => {
  it('returns an empty string for empty input', () => {
    const svc = new TutorConversationService(undefined);
    expect(svc.renderForPrompt([])).toBe('');
  });

  it('renders deterministic Student/Tutor lines with a header', () => {
    const svc = new TutorConversationService(undefined);
    const out = svc.renderForPrompt([
      { role: 'student', content: 'why is the sky blue?', at: 't1' },
      { role: 'tutor', content: 'rayleigh scattering', at: 't2' },
    ]);
    expect(out).toContain('[Previous conversation]');
    expect(out).toContain('Student: why is the sky blue?');
    expect(out).toContain('Tutor: rayleigh scattering');
  });
});
