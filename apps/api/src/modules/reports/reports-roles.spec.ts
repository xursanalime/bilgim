import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsTeacherController } from './reports-teacher.controller';

/**
 * Role-gating contract tests for the reports controllers (Task 23.3).
 *
 * The global `RolesGuard` enforces `@Roles(...)` metadata at runtime;
 * these tests pin the metadata so a TEACHER cannot accidentally hit
 * `/admin/exports/*` or vice versa even if a future refactor removes
 * the explicit annotation.
 */
describe('Reports controllers — role gating', () => {
  const reflector = new Reflector();

  it('ReportsAdminController is gated to ADMIN at the class level', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, ReportsAdminController);
    expect(roles).toEqual(['ADMIN']);
  });

  it('ReportsTeacherController is gated to TEACHER at the class level', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, ReportsTeacherController);
    expect(roles).toEqual(['TEACHER']);
  });

  it('ReportsAdminController controllers do NOT include TEACHER in @Roles', () => {
    const roles =
      reflector.get<string[]>(ROLES_KEY, ReportsAdminController) ?? [];
    expect(roles).not.toContain('TEACHER');
    expect(roles).not.toContain('STUDENT');
  });

  it('ReportsTeacherController does NOT include ADMIN in @Roles', () => {
    const roles =
      reflector.get<string[]>(ROLES_KEY, ReportsTeacherController) ?? [];
    expect(roles).not.toContain('ADMIN');
    expect(roles).not.toContain('STUDENT');
  });
});
