import { CorrelationEngine } from './correlation.engine';
import { SiemService } from './siem.service';
import type { SiemEventRecord } from './siem.types';

/**
 * Unit tests for `CorrelationEngine` (Task 27.5, Req 27.7).
 *
 * Each rule is exercised against a synthetic event sequence that
 * just barely meets the threshold, plus a mirror case that stays
 * one event below to confirm the rule doesn't fire prematurely.
 */

function record(
  over: Partial<SiemEventRecord> & Pick<SiemEventRecord, 'type'>,
): SiemEventRecord {
  return {
    type: over.type,
    severity: over.severity ?? 'LOW',
    userId: over.userId ?? null,
    ip: over.ip ?? '203.0.113.10',
    traceId: over.traceId ?? null,
    occurredAt: over.occurredAt ?? Date.now(),
    payload: over.payload ?? {},
  };
}

interface FakeSiemBuilder {
  ipWindow: SiemEventRecord[];
  userWindow: SiemEventRecord[];
  emitted: Array<{ type: string; severity: string; payload: unknown }>;
}

function buildSiem(): {
  fake: FakeSiemBuilder;
  service: SiemService;
} {
  const fake: FakeSiemBuilder = {
    ipWindow: [],
    userWindow: [],
    emitted: [],
  };

  const service = {
    readRecentForIp: jest
      .fn()
      .mockImplementation(async () => [...fake.ipWindow]),
    readRecentForUser: jest
      .fn()
      .mockImplementation(async () => [...fake.userWindow]),
    recordEvent: jest.fn().mockImplementation(async (input) => {
      fake.emitted.push({
        type: input.type,
        severity: input.severity,
        payload: input.payload,
      });
    }),
  } as unknown as SiemService;

  return { fake, service };
}

// ---------------------------------------------------------------------

describe('CorrelationEngine — credential-stuffing-burst rule', () => {
  it('fires when 5+ failed logins from same IP across distinct accounts', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const now = Date.now();

    fake.ipWindow = Array.from({ length: 5 }, (_, i) =>
      record({
        type: 'security.auth.login.failed',
        ip: '198.51.100.7',
        occurredAt: now - i * 1000,
        payload: { email: `victim${i}@example.com` },
      }),
    );

    const trigger = record({
      type: 'security.auth.login.failed',
      ip: '198.51.100.7',
      payload: { email: 'victim0@example.com' },
    });
    fake.ipWindow.push(trigger);

    await engine.evaluate(trigger);

    const match = fake.emitted.find(
      (e) => e.type === 'security.correlation.credential_stuffing',
    );
    expect(match).toBeDefined();
    expect(match!.severity).toBe('HIGH');
  });

  it('does not fire when same email is repeated 5 times (no distinct accounts)', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const now = Date.now();

    fake.ipWindow = Array.from({ length: 6 }, (_, i) =>
      record({
        type: 'security.auth.login.failed',
        ip: '198.51.100.8',
        occurredAt: now - i * 1000,
        payload: { email: 'sameuser@example.com' },
      }),
    );

    await engine.evaluate(fake.ipWindow[0]!);
    expect(
      fake.emitted.find(
        (e) => e.type === 'security.correlation.credential_stuffing',
      ),
    ).toBeUndefined();
  });

  it('does not fire below the 5-failure threshold', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const now = Date.now();

    fake.ipWindow = Array.from({ length: 4 }, (_, i) =>
      record({
        type: 'security.auth.login.failed',
        occurredAt: now - i * 1000,
        payload: { email: `v${i}@example.com` },
      }),
    );

    await engine.evaluate(fake.ipWindow[0]!);
    expect(fake.emitted).toHaveLength(0);
  });
});

describe('CorrelationEngine — session-hijack-suspect rule', () => {
  it('fires when a single user has both a failed login and a fresh IP within 5 min', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const now = Date.now();

    fake.userWindow = [
      record({
        type: 'security.auth.login.failed',
        userId: 'user-1',
        ip: '203.0.113.1',
        occurredAt: now - 60_000,
      }),
      record({
        type: 'security.auth.session.ip_changed',
        userId: 'user-1',
        ip: '203.0.113.99',
        occurredAt: now - 30_000,
      }),
    ];

    const trigger = record({
      type: 'security.auth.session.ip_changed',
      userId: 'user-1',
      ip: '203.0.113.99',
      occurredAt: now,
    });

    await engine.evaluate(trigger);

    const match = fake.emitted.find(
      (e) => e.type === 'security.correlation.session_hijack_suspect',
    );
    expect(match).toBeDefined();
    expect(match!.severity).toBe('HIGH');
  });

  it('does not fire on anonymous events (no userId)', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    const trigger = record({
      type: 'security.auth.login.failed',
      userId: null,
    });

    await engine.evaluate(trigger);

    expect(
      fake.emitted.find(
        (e) => e.type === 'security.correlation.session_hijack_suspect',
      ),
    ).toBeUndefined();
  });

  it('does not fire when only a failure (no IP change) is in the window', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const now = Date.now();

    fake.userWindow = [
      record({
        type: 'security.auth.login.failed',
        userId: 'user-1',
        ip: '203.0.113.1',
        occurredAt: now - 30_000,
      }),
    ];

    const trigger = fake.userWindow[0]!;
    fake.userWindow.push(trigger);
    await engine.evaluate(trigger);

    expect(
      fake.emitted.find(
        (e) => e.type === 'security.correlation.session_hijack_suspect',
      ),
    ).toBeUndefined();
  });
});

