import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdaptiveAuthGuard, REQUIRE_STEP_UP_KEY } from './adaptive-auth.guard';
import type { RiskLevel, StepUpMethod, StepUpVerification } from './adaptive-auth.guard';

/**
 * Unit tests for `AdaptiveAuthGuard` (Task 29.2, Req 29.4).
 *
 * Covers:
 *   - Routes without @RequireStepUp pass through.
 *   - Routes with @RequireStepUp require valid step-up verification.
 *   - Step-up level hierarchy (CRITICAL > HIGH > MEDIUM > LOW).
 *   - Step-up recording and retrieval.
 *   - Step-up invalidation.
 *   - Fail-open when Redis is unavailable.
 */

// ─── Fake Redis ──────────────────────────────────────────────────

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

// ─── Fake ExecutionContext ────────────────────────────────────────

function createMockContext(options: {
  user?: { id?: string; sub?: string; role?: string } | null;
  path?: string;
  method?: string;
} = {}): any {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user: options.user === null ? undefined : (options.user ?? { id: 'user-1' }),
        path: options.path ?? '/api/v1/test',
        method: options.method ?? 'POST',
        headers: {},
        ip: '10.0.0.1',
      }),
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AdaptiveAuthGuard — route without @RequireStepUp', () => {
  let guard: AdaptiveAuthGuard;
  let reflector: Reflector;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    reflector = new Reflector();
    // Mock reflector to return undefined (no step-up required)
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    guard = new AdaptiveAuthGuard(reflector, redis as never);
  });

  it('allows request when no @RequireStepUp decorator is present', async () => {
    const context = createMockContext();
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('allows non-HTTP contexts (e.g. WebSocket)', async () => {
    const context = {
      getType: () => 'ws',
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');
    const result = await guard.canActivate(context as any);
    expect(result).toBe(true);
  });
});

describe('AdaptiveAuthGuard — step-up required (Req 29.4)', () => {
  let guard: AdaptiveAuthGuard;
  let reflector: Reflector;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    reflector = new Reflector();
    guard = new AdaptiveAuthGuard(reflector, redis as never);
  });

  it('throws STEP_UP_REQUIRED when no step-up verification exists', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');
    const context = createMockContext({ user: { id: 'user-1' } });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(context);
    } catch (err) {
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.FORBIDDEN);
      const response = httpErr.getResponse() as any;
      expect(response.code).toBe('STEP_UP_REQUIRED');
      expect(response.details.requiredLevel).toBe('HIGH');
      expect(response.details.acceptedMethods).toContain('MFA_TOTP');
    }
  });

  it('allows request when valid step-up verification exists', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');

    // Record a step-up verification
    await guard.recordStepUp('user-1', 'MFA_TOTP', 'HIGH');

    const context = createMockContext({ user: { id: 'user-1' } });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('throws STEP_UP_INSUFFICIENT when level is too low', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('CRITICAL');

    // Record a MEDIUM step-up (insufficient for CRITICAL)
    await guard.recordStepUp('user-1', 'PASSWORD_REENTRY', 'MEDIUM');

    const context = createMockContext({ user: { id: 'user-1' } });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(context);
    } catch (err) {
      const httpErr = err as HttpException;
      const response = httpErr.getResponse() as any;
      expect(response.code).toBe('STEP_UP_INSUFFICIENT');
      expect(response.details.currentLevel).toBe('MEDIUM');
      expect(response.details.requiredLevel).toBe('CRITICAL');
    }
  });
});

