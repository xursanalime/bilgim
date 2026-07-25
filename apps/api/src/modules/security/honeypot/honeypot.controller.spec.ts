import { HoneypotController } from './honeypot.controller';
import { IpBlocklistService } from '../blocklist/ip-blocklist.service';

/**
 * Unit tests for `HoneypotController` (Task 27.5, Req 27.8).
 *
 * Covers:
 *   - Each honeypot path triggers a SIEM `security.honeypot.hit` event.
 *   - Each hit blocks the source IP for 24h via `IpBlocklistService`.
 *   - X-Forwarded-For is honoured for the source IP.
 *   - Bogus content is returned (200 with a small body).
 *   - SIEM / blocklist failures don't propagate to the response.
 *   - The decoy paths advertised by the controller match the
 *     prefix-exclusion list in `main.ts`.
 */

function makeReq(
  url: string,
  headers: Record<string, string> = {},
  ip = '198.51.100.10',
) {
  return {
    ip,
    url,
    originalUrl: url,
    method: 'GET',
    headers,
    socket: { remoteAddress: ip },
  };
}

interface Built {
  controller: HoneypotController;
  blocklist: jest.Mocked<IpBlocklistService>;
  siem: { recordEvent: jest.Mock };
}

function build(): Built {
  const blocklist = {
    block: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<IpBlocklistService>;
  const siem = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const controller = new HoneypotController(blocklist, siem as never);
  return { controller, blocklist, siem };
}

// ---------------------------------------------------------------------

describe('HoneypotController — every endpoint records and blocks', () => {
  type AnyHandler = (req: ReturnType<typeof makeReq>) => Promise<string>;
  const cases: Array<{
    method: keyof HoneypotController;
    path: string;
  }> = [
    { method: 'adminBackup', path: '/admin-backup' },
    { method: 'adminBackupZip', path: '/admin-backup.zip' },
    { method: 'adminBackupTarGz', path: '/admin-backup.tar.gz' },
    { method: 'wpLogin', path: '/wp-login.php' },
    { method: 'wpAdmin', path: '/wp-admin' },
    { method: 'wpUploads', path: '/wp-content/uploads' },
    { method: 'envFile', path: '/.env' },
    { method: 'gitConfig', path: '/.git/config' },
    { method: 'phpmyadmin', path: '/phpmyadmin' },
    { method: 'xmlrpc', path: '/xmlrpc.php' },
  ];

  function getHandler(
    controller: HoneypotController,
    method: keyof HoneypotController,
  ): AnyHandler {
    const handler = (controller as unknown as Record<string, AnyHandler>)[
      method as string
    ];
    if (!handler) throw new Error(`missing handler ${String(method)}`);
    return handler.bind(controller);
  }

  it.each(cases)('returns a non-empty bogus body for %p', async ({ method, path }) => {
    const { controller } = build();
    const req = makeReq(path);
    const body = await getHandler(controller, method)(req);
    expect(typeof body).toBe('string');
    expect((body as string).length).toBeGreaterThan(0);
  });

  it.each(cases)('blocks the source IP for 24h on %p hit', async ({ method, path }) => {
    const { controller, blocklist } = build();
    const req = makeReq(path, {}, '198.51.100.55');
    await getHandler(controller, method)(req);

    expect(blocklist.block).toHaveBeenCalledWith(
      '198.51.100.55',
      IpBlocklistService.DEFAULT_HONEYPOT_TTL_SEC,
      expect.stringContaining(path),
      'honeypot',
    );
  });

  it.each(cases)('emits security.honeypot.hit (CRITICAL) on %p', async ({ method, path }) => {
    const { controller, siem } = build();
    const req = makeReq(path);
    await getHandler(controller, method)(req);

    expect(siem.recordEvent).toHaveBeenCalledTimes(1);
    expect(siem.recordEvent.mock.calls[0]![0]).toMatchObject({
      type: 'security.honeypot.hit',
      severity: 'CRITICAL',
      payload: expect.objectContaining({ path, method: 'GET' }),
    });
  });
});

describe('HoneypotController — IP extraction', () => {
  it('ignores a spoofed X-Forwarded-For and blocks the real connection IP', async () => {
    const { controller, blocklist } = build();
    // Attacker sends a forged X-Forwarded-For hoping to make us block an
    // arbitrary victim (203.0.113.99) instead of their own IP. The real
    // socket address (198.51.100.10, set by makeReq) must win.
    const req = makeReq(
      '/wp-login.php',
      { 'x-forwarded-for': '203.0.113.99, 10.0.0.1' },
    );
    await controller.wpLogin(req);

    expect(blocklist.block).toHaveBeenCalledWith(
      '198.51.100.10',
      expect.any(Number),
      expect.any(String),
      'honeypot',
    );
  });

  it('does NOT block a loopback origin (avoids self-lockout of the host)', async () => {
    const { controller, blocklist, siem } = build();
    const req = makeReq('/.env', {}, '127.0.0.1');
    const body = await controller.envFile(req);

    // No block for local requests...
    expect(blocklist.block).not.toHaveBeenCalled();
    // ...but the hit is still observed for visibility, and the decoy still
    // returns so a local probe sees the same response a scanner would.
    expect(siem.recordEvent).toHaveBeenCalledTimes(1);
    expect(typeof body).toBe('string');
  });

  it('does NOT block the IPv6 loopback ::1 either', async () => {
    const { controller, blocklist } = build();
    const req = makeReq('/wp-login.php', {}, '::1');
    await controller.wpLogin(req);
    expect(blocklist.block).not.toHaveBeenCalled();
  });
});

describe('HoneypotController — fault tolerance', () => {
  it('returns the decoy body even when the blocklist write fails', async () => {
    const { controller, blocklist } = build();
    blocklist.block.mockRejectedValueOnce(new Error('redis down'));

    const body = await controller.envFile(makeReq('/.env'));
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns the decoy body even when the SIEM emit fails', async () => {
    const { controller, siem } = build();
    siem.recordEvent.mockRejectedValueOnce(new Error('siem boom'));

    const body = await controller.wpLogin(makeReq('/wp-login.php'));
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
  });
});

describe('HoneypotController — advertised honeypot paths', () => {
  it('exposes the path list for correlation tests + main.ts prefix exclusion', () => {
    expect(HoneypotController.HONEYPOT_PATHS).toEqual(
      expect.arrayContaining([
        '/admin-backup',
        '/admin-backup.zip',
        '/admin-backup.tar.gz',
        '/wp-login.php',
        '/wp-admin',
        '/wp-content/uploads',
        '/.env',
        '/.git/config',
        '/phpmyadmin',
        '/xmlrpc.php',
      ]),
    );
  });
});