describe('CorrelationEngine — coordinated-attack rule', () => {
  it('fires CRITICAL when WAF + bot + auth failure share the same IP window', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    fake.ipWindow = [
      record({ type: 'security.waf.block', ip: '198.51.100.20' }),
      record({ type: 'security.bot.detected', ip: '198.51.100.20' }),
      record({
        type: 'security.auth.login.failed',
        ip: '198.51.100.20',
        payload: { email: 'a@example.com' },
      }),
    ];

    const trigger = fake.ipWindow[2]!;
    await engine.evaluate(trigger);

    const match = fake.emitted.find(
      (e) => e.type === 'security.correlation.coordinated_attack',
    );
    expect(match).toBeDefined();
    expect(match!.severity).toBe('CRITICAL');
  });

  it('does not fire when only WAF + auth failure are present (no bot signal)', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    fake.ipWindow = [
      record({ type: 'security.waf.block', ip: '198.51.100.21' }),
      record({
        type: 'security.auth.login.failed',
        ip: '198.51.100.21',
      }),
    ];

    await engine.evaluate(fake.ipWindow[1]!);

    expect(
      fake.emitted.find(
        (e) => e.type === 'security.correlation.coordinated_attack',
      ),
    ).toBeUndefined();
  });
});

describe('CorrelationEngine — automated-scanner rule', () => {
  it('fires when an IP hits 10+ honeypot endpoints', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);
    const paths = [
      '/admin-backup',
      '/admin-backup.zip',
      '/wp-login.php',
      '/wp-admin',
      '/wp-content/uploads',
      '/.env',
      '/.git/config',
      '/phpmyadmin',
      '/xmlrpc.php',
      '/admin-backup.tar.gz',
    ];
    fake.ipWindow = paths.map((path, i) =>
      record({
        type: 'security.honeypot.hit',
        ip: '198.51.100.30',
        occurredAt: Date.now() - i * 1000,
        payload: { path },
      }),
    );

    await engine.evaluate(fake.ipWindow[0]!);

    const match = fake.emitted.find(
      (e) => e.type === 'security.correlation.automated_scanner',
    );
    expect(match).toBeDefined();
    expect(
      (match!.payload as Record<string, unknown>).distinctPaths,
    ).toBe(10);
  });

  it('does not fire below the 10-hit threshold', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    fake.ipWindow = Array.from({ length: 5 }, (_, i) =>
      record({
        type: 'security.honeypot.hit',
        payload: { path: `/p${i}` },
      }),
    );

    await engine.evaluate(fake.ipWindow[0]!);
    expect(
      fake.emitted.find(
        (e) => e.type === 'security.correlation.automated_scanner',
      ),
    ).toBeUndefined();
  });
});

describe('CorrelationEngine — re-entrancy guard', () => {
  it('skips correlation events themselves to avoid recursion', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    const correlationTrigger = record({
      type: 'security.correlation.credential_stuffing',
      severity: 'HIGH',
    });

    await engine.evaluate(correlationTrigger);

    expect(fake.emitted).toHaveLength(0);
    // readRecentForIp is gated behind the type filter, so it should
    // never even be consulted for a correlation event.
    expect(service.readRecentForIp).not.toHaveBeenCalled();
  });
});

describe('CorrelationEngine — dedup window', () => {
  it('does not emit the same rule twice for the same (rule, ip, user) inside 5 min', async () => {
    const { fake, service } = buildSiem();
    const engine = new CorrelationEngine(service);

    fake.ipWindow = Array.from({ length: 6 }, (_, i) =>
      record({
        type: 'security.auth.login.failed',
        ip: '198.51.100.40',
        payload: { email: `v${i}@example.com` },
      }),
    );

    await engine.evaluate(fake.ipWindow[0]!);
    await engine.evaluate(fake.ipWindow[0]!);

    const matches = fake.emitted.filter(
      (e) => e.type === 'security.correlation.credential_stuffing',
    );
    expect(matches).toHaveLength(1);
  });
});
