import { SiemSecurityEvent, SiemService } from './siem.service';
import {
  SIEM_RETENTION_LIMIT,
  type SiemEventInput,
} from './siem.types';

/**
 * Unit tests for `SiemService` (Task 27.5, Req 27.7).
 *
 * Covers the four guarantees the rest of the platform relies on:
 *   - Every call emits a structured log line with severity-mapped level.
 *   - HIGH/CRITICAL events are forwarded to Sentry with full context.
 *   - Events are buffered per-IP / per-user in Redis with bounded size.
 *   - Sensitive payload keys are redacted before they hit the log /
 *     Redis stream.
 */

interface ListEntry {
  values: string[];
  expiresAt: number | null;
}

class FakeRedis {
  private lists = new Map<string, ListEntry>();

  readonly client = {
    lpush: async (key: string, value: string): Promise<number> => {
      const entry = this.lists.get(key) ?? { values: [], expiresAt: null };
      entry.values.unshift(value);
      this.lists.set(key, entry);
      return entry.values.length;
    },
    ltrim: async (
      key: string,
      start: number,
      stop: number,
    ): Promise<'OK'> => {
      const entry = this.lists.get(key);
      if (!entry) return 'OK';
      entry.values = entry.values.slice(start, stop + 1);
      return 'OK';
    },
    expire: async (key: string, ttl: number): Promise<number> => {
      const entry = this.lists.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ttl * 1000;
      return 1;
    },
    lrange: async (
      key: string,
      start: number,
      stop: number,
    ): Promise<string[]> => {
      const entry = this.lists.get(key);
      if (!entry) return [];
      const end = stop === -1 ? entry.values.length : stop + 1;
      return entry.values.slice(start, end);
    },
  };

  getClient(): typeof this.client {
    return this.client;
  }

  /** Snapshot for assertions. */
  snapshot(key: string): ListEntry | undefined {
    return this.lists.get(key);
  }
}

function buildSentry() {
  return {
    captureException: jest.fn().mockResolvedValue({ ok: true }),
  };
}

function event(over: Partial<SiemEventInput> = {}): SiemEventInput {
  return {
    type: 'security.auth.login.failed',
    severity: 'LOW',
    ip: '203.0.113.5',
    userId: null,
    traceId: 'trace-abc',
    payload: {},
    ...over,
  };
}

// ---------------------------------------------------------------------