describe('AdaptiveAuthGuard — level hierarchy', () => {
  let guard: AdaptiveAuthGuard;
  let reflector: Reflector;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    reflector = new Reflector();
    guard = new AdaptiveAuthGuard(reflector, redis as never);
  });

  it('CRITICAL satisfies all levels', async () => {
    await guard.recordStepUp('user-1', 'WEBAUTHN', 'CRITICAL');

    for (const level of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as RiskLevel[]) {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(level);
      const context = createMockContext({ user: { id: 'user-1' } });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    }
  });

  it('LOW does not satisfy MEDIUM, HIGH, or CRITICAL', async () => {
    await guard.recordStepUp('user-1', 'EMAIL_OTP', 'LOW');

    for (const level of ['MEDIUM', 'HIGH', 'CRITICAL'] as RiskLevel[]) {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(level);
      const context = createMockContext({ user: { id: 'user-1' } });
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    }
  });

  it('HIGH satisfies HIGH and below but not CRITICAL', async () => {
    await guard.recordStepUp('user-1', 'MFA_TOTP', 'HIGH');

    // Should pass for LOW, MEDIUM, HIGH
    for (const level of ['LOW', 'MEDIUM', 'HIGH'] as RiskLevel[]) {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(level);
      const context = createMockContext({ user: { id: 'user-1' } });
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    }

    // Should fail for CRITICAL
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('CRITICAL');
    const context = createMockContext({ user: { id: 'user-1' } });
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });
});

describe('AdaptiveAuthGuard — step-up management', () => {
  let guard: AdaptiveAuthGuard;
  let reflector: Reflector;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    reflector = new Reflector();
    guard = new AdaptiveAuthGuard(reflector, redis as never);
  });

  it('recordStepUp stores verification in Redis', async () => {
    await guard.recordStepUp('user-1', 'MFA_TOTP', 'HIGH');

    const verification = await guard.getStepUpVerification('user-1');
    expect(verification).not.toBeNull();
    expect(verification!.userId).toBe('user-1');
    expect(verification!.method).toBe('MFA_TOTP');
    expect(verification!.satisfiesLevel).toBe('HIGH');
    expect(verification!.verifiedAt).toEqual(expect.any(Number));
  });

  it('invalidateStepUp removes the verification', async () => {
    await guard.recordStepUp('user-1', 'MFA_TOTP', 'HIGH');
    await guard.invalidateStepUp('user-1');

    const verification = await guard.getStepUpVerification('user-1');
    expect(verification).toBeNull();
  });

  it('getStepUpVerification returns null for unknown user', async () => {
    const verification = await guard.getStepUpVerification('nonexistent');
    expect(verification).toBeNull();
  });
});

describe('AdaptiveAuthGuard — fail-open posture', () => {
  it('allows request when Redis is unavailable', async () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');
    const guard = new AdaptiveAuthGuard(reflector); // no redis

    const context = createMockContext({ user: { id: 'user-1' } });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('allows request when user is not authenticated (let auth guard handle)', async () => {
    const redis = new FakeRedis();
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');
    const guard = new AdaptiveAuthGuard(reflector, redis as never);

    const context = createMockContext({ user: null });
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});

describe('AdaptiveAuthGuard — accepted methods by level', () => {
  let guard: AdaptiveAuthGuard;
  let reflector: Reflector;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    reflector = new Reflector();
    guard = new AdaptiveAuthGuard(reflector, redis as never);
  });

  it('CRITICAL level only accepts WEBAUTHN and MFA_TOTP', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('CRITICAL');
    const context = createMockContext({ user: { id: 'user-1' } });

    try {
      await guard.canActivate(context);
    } catch (err) {
      const response = (err as HttpException).getResponse() as any;
      expect(response.details.acceptedMethods).toEqual(['WEBAUTHN', 'MFA_TOTP']);
    }
  });

  it('HIGH level accepts WEBAUTHN, MFA_TOTP, MFA_SMS, PASSWORD_REENTRY', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('HIGH');
    const context = createMockContext({ user: { id: 'user-1' } });

    try {
      await guard.canActivate(context);
    } catch (err) {
      const response = (err as HttpException).getResponse() as any;
      expect(response.details.acceptedMethods).toEqual([
        'WEBAUTHN',
        'MFA_TOTP',
        'MFA_SMS',
        'PASSWORD_REENTRY',
      ]);
    }
  });
});
