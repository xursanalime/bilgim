import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

import { IpBlocklistGuard } from './ip-blocklist.guard';
import type { IpBlockStatus, IpBlocklistService } from './ip-blocklist.service';

/**
 * Unit tests for `IpBlocklistGuard` (Task 27.5, Req 27.8 / 27.10).
 *
 * Covers:
 *   - Allowed IP passes.
 *   - Blocked IP rejected with 403 IP_BLOCKED + Retry-After.
 *   - X-Forwarded-For honoured (since trust_proxy=loopback).
 *   - /health and /metrics paths skip the guard.
 *   - Missing IP is allowed (fail-open on `unknown`).
 *   - SIEM emission is best-effort and never throws.
 */

interface MockRequest {
  ip?: string;
  url?: string;
  originalUrl?: string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function makeContext(req: MockRequest, res?: Record<string, unknown>):
  ExecutionContext {
  const response = res ?? { setHeader: jest.fn() };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: <T>() => req as unknown as T,
      getResponse: <T>() => response as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function makeService(status: IpBlockStatus): jest.Mocked<IpBlocklistService> {
  return {
    isBlocked: jest.fn().mockResolvedValue(status.blocked),
    getBlockStatus: jest.fn().mockResolvedValue(status),
    block: jest.fn(),
    unblock: jest.fn(),
    blockBulk: jest.fn(),
  } as unknown as jest.Mocked<IpBlocklistService>;
}

// ---------------------------------------------------------------------

describe('IpBlocklistGuard — allow path', () => {
  it('returns true when the IP is not blocked', async () => {
    const service = makeService({ blocked: false });
    const guard = new IpBlocklistGuard(service);
    const ctx = makeContext({ ip: '203.0.113.1', url: '/api/v1/users' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.getBlockStatus).toHaveBeenCalledWith('203.0.113.1');
  });

  it('skips /health regardless of block state', async () => {
    const service = makeService({ blocked: true, reason: 'r' });
    const guard = new IpBlocklistGuard(service);

    const ctx = makeContext({
      ip: '203.0.113.99',
      url: '/health',
      originalUrl: '/health',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.getBlockStatus).not.toHaveBeenCalled();
  });

  it('skips /api/v1/health and /metrics', async () => {
    const service = makeService({ blocked: true, reason: 'r' });
    const guard = new IpBlocklistGuard(service);

    for (const url of [
      '/api/v1/health',
      '/api/v1/health/ready',
      '/metrics',
      '/api/v1/metrics',
    ]) {
      const ctx = makeContext({
        ip: '203.0.113.50',
        url,
        originalUrl: url,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
    expect(service.getBlockStatus).not.toHaveBeenCalled();
  });

  it('passes through when IP is unknown (fail-open)', async () => {
    const service = makeService({ blocked: false });
    const guard = new IpBlocklistGuard(service);
    const ctx = makeContext({ url: '/api/v1/users' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.getBlockStatus).not.toHaveBeenCalled();
  });
});

describe('IpBlocklistGuard — reject path', () => {
  it('throws 403 IP_BLOCKED with reason envelope', async () => {
    const status: IpBlockStatus = {
      blocked: true,
      reason: 'honeypot.hit',
      source: 'honeypot',
      expiresAt: Date.now() + 60_000,
    };
    const service = makeService(status);
    const guard = new IpBlocklistGuard(service);
    const ctx = makeContext({ ip: '198.51.100.99', url: '/api/v1/users' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        code: 'IP_BLOCKED',
      },
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('sets Retry-After header from expiresAt', async () => {
    const expiresAt = Date.now() + 120_000;
    const status: IpBlockStatus = {
      blocked: true,
      reason: 'r',
      source: 's',
      expiresAt,
    };
    const service = makeService(status);
    const guard = new IpBlocklistGuard(service);

    const setHeader = jest.fn();
    const ctx = makeContext(
      { ip: '198.51.100.50', url: '/api/v1/users' },
      { setHeader },
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^1\d{2}$/),
    );
  });

  it('honours X-Forwarded-For — picks the leftmost client IP', async () => {
    const status: IpBlockStatus = {
      blocked: true,
      reason: 'manual',
      source: 'manual',
    };
    const service = makeService(status);
    const guard = new IpBlocklistGuard(service);

    const ctx = makeContext({
      ip: '127.0.0.1',
      url: '/api/v1/users',
      headers: {
        'x-forwarded-for': '198.51.100.77, 10.0.0.1, 172.16.0.1',
      },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(service.getBlockStatus).toHaveBeenCalledWith('198.51.100.77');
  });
});

describe('IpBlocklistGuard — SIEM emission', () => {
  it('records security.blocklist.ip.rejected on every reject', async () => {
    const status: IpBlockStatus = {
      blocked: true,
      reason: 'honeypot',
      source: 'honeypot',
      expiresAt: Date.now() + 5000,
    };
    const service = makeService(status);
    const siem = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    const guard = new IpBlocklistGuard(service, siem as never);

    const ctx = makeContext({
      ip: '198.51.100.30',
      url: '/api/v1/secret',
      method: 'POST',
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(siem.recordEvent).toHaveBeenCalledTimes(1);
    expect(siem.recordEvent.mock.calls[0]![0]).toMatchObject({
      type: 'security.blocklist.ip.rejected',
      severity: 'MEDIUM',
      ip: '198.51.100.30',
      payload: expect.objectContaining({
        reason: 'honeypot',
        source: 'honeypot',
        method: 'POST',
        path: '/api/v1/secret',
      }),
    });
  });

  it('still rejects when SIEM emit throws', async () => {
    const status: IpBlockStatus = { blocked: true, reason: 'r' };
    const service = makeService(status);
    const siem = {
      recordEvent: jest.fn().mockRejectedValue(new Error('siem boom')),
    };
    const guard = new IpBlocklistGuard(service, siem as never);

    const ctx = makeContext({ ip: '198.51.100.40', url: '/api/v1/x' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});

describe('IpBlocklistGuard — non-http context', () => {
  it('lets non-http executions pass through', async () => {
    const service = makeService({ blocked: true, reason: 'r' });
    const guard = new IpBlocklistGuard(service);

    const ctx = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('should not be called');
      },
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(service.getBlockStatus).not.toHaveBeenCalled();
  });
});
