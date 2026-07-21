import { RedisService } from '../../../infra/redis/redis.service';
import { BehavioralService } from './behavioral.service';
import type { BehavioralSignals } from './types';

/**
 * Unit tests for `BehavioralService` (Task 27.4, Req 27.6).
 *
 * Coverage:
 *   - `computeScore`: form < 2s + zero mouse moves → high score.
 *   - `computeScore`: implausibly high typing rate fires its signal.
 *   - `computeScore`: realistic human input scores 0 / no reasons.
 *   - `report`: persists the summary and round-trips via `lookup`.
 *   - Redis outage → fail-open, score still computed.
 */

class FakeRedis {
  private kv = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const t = Date.now();
    const cur = this.kv.get(key);
    if (!cur) return null;
    if (cur.expiresAt !== null && cur.expiresAt <= t) {
      this.kv.delete(key);
      return null;
    }
    return cur.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.kv.set(key, {
      value,
      expiresAt: ttl !== undefined ? Date.now() + ttl * 1000 : null,
    });
  }
}

function asRedis(fake: FakeRedis): RedisService {
  return fake as unknown as RedisService;
}

function humanReport(): BehavioralSignals {
  return {
    sessionId: 'sess-1',
    mouseMovements: 27,
    keystrokes: 12,
    dwellTime: 4_500,
    formCompletionMs: 6_200,
  };
}

// =====================================================================
// `computeScore`
// =====================================================================

describe('BehavioralService — computeScore', () => {
  const service = new BehavioralService();

  it('scores a sub-2s form completion with zero mouse moves as a strong signal', () => {
    const { score, reasons } = service.computeScore({
      sessionId: 's',
      mouseMovements: 0,
      keystrokes: 8,
      dwellTime: 100,
      formCompletionMs: 500,
    });

    expect(reasons).toContain('behavior.form_too_fast_no_mouse');
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('produces no signals for realistic human input', () => {
    const { score, reasons } = service.computeScore(humanReport());
    expect(reasons).toEqual([]);
    expect(score).toBe(0);
  });

  it('flags implausibly high sustained typing rate', () => {
    const { score, reasons } = service.computeScore({
      sessionId: 's',
      mouseMovements: 5,
      keystrokes: 500,
      dwellTime: 1_000, // 500 keys / 1s → 500 keys/sec.
      formCompletionMs: 3_000,
    });

    expect(reasons).toContain('behavior.typing_rate_too_high');
    expect(score).toBeGreaterThan(0);
  });

  it('clamps the score into [0, 1] when many signals fire at once', () => {
    const { score } = service.computeScore({
      sessionId: 's',
      mouseMovements: 0,
      keystrokes: 0,
      dwellTime: 0,
      formCompletionMs: 100, // tooFast=true, noMouse=true, noKeystrokes=true, noDwell=true.
    });

    expect(score).toBeLessThanOrEqual(1);
  });
});

// =====================================================================
// `report()` persistence + lookup
// =====================================================================

describe('BehavioralService — report() / lookup()', () => {
  it('stores the sanitised summary in Redis and reads it back', async () => {
    const fake = new FakeRedis();
    const service = new BehavioralService(asRedis(fake));

    const signals: BehavioralSignals = {
      sessionId: 'sess-1',
      mouseMovements: 0,
      keystrokes: 0,
      dwellTime: 0,
      formCompletionMs: 800,
    };
    const { score, reasons } = await service.report(signals);

    expect(score).toBeGreaterThan(0);
    expect(reasons.length).toBeGreaterThan(0);

    const stored = await service.lookup('sess-1');
    expect(stored).not.toBeNull();
    expect(stored!.sessionId).toBe('sess-1');
    expect(stored!.formCompletionMs).toBe(800);
    expect(typeof stored!.receivedAt).toBe('string');
  });

  it('returns null from lookup() when no summary exists', async () => {
    const fake = new FakeRedis();
    const service = new BehavioralService(asRedis(fake));
    expect(await service.lookup('missing')).toBeNull();
  });

  it('survives a Redis outage and still returns a score', async () => {
    const broken = {
      set: jest.fn().mockRejectedValue(new Error('redis down')),
      get: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as RedisService;
    const service = new BehavioralService(broken);

    const { score, reasons } = await service.report({
      sessionId: 'sess-2',
      mouseMovements: 0,
      keystrokes: 0,
      dwellTime: 0,
      formCompletionMs: 500,
    });

    expect(score).toBeGreaterThan(0);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('coerces negative / non-finite numbers to 0 before scoring', async () => {
    const fake = new FakeRedis();
    const service = new BehavioralService(asRedis(fake));

    await service.report({
      sessionId: 'sess-3',
      mouseMovements: Number.NaN as unknown as number,
      keystrokes: -50,
      dwellTime: -10,
      formCompletionMs: 100,
    });

    const stored = await service.lookup('sess-3');
    expect(stored).not.toBeNull();
    expect(stored!.mouseMovements).toBe(0);
    expect(stored!.keystrokes).toBe(0);
    expect(stored!.dwellTime).toBe(0);
  });
});
