import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import {
  ALLOWED_ROLES,
  assertAuthCompleteness,
  inspectAuthCompleteness,
  inspectControllerClasses,
} from './auth-completeness';

class FakeJwtAuthGuard {
  canActivate() {
    return true;
  }
}

class FakeDomainGuard {
  canActivate() {
    return true;
  }
}

@Controller('open')
class FullyPublicController {
  @Public()
  @Get('a')
  publicHandler() {
    return 'ok';
  }

  @Public()
  @Get('b')
  anotherPublic() {
    return 'ok';
  }
}

@Controller('protected')
class ControllerWithGuard {
  @UseGuards(FakeJwtAuthGuard)
  @Roles('TEACHER')
  @Get('a')
  guardedHandler() {
    return 'ok';
  }
}

@Controller('domain')
class ControllerWithDomainGuard {
  @UseGuards(FakeDomainGuard)
  @Roles('STUDENT', 'TEACHER', 'ADMIN')
  @Get('a')
  domainHandler() {
    return 'ok';
  }
}

@Controller('leaky')
class LeakyController {
  @Get('unguarded')
  unguardedHandler() {
    return 'ok';
  }
}

@Controller('teach')
@Roles('TEACHER')
class ControllerWithClassRoles {
  @Get('list')
  list() {
    return 'ok';
  }

  @Get('one')
  one() {
    return 'ok';
  }
}

@Controller('mixed')
@Roles('TEACHER')
class ControllerWithHandlerOverride {
  @Get('teacher-only')
  teacherOnly() {
    return 'ok';
  }

  // Handler-level @Roles overrides the class-level one (Reflector.getAllAndOverride).
  @Roles('ADMIN')
  @Get('admin-only')
  adminOnly() {
    return 'ok';
  }
}

@Controller('typo')
class ControllerWithTypoRole {
  @Roles('SUPERTEACHER' as any)
  @Get('weird')
  weird() {
    return 'ok';
  }
}

@Controller('forgot')
class ControllerForgotRoles {
  // No @Roles decorator at all — should fail when requireRoles=true.
  @Get('list')
  list() {
    return 'ok';
  }
}

@Controller('public-class')
@Public()
class FullyPublicClassController {
  @Get('a')
  a() {
    return 'ok';
  }

  @Get('b')
  b() {
    return 'ok';
  }
}

async function buildApp(controllers: any[]): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
    providers: [Reflector, MetadataScanner, DiscoveryService],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  return app;
}

