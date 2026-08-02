import { Reflector } from '@nestjs/core';

import { JwtPayload } from '../auth/tokens.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

/**
 * ScheduleController smoke tests (Req 10.1, 10.2, 10.3, 10.5).
 *
 * Coverage:
 *   - Mutating routes forward the JWT teacherId + dto + path params.
 *   - GET branches by role: TEACHER → ownership check; STUDENT →
 *     enrollment check; ADMIN → no extra check (audit access).
 *   - Reflected `@Roles(...)` metadata matches the documented contract so
 *     the global RolesGuard composes correctly.
 */
describe('ScheduleController', () => {
  let controller: ScheduleController;
  let service: jest.Mocked<ScheduleService>;

  const teacher: JwtPayload = {
    sub: 'teacher-1',
    email: 't@example.com',
    role: 'TEACHER',
  };
  const student: JwtPayload = {
    sub: 'student-1',
    email: 's@example.com',
    role: 'STUDENT',
  };
  const admin: JwtPayload = {
    sub: 'admin-1',
    email: 'a@example.com',
    role: 'ADMIN',
  };

  beforeEach(() => {
    service = {
      createScheduleEvent: jest.fn(),
      updateScheduleEvent: jest.fn(),
      deleteScheduleEvent: jest.fn(),
      listEventsForGroup: jest.fn(),
      assertTeacherOwnsGroup: jest.fn(),
      assertStudentEnrolledInGroup: jest.fn(),
    } as any;
    controller = new ScheduleController(service);
  });

  // ==================================================================
  // POST /schedule/events
  // ==================================================================

  it('POST /schedule/events forwards teacherId + dto', async () => {
    service.createScheduleEvent.mockResolvedValue({
      id: 'sch-1',
      version: 1,
    } as any);

    const dto = {
      groupId: 'group-1',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      timezone: 'Asia/Tashkent',
      durationMin: 90,
    };
    await controller.create(teacher, dto as any);

    expect(service.createScheduleEvent).toHaveBeenCalledWith(
      'teacher-1',
      dto,
    );
  });

  // ==================================================================
  // PATCH /schedule/events/:id
  // ==================================================================

  it('PATCH /schedule/events/:id forwards teacherId + id + dto', async () => {
    service.updateScheduleEvent.mockResolvedValue({
      id: 'sch-1',
      version: 2,
    } as any);

    await controller.update(teacher, 'sch-1', {
      durationMin: 60,
    } as any);

    expect(service.updateScheduleEvent).toHaveBeenCalledWith(
      'teacher-1',
      'sch-1',
      { durationMin: 60 },
    );
  });

  // ==================================================================
  // DELETE /schedule/events/:id
  // ==================================================================

  it('DELETE /schedule/events/:id forwards teacherId + id', async () => {
    service.deleteScheduleEvent.mockResolvedValue(undefined);

    await controller.delete(teacher, 'sch-1');

    expect(service.deleteScheduleEvent).toHaveBeenCalledWith(
      'teacher-1',
      'sch-1',
    );
  });

  // ==================================================================
  // GET /schedule/groups/:groupId/events — branch by role
  // ==================================================================

  describe('GET /schedule/groups/:groupId/events', () => {
    it('TEACHER path: asserts ownership before listing', async () => {
      service.assertTeacherOwnsGroup.mockResolvedValue(undefined);
      service.listEventsForGroup.mockResolvedValue({
        groupId: 'group-1',
        version: 1,
        schedule: null,
        occurrences: [],
      });

      await controller.listForGroup(teacher, 'group-1');

      expect(service.assertTeacherOwnsGroup).toHaveBeenCalledWith(
        'teacher-1',
        'group-1',
      );
      expect(service.assertStudentEnrolledInGroup).not.toHaveBeenCalled();
      expect(service.listEventsForGroup).toHaveBeenCalledWith('group-1');
    });

    it('STUDENT path: asserts APPROVED enrollment before listing', async () => {
      service.assertStudentEnrolledInGroup.mockResolvedValue(undefined);
      service.listEventsForGroup.mockResolvedValue({
        groupId: 'group-1',
        version: 1,
        schedule: null,
        occurrences: [],
      });

      await controller.listForGroup(student, 'group-1');

      expect(service.assertStudentEnrolledInGroup).toHaveBeenCalledWith(
        'student-1',
        'group-1',
      );
      expect(service.assertTeacherOwnsGroup).not.toHaveBeenCalled();
      expect(service.listEventsForGroup).toHaveBeenCalledWith('group-1');
    });

    it('ADMIN path: no extra check, just returns the list (audit access)', async () => {
      service.listEventsForGroup.mockResolvedValue({
        groupId: 'group-1',
        version: 1,
        schedule: null,
        occurrences: [],
      });

      await controller.listForGroup(admin, 'group-1');

      expect(service.assertTeacherOwnsGroup).not.toHaveBeenCalled();
      expect(service.assertStudentEnrolledInGroup).not.toHaveBeenCalled();
      expect(service.listEventsForGroup).toHaveBeenCalledWith('group-1');
    });
  });

  // ==================================================================
  // Reflected @Roles metadata
  // ==================================================================

  describe('@Roles metadata', () => {
    const reflector = new Reflector();

    it('POST /schedule/events is TEACHER only', () => {
      const roles = reflector.getAllAndOverride<string[]>('roles', [
        controller.create as any,
        ScheduleController,
      ]);
      expect(roles).toEqual(['TEACHER']);
    });

    it('PATCH /schedule/events/:id is TEACHER only', () => {
      const roles = reflector.getAllAndOverride<string[]>('roles', [
        controller.update as any,
        ScheduleController,
      ]);
      expect(roles).toEqual(['TEACHER']);
    });

    it('DELETE /schedule/events/:id is TEACHER only', () => {
      const roles = reflector.getAllAndOverride<string[]>('roles', [
        controller.delete as any,
        ScheduleController,
      ]);
      expect(roles).toEqual(['TEACHER']);
    });

    it('GET /schedule/groups/:groupId/events allows TEACHER, STUDENT and ADMIN', () => {
      const roles = reflector.getAllAndOverride<string[]>('roles', [
        controller.listForGroup as any,
        ScheduleController,
      ]);
      expect(roles).toEqual(['TEACHER', 'STUDENT', 'ADMIN']);
    });
  });
});