describe('SiemService — structured log emission', () => {
  it('logs at the level mapped from severity (LOW → log, MEDIUM → warn, HIGH/CRITICAL → error)', async () => {
    const redis = new FakeRedis();
    const service = new SiemService(redis as never);

    const logSpy = jest
      .spyOn((service as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await service.recordEvent(event({ severity: 'LOW' }));
    await service.recordEvent(event({ severity: 'MEDIUM' }));
    await service.recordEvent(event({ severity: 'HIGH' }));
    await service.recordEvent(event({ severity: 'CRITICAL' }));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(2);

    const lowLine = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(lowLine.event).toBe('security.auth.login.failed');
    expect(lowLine.severity).toBe('LOW');
    expect(lowLine.clientIp).toBe('203.0.113.5');
    expect(lowLine.traceId).toBe('trace-abc');
  });

  it('redacts password / token / authorization / cookie / secret payload keys', async () => {
    const service = new SiemService();
    const logSpy = jest
      .spyOn((service as unknown as { logger: { log: jest.Mock } }).logger, 'log')
      .mockImplementation(() => undefined);

    await service.recordEvent(
      event({
        severity: 'LOW',
        payload: {
          password: 'hunter2',
          token: 'abc.def.ghi',
          Authorization: 'Bearer x',
          Cookie: 'session=...',
          Secret: 'shhh',
          email: 'visible@example.com',
        },
      }),
    );

    const line = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    const payload = line.payload as Record<string, unknown>;
    expect(payload.password).toBe('[REDACTED]');
    expect(payload.token).toBe('[REDACTED]');
    expect(payload.Authorization).toBe('[REDACTED]');
    expect(payload.Cookie).toBe('[REDACTED]');
    expect(payload.Secret).toBe('[REDACTED]');
    expect(payload.email).toBe('visible@example.com');
  });
});

describe('SiemService — Sentry forwarding', () => {
  it('forwards HIGH / CRITICAL events to Sentry with severity tags', async () => {
    const sentry = buildSentry();
    const service = new SiemService(undefined, sentry as never);

    await service.recordEvent(
      event({
        severity: 'HIGH',
        userId: 'user-1',
        payload: { reason: 'bad-password' },
      }),
    );

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = sentry.captureException.mock.calls[0];
    expect(err).toBeInstanceOf(SiemSecurityEvent);
    expect((err as SiemSecurityEvent).siemSeverity).toBe('HIGH');
    expect((err as SiemSecurityEvent).siemType).toBe(
      'security.auth.login.failed',
    );
    expect(ctx).toMatchObject({
      traceId: 'trace-abc',
      userId: 'user-1',
      tags: {
        eventType: 'security.auth.login.failed',
        severity: 'HIGH',
        clientIp: '203.0.113.5',
      },
    });
  });

  it('does NOT forward LOW / MEDIUM events to Sentry', async () => {
    const sentry = buildSentry();
    const service = new SiemService(undefined, sentry as never);

    await service.recordEvent(event({ severity: 'LOW' }));
    await service.recordEvent(event({ severity: 'MEDIUM' }));

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('swallows Sentry transport errors — never throws on the request path', async () => {
    const sentry = {
      captureException: jest
        .fn()
        .mockRejectedValue(new Error('sentry boom')),
    };
    const service = new SiemService(undefined, sentry as never);

    await expect(
      service.recordEvent(event({ severity: 'CRITICAL' })),
    ).resolves.not.toThrow();
  });
});

describe('SiemService — Redis buffering', () => {
  it('LPUSH-es each event onto the per-IP and per-user lists with TTL', async () => {
    const redis = new FakeRedis();
    const lpushSpy = jest.spyOn(redis.client, 'lpush');
    const expireSpy = jest.spyOn(redis.client, 'expire');
    const ltrimSpy = jest.spyOn(redis.client, 'ltrim');
    const service = new SiemService(redis as never);

    await service.recordEvent(
      event({
        userId: 'user-7',
        severity: 'MEDIUM',
      }),
    );

    expect(lpushSpy).toHaveBeenCalledTimes(2);
    expect(lpushSpy.mock.calls.map(([key]) => key)).toEqual([
      'siem:ip:203.0.113.5',
      'siem:user:user-7',
    ]);
    expect(ltrimSpy).toHaveBeenCalledTimes(2);
    expect(expireSpy).toHaveBeenCalledTimes(2);
    expect(expireSpy.mock.calls[0]![1]).toBe(SiemService.RETENTION_TTL_SEC);

    const ipList = redis.snapshot('siem:ip:203.0.113.5');
    expect(ipList?.values).toHaveLength(1);
    const parsed = JSON.parse(ipList!.values[0]!);
    expect(parsed.type).toBe('security.auth.login.failed');
    expect(parsed.userId).toBe('user-7');
    expect(parsed.occurredAt).toEqual(expect.any(Number));
  });

  it('only writes to the IP list when no userId is supplied', async () => {
    const redis = new FakeRedis();
    const lpushSpy = jest.spyOn(redis.client, 'lpush');
    const service = new SiemService(redis as never);

    await service.recordEvent(event({ userId: null }));

    expect(lpushSpy).toHaveBeenCalledTimes(1);
    expect(lpushSpy.mock.calls[0]![0]).toBe('siem:ip:203.0.113.5');
  });

  it('returns the recent window — most recent first, filtered by occurredAt', async () => {
    const redis = new FakeRedis();
    const service = new SiemService(redis as never);

    await service.recordEvent(event({ payload: { idx: 1 } }));
    await service.recordEvent(event({ payload: { idx: 2 } }));
    const history = await service.readRecentForIp('203.0.113.5');

    expect(history.map((e) => e.payload.idx)).toEqual([2, 1]);
  });

  it('continues normally when Redis is unavailable (fail-open)', async () => {
    const service = new SiemService();

    await expect(service.recordEvent(event())).resolves.not.toThrow();
    await expect(service.readRecentForIp('203.0.113.5')).resolves.toEqual([]);
  });
});

describe('SiemService — retention bound', () => {
  it('caps stored entries at SIEM_RETENTION_LIMIT via LTRIM', async () => {
    const redis = new FakeRedis();
    const ltrimSpy = jest.spyOn(redis.client, 'ltrim');
    const service = new SiemService(redis as never);

    await service.recordEvent(event());

    expect(ltrimSpy).toHaveBeenCalledWith(
      'siem:ip:203.0.113.5',
      0,
      SIEM_RETENTION_LIMIT - 1,
    );
  });
});
