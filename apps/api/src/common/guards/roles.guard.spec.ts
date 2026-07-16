import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function makeContext(
  user: { role?: string; sub?: string } | null,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows the request when no @Roles metadata is set (Req 17.2)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = makeContext({ role: 'STUDENT', sub: 's1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request when the user has one of the required roles (Req 17.5)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TEACHER', 'ADMIN']);
    const ctx = makeContext({ role: 'TEACHER', sub: 't1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws 403 FORBIDDEN_ROLE when the user role does not match (Req 17.6)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const ctx = makeContext({ role: 'STUDENT', sub: 's1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    try {
      guard.canActivate(ctx);
    } catch (err: any) {
      expect(err.getResponse()).toMatchObject({ code: 'FORBIDDEN_ROLE' });
    }
  });

  it('throws 403 FORBIDDEN_ROLE when the user has no role attribute', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const ctx = makeContext({} as any);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('reads metadata from BOTH the handler and the class (Reflector.getAllAndOverride)', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    spy.mockReturnValue(['TEACHER']);
    const ctx = makeContext({ role: 'TEACHER', sub: 't1' });
    guard.canActivate(ctx);
    expect(spy).toHaveBeenCalledWith(ROLES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('treats an empty roles array like "no requirement" and allows', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const ctx = makeContext({ role: 'STUDENT', sub: 's1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