describe('auth-completeness', () => {
  describe('via live Nest app (inspectAuthCompleteness)', () => {
    it('reports zero missing routes when every handler is @Public()', async () => {
      const app = await buildApp([FullyPublicController]);
      const report = inspectAuthCompleteness(app, []);
      expect(report.missing).toHaveLength(0);
      expect(report.scanned).toBeGreaterThan(0);
      await app.close();
    });

    it('reports zero missing routes when an auth guard is wired globally and roles are present', async () => {
      const app = await buildApp([ControllerWithClassRoles]);
      const report = inspectAuthCompleteness(app, [FakeJwtAuthGuard]);
      expect(report.missing).toHaveLength(0);
      await app.close();
    });

    it('detects routes that have neither @Public() nor a guard (Req 17.3, 17.4)', async () => {
      const app = await buildApp([LeakyController]);
      const report = inspectAuthCompleteness(app, []); // no global guard
      expect(report.missing).toEqual([
        {
          controller: 'LeakyController',
          handler: 'unguardedHandler',
          path: '/leaky/unguarded',
          reason: 'NO_AUTH',
        },
      ]);
      await app.close();
    });

    it('accepts handlers that wire an auth guard explicitly via @UseGuards', async () => {
      const app = await buildApp([ControllerWithGuard]);
      const report = inspectAuthCompleteness(app, [], {
        authGuardNames: ['FakeJwtAuthGuard'],
      });
      expect(report.missing).toHaveLength(0);
      await app.close();
    });

    it('treats a domain-specific guard listed in authGuardNames as sufficient', async () => {
      const app = await buildApp([ControllerWithDomainGuard]);
      const report = inspectAuthCompleteness(app, [], {
        authGuardNames: ['FakeDomainGuard'],
      });
      expect(report.missing).toHaveLength(0);
      await app.close();
    });

    it('assertAuthCompleteness throws when any route is unguarded', async () => {
      const app = await buildApp([LeakyController]);
      expect(() => assertAuthCompleteness(app, [], {})).toThrow(
        /Auth completeness check failed/,
      );
      await app.close();
    });

    it('assertAuthCompleteness passes silently when all routes are protected', async () => {
      const app = await buildApp([
        FullyPublicController,
        ControllerWithClassRoles,
      ]);
      expect(() =>
        assertAuthCompleteness(app, [FakeJwtAuthGuard]),
      ).not.toThrow();
      await app.close();
    });
  });

  // The class-based variant lets us test the contract without booting the
  // full Nest application — useful for the strengthened role checks below.
  describe('via class-based variant (inspectControllerClasses)', () => {
    it('flags non-public routes that lack @Roles when requireRoles=true (Req 17.5, 17.6)', () => {
      const report = inspectControllerClasses(
        [ControllerForgotRoles],
        [FakeJwtAuthGuard],
      );
      expect(report.missing).toEqual([
        {
          controller: 'ControllerForgotRoles',
          handler: 'list',
          path: '/forgot/list',
          reason: 'NO_ROLES',
        },
      ]);
    });

    it('passes non-public routes that lack @Roles when requireRoles=false (back-compat)', () => {
      const report = inspectControllerClasses(
        [ControllerForgotRoles],
        [FakeJwtAuthGuard],
        { requireRoles: false },
      );
      expect(report.missing).toHaveLength(0);
    });

    it('flags routes whose @Roles entries are not in {STUDENT, TEACHER, ADMIN} (Req 17.1)', () => {
      const report = inspectControllerClasses(
        [ControllerWithTypoRole],
        [FakeJwtAuthGuard],
      );
      expect(report.missing).toEqual([
        {
          controller: 'ControllerWithTypoRole',
          handler: 'weird',
          path: '/typo/weird',
          reason: 'INVALID_ROLES',
          roles: ['SUPERTEACHER'],
        },
      ]);
    });

    it('accepts class-level @Roles on every handler', () => {
      const report = inspectControllerClasses(
        [ControllerWithClassRoles],
        [FakeJwtAuthGuard],
      );
      expect(report.scanned).toBe(2);
      expect(report.missing).toHaveLength(0);
    });

    it('lets handler-level @Roles override class-level @Roles', () => {
      const report = inspectControllerClasses(
        [ControllerWithHandlerOverride],
        [FakeJwtAuthGuard],
      );
      expect(report.missing).toHaveLength(0);
      expect(report.scanned).toBe(2);
    });

    it('skips public-class controllers regardless of @Roles presence', () => {
      const report = inspectControllerClasses(
        [FullyPublicClassController],
        [], // no global guard required for public routes
      );
      expect(report.missing).toHaveLength(0);
    });

    it('does not emit duplicate failures for a single handler', () => {
      // ControllerForgotRoles has neither auth nor roles. With no global
      // guard we report NO_AUTH only — the role check only runs once auth
      // is established.
      const report = inspectControllerClasses(
        [ControllerForgotRoles],
        [], // no global auth guard
      );
      expect(report.missing).toEqual([
        {
          controller: 'ControllerForgotRoles',
          handler: 'list',
          path: '/forgot/list',
          reason: 'NO_AUTH',
        },
      ]);
    });

    it('the allowed-role set covers exactly the platform roles (Req 17.1)', () => {
      expect(new Set(ALLOWED_ROLES)).toEqual(
        new Set(['STUDENT', 'TEACHER', 'ADMIN']),
      );
    });
  });
});
