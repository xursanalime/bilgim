import { BadRequestException } from '@nestjs/common';

import { AdminAuditService } from '../../admin/admin-audit.service';
import { ThreatProtectionService } from '../threat-protection.service';
import { ThreatProtectionController } from '../threat-protection.controller';

/**
 * Plain-method controller tests — exercise the admin surface without
 * spinning up the full HTTP stack. The Zod-decoded DTO objects are
 * passed in directly; the actual pipe is covered by other suites.
 */
describe('ThreatProtectionController', () => {
  function makeService(
    overrides: Partial<ThreatProtectionService> = {},
  ): ThreatProtectionService {
    return {
      listBlockedIps: jest.fn(async () => [
        {
          ip: '1.1.1.1',
          reason: 'RATE_LIMIT_BURST' as const,
          blockedAt: '2025-01-01T00:00:00.000Z',
          expiresAt: '2025-01-01T00:10:00.000Z',
        },
      ]),
      unblockIp: jest.fn(async () => true),
      ...overrides,
    } as unknown as ThreatProtectionService;
  }

  function makeAudit(): {
    audit: AdminAuditService;
    log: jest.Mock;
  } {
    const log = jest.fn(async () => undefined);
    return {
      audit: { log } as unknown as AdminAuditService,
      log,
    };
  }

  it('GET /admin/threat-protection/blocked-ips returns the block list', async () => {
    const service = makeService();
    const { audit } = makeAudit();
    const controller = new ThreatProtectionController(service, audit);

    const result = await controller.listBlockedIps({ limit: 100 });
    expect(result.total).toBe(1);
    expect(result.blockedIps[0]?.ip).toBe('1.1.1.1');
    expect(service.listBlockedIps).toHaveBeenCalledWith(100);
  });

  it('POST /admin/threat-protection/unblock removes the IP and writes an audit row', async () => {
    const service = makeService();
    const { audit, log } = makeAudit();
    const controller = new ThreatProtectionController(service, audit);

    const result = await controller.unblockIp(
      { sub: 'admin-1', role: 'ADMIN' } as any,
      { ip: '8.8.8.8', reason: 'false positive' },
      'idem-key-123',
      '203.0.113.1',
    );

    expect(result).toEqual({ ip: '8.8.8.8', unblocked: true });
    expect(service.unblockIp).toHaveBeenCalledWith('8.8.8.8');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'admin-1',
      'waf.ip.unblocked',
      '8.8.8.8',
      expect.objectContaining({
        unblocked: true,
        reason: 'false positive',
      }),
      { ip: '203.0.113.1' },
    );
  });

  it('POST /admin/threat-protection/unblock requires Idempotency-Key', async () => {
    const service = makeService();
    const { audit } = makeAudit();
    const controller = new ThreatProtectionController(service, audit);

    await expect(
      controller.unblockIp(
        { sub: 'admin-1', role: 'ADMIN' } as any,
        { ip: '8.8.8.8' },
        undefined,
        '203.0.113.1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.unblockIp).not.toHaveBeenCalled();
  });

  it('records unblocked=false when the IP was not in the blocklist', async () => {
    const service = makeService({
      unblockIp: jest.fn(async () => false),
    });
    const { audit, log } = makeAudit();
    const controller = new ThreatProtectionController(service, audit);

    const result = await controller.unblockIp(
      { sub: 'admin-1', role: 'ADMIN' } as any,
      { ip: '9.9.9.9' },
      'idem-key-456',
      '203.0.113.1',
    );

    expect(result).toEqual({ ip: '9.9.9.9', unblocked: false });
    expect(log).toHaveBeenCalledWith(
      'admin-1',
      'waf.ip.unblocked',
      '9.9.9.9',
      expect.objectContaining({ unblocked: false }),
      { ip: '203.0.113.1' },
    );
  });
});
