import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';

import { JwtPayload } from '../auth/tokens.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

/**
 * Unit tests for LiveController (Req 9.1, 9.2, 9.4, 9.5, 9.8, Task 12.6).
 *
 * Scope:
 *   - Each route forwards the right user/lesson identifiers to LiveService.
 *   - The TEACHER/STUDENT/ADMIN role mapping for `join` (the controller
 *     translates STUDENT → STUDENT and TEACHER/ADMIN → TEACHER, since
 *     ADMIN auditors share the producer-capable room role).
 *   - HTTP status decorators on the lifecycle endpoints (`start`, `end`,
 *     `join`) all explicitly return 200 OK so retries from the UI don't
 *     surface phantom 201s.
 *   - Reflected `@Roles(...)` metadata matches the documented contract
 *     so RolesGuard composes correctly with LessonAccessGuard.
 *
 * Strategy: instantiate the controller with a jest-mocked LiveService.
 * No Nest test module is needed — guards and pipes are exercised in
 * their own specs (`lesson-access.guard.spec.ts`, `roles.guard.spec.ts`).
 */
describe('LiveController', () => {
  let controller: LiveController;
  let service: jest.Mocked<LiveService>;

  const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
  const STUDENT_ID = '00000000-0000-0000-0000-0000000000aa';
  const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
  const LESSON_ID = '11111111-1111-1111-1111-111111111111';
  const SESSION_ID = '33333333-3333-3333-3333-333333333333';
  const ROOM_ID = 'router_1';

  const teacherUser: JwtPayload = {
    sub: TEACHER_ID,
    email: 'teacher@example.com',
    role: 'TEACHER',
  };
  const studentUser: JwtPayload = {
    sub: STUDENT_ID,
    email: 'student@example.com',
    role: 'STUDENT',
  };
  const adminUser: JwtPayload = {
    sub: ADMIN_ID,
    email: 'admin@example.com',
    role: 'ADMIN',
  };

  const sfuRoomSnapshot = {
    lessonId: LESSON_ID,
    roomId: ROOM_ID,
    participantCount: 0,
    createdAt: new Date(),
  };

  const liveSession = {
    id: SESSION_ID,
    lessonId: LESSON_ID,
    status: 'LIVE' as LiveSessionStatus,
    startedAt: new Date(),
    endedAt: null,
    roomId: ROOM_ID,
    recorderRef: null,
    shouldRecord: true,
  };

  beforeEach(() => {
    service = {
      startSession: jest.fn(),
      endSession: jest.fn(),
      joinSession: jest.fn(),
      heartbeat: jest.fn(),
      listActiveSessions: jest.fn(),
    } as unknown as jest.Mocked<LiveService>;
    controller = new LiveController(service);
  });

  // ------------------------------------------------------------------
  // start (Req 9.1)
  // ------------------------------------------------------------------

  describe('POST /live/sessions/:lessonId/start', () => {
    it('forwards lessonId + teacher.sub to LiveService.startSession', async () => {
      service.startSession.mockResolvedValue({
        session: liveSession as never,
        sfu: sfuRoomSnapshot,
      });

      const result = await controller.start(teacherUser, LESSON_ID, { record: true });

      expect(service.startSession).toHaveBeenCalledWith(LESSON_ID, TEACHER_ID, true);
      expect(result.session.id).toBe(SESSION_ID);
      expect(result.sfu.roomId).toBe(ROOM_ID);
    });

    it('returns the service result unchanged (idempotent path also works)', async () => {
      const payload = {
        session: liveSession as never,
        sfu: sfuRoomSnapshot,
      };
      service.startSession.mockResolvedValue(payload);

      await expect(
        controller.start(teacherUser, LESSON_ID, { record: true }),
      ).resolves.toBe(payload);
    });

    it('is restricted to TEACHER via @Roles metadata', () => {
      const roles = Reflect.getMetadata('roles', controller.start);
      expect(roles).toEqual(['TEACHER']);
    });

    it('responds with HTTP 200 (not 201) so retries do not surface phantom creates', () => {
      const status = Reflect.getMetadata(
        '__httpCode__',
        controller.start,
      );
      expect(status).toBe(HttpStatus.OK);
    });
  });

  // ------------------------------------------------------------------
  // end (Req 9.5, 9.8)
  // ------------------------------------------------------------------

  describe('POST /live/sessions/:lessonId/end', () => {
    it('forwards lessonId + teacher.sub to LiveService.endSession', async () => {
      service.endSession.mockResolvedValue({
        session: { ...liveSession, status: 'ENDED' as LiveSessionStatus },
        sfu: null,
      });

      await controller.end(teacherUser, LESSON_ID);

      expect(service.endSession).toHaveBeenCalledWith(LESSON_ID, TEACHER_ID);
    });

    it('returns the idempotent terminal payload as-is', async () => {
      const payload = {
        session: { ...liveSession, status: 'ENDED' as LiveSessionStatus },
        sfu: null,
      };
      service.endSession.mockResolvedValue(payload);
      await expect(controller.end(teacherUser, LESSON_ID)).resolves.toBe(
        payload,
      );
    });

    it('is restricted to TEACHER via @Roles metadata', () => {
      const roles = Reflect.getMetadata('roles', controller.end);
      expect(roles).toEqual(['TEACHER']);
    });

    it('responds with HTTP 200 so idempotent re-ends are not surfaced as 201', () => {
      const status = Reflect.getMetadata('__httpCode__', controller.end);
      expect(status).toBe(HttpStatus.OK);
    });
  });

  // ------------------------------------------------------------------
  // join (Req 9.2, 9.4)
  // ------------------------------------------------------------------

  describe('POST /live/sessions/:lessonId/join', () => {
    const joinResult = {
      session: liveSession as never,
      sfu: sfuRoomSnapshot,
      token: 'fake-token',
      role: 'STUDENT' as const,
    };

    it('STUDENT joins as STUDENT room role', async () => {
      service.joinSession.mockResolvedValue(joinResult as never);

      await controller.join(studentUser, LESSON_ID);

      expect(service.joinSession).toHaveBeenCalledWith(
        LESSON_ID,
        STUDENT_ID,
        'STUDENT',
      );
    });

    it('TEACHER joins as TEACHER room role (producer-capable)', async () => {
      service.joinSession.mockResolvedValue({
        ...joinResult,
        role: 'TEACHER',
      } as never);

      await controller.join(teacherUser, LESSON_ID);

      expect(service.joinSession).toHaveBeenCalledWith(
        LESSON_ID,
        TEACHER_ID,
        'TEACHER',
      );
    });

    it('ADMIN joins as TEACHER room role for read-only audit', async () => {
      // The controller maps ADMIN → TEACHER so the audit user gets the
      // same producer-capable room slot as the owning teacher; access
      // gating is handled by LessonAccessGuard upstream.
      service.joinSession.mockResolvedValue({
        ...joinResult,
        role: 'TEACHER',
      } as never);

      await controller.join(adminUser, LESSON_ID);

      expect(service.joinSession).toHaveBeenCalledWith(
        LESSON_ID,
        ADMIN_ID,
        'TEACHER',
      );
    });

    it('returns the service result unchanged', async () => {
      service.joinSession.mockResolvedValue(joinResult as never);
      await expect(controller.join(studentUser, LESSON_ID)).resolves.toBe(
        joinResult,
      );
    });

    it('declares @Roles(TEACHER, STUDENT, ADMIN) — gating is delegated to LessonAccessGuard', () => {
      const roles = Reflect.getMetadata('roles', controller.join);
      expect(roles).toEqual(['TEACHER', 'STUDENT', 'ADMIN']);
    });

    it('responds with HTTP 200 OK', () => {
      const status = Reflect.getMetadata('__httpCode__', controller.join);
      expect(status).toBe(HttpStatus.OK);
    });
  });

  // ------------------------------------------------------------------
  // getCurrent (heartbeat)
  // ------------------------------------------------------------------

  describe('GET /live/sessions/:lessonId', () => {
    it('forwards the lessonId to LiveService.heartbeat', async () => {
      service.heartbeat.mockResolvedValue({
        session: liveSession as never,
        sfu: sfuRoomSnapshot,
      });

      const result = await controller.getCurrent({}, LESSON_ID);

      expect(service.heartbeat).toHaveBeenCalledWith(LESSON_ID);
      expect(result.session.id).toBe(SESSION_ID);
    });

    it('declares @Roles(TEACHER, STUDENT, ADMIN) — gating is delegated to LessonAccessGuard', () => {
      const roles = Reflect.getMetadata('roles', controller.getCurrent);
      expect(roles).toEqual(['TEACHER', 'STUDENT', 'ADMIN']);
    });
  });

  // ------------------------------------------------------------------
  // listMine
  // ------------------------------------------------------------------

  describe('GET /live/sessions', () => {
    it('forwards teacher.sub to LiveService.listActiveSessions', async () => {
      service.listActiveSessions.mockResolvedValue([liveSession] as never);

      const result = await controller.listMine(teacherUser);

      expect(service.listActiveSessions).toHaveBeenCalledWith(TEACHER_ID);
      expect(result).toHaveLength(1);
    });

    it('returns an empty list when no sessions are LIVE for this teacher', async () => {
      service.listActiveSessions.mockResolvedValue([]);
      const result = await controller.listMine(teacherUser);
      expect(result).toEqual([]);
    });

    it('is restricted to TEACHER via @Roles metadata', () => {
      const roles = Reflect.getMetadata('roles', controller.listMine);
      expect(roles).toEqual(['TEACHER']);
    });
  });
});
