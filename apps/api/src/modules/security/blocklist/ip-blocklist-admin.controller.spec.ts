import { BadRequestException } from '@nestjs/common';

import { AdminAuditService } from '../../admin/admin-audit.service';
import { IpBlocklistService } from './ip-blocklist.service';
import { IpBlocklistAdminController } from './ip-blocklist-admin.controller';

/**
 * Plain-method controller tests — exercise the admin surface without
 * spinning up the full HTTP stack, mirroring
 * `threat-protection.controller.spec.ts`.
 */
describe('IpBlocklistAdminController', () => {
  function makeService(
    overrides: Partial<IpBlocklistService> = {},
  ): IpBlocklistService {
    return {
      listBlocked: jest.fn(async () => [
        {
          ip: '100.64.0.5',
          blocked: true,
          reason: 'Honeypot endpoint hit: /wp-login.php',
          source: 'honeypot',
          expiresAt: Date.now() + 60_000,
        },
      ]),
      unblock: jest.fn(async () => true),
      ...overrides,
    } as unknown as IpBlocklistService;
  }

  function makeAudit(): { audit: AdminAuditService; log: jest.Mock } {
    const log = jest.fn(async () => undefined);
    return { audit: { log } as unknown as AdminAuditService, log };
  }

  it('GET /admin/ip-blocklist returns the block list', async () => {
    const service = makeService();
    const { audit } = makeAudit();
    const controller = new IpBlocklistAdminController(service, audit);

    const result = await controller.list({ limit: 200 });

    expect(result.total).toBe(1);
    expect(result.blockedIps[0]?.ip).toBe('100.64.0.5');
    expect(service.listBlocked).toHaveBeenCalledWith(200);
  });

  it('POST /admin/ip-blocklist/unblock removes the IP and writes an audit row', async () => {
    const service = makeService();
    const { audit, log } = makeAudit();
    const controller = new IpBlocklistAdminController(service, audit);

    const result = await controller.unblock(
      { sub: 'admin-1', role: 'ADMIN' } as any,
      { ip: '100.64.0.5', reason: 'shared BFF address, false positive' },
      'idem-key-123',
    );

    expect(result).toEqual({ ip: '100.64.0.5', unblocked: true });
    expect(service.unblock).toHaveBeenCalledWith('100.64.0.5');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'admin-1',
      'security.ip_blocklist.unblocked',
      '100.64.0.5',
      expect.objectContaining({
        unblocked: true,
        reason: 'shared BFF address, false positive',
      }),
    );
  });

  it('POST /admin/ip-blocklist/unblock requires Idempotency-Key', async () => {
    const service = makeService();
    const { audit } = makeAudit();
    const controller = new IpBlocklistAdminController(service, audit);

    await expect(
      controller.unblock(
        { sub: 'admin-1', role: 'ADMIN' } as any,
        { ip: '100.64.0.5' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.unblock).not.toHaveBeenCalled();
  });

  it('records unblocked=false when the IP was not in the blocklist', async () => {
    const service = makeService({ unblock: jest.fn(async () => false) });
    const { audit, log } = makeAudit();
    const controller = new IpBlocklistAdminController(service, audit);

    const result = await controller.unblock(
      { sub: 'admin-1', role: 'ADMIN' } as any,
      { ip: '203.0.113.9' },
      'idem-key-456',
    );

    expect(result).toEqual({ ip: '203.0.113.9', unblocked: false });
    expect(log).toHaveBeenCalledWith(
      'admin-1',
      'security.ip_blocklist.unblocked',
      '203.0.113.9',
      expect.objectContaining({ unblocked: false, reason: null }),
    );
  });
});
