import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { LessonAccessGuard } from './lesson-access.guard';

const TEACHER_ID = 'teacher-1';
const OTHER_TEACHER_ID = 'teacher-other';
const STUDENT_ID = 'student-1';
const ADMIN_ID = 'admin-1';
const LESSON_ID = 'lesson-1';
const GROUP_ID = 'group-1';

/**
 * LessonAccessGuard unit tests — Requirements 6.1 – 6.6.
 */
describe('LessonAccessGuard', () => {
  let guard: LessonAccessGuard;
  let prisma: any;

  function makeContext(
    user: { sub: string; role: string } | null,
    params: Record<string, string>,
  ): ExecutionContext {
    const request: any = { user, params };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  function lessonRow(teacherId = TEACHER_ID) {
    return {
      id: LESSON_ID,
      groupId: GROUP_ID,
      title: 'Lesson 1',
      group: {
        id: GROUP_ID,
        course: {
          teacherId,
        },
      },
    };
  }

  beforeEach(() => {
    prisma = {
      lesson: { findUnique: jest.fn() },
      enrollment: { findUnique: jest.fn() },
    };
    guard = new LessonAccessGuard(prisma as any);
  });

  // ------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------

  it('rejects requests without an authenticated user', async () => {
    const ctx = makeContext(null, { id: LESSON_ID });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws 404 when no lesson id is in route params', async () => {
    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 404 when the lesson does not exist', async () => {
    prisma.lesson.findUnique.mockResolvedValue(null);
    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ------------------------------------------------------------------
  // ADMIN (Req 6.4)
  // ------------------------------------------------------------------

  it('always allows ADMIN (read-only audit access) — Req 6.4', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    const ctx = makeContext({ sub: ADMIN_ID, role: 'ADMIN' }, {
      id: LESSON_ID,
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // The enrollment table should NOT have been queried for an ADMIN.
    expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // TEACHER (Req 6.3, 6.5)
  // ------------------------------------------------------------------

  it('allows TEACHER for a lesson in their own course — Req 6.3', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow(TEACHER_ID));
    const ctx = makeContext({ sub: TEACHER_ID, role: 'TEACHER' }, {
      id: LESSON_ID,
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects TEACHER for a lesson belonging to a different teacher with NOT_OWNING_TEACHER — Req 6.5', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow(OTHER_TEACHER_ID));
    const ctx = makeContext({ sub: TEACHER_ID, role: 'TEACHER' }, {
      id: LESSON_ID,
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'NOT_OWNING_TEACHER' },
    });
    await expect(
      guard.canActivate(
        makeContext({ sub: TEACHER_ID, role: 'TEACHER' }, { id: LESSON_ID }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ------------------------------------------------------------------
  // STUDENT (Req 6.1, 6.2, 6.6)
  // ------------------------------------------------------------------

  it('allows STUDENT with an APPROVED enrollment — Req 6.1', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    prisma.enrollment.findUnique.mockResolvedValue({
      id: 'enrollment-1',
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'APPROVED',
    });

    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
      where: {
        groupId_studentId: { groupId: GROUP_ID, studentId: STUDENT_ID },
      },
    });
  });

  it('rejects STUDENT without an Enrollment row with LESSON_ACCESS_DENIED — Req 6.2', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    prisma.enrollment.findUnique.mockResolvedValue(null);

    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'LESSON_ACCESS_DENIED' },
    });
  });

  it('rejects STUDENT whose Enrollment is not APPROVED (e.g. REVOKED) — Req 6.6', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    prisma.enrollment.findUnique.mockResolvedValue({
      id: 'enrollment-1',
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'REVOKED',
    });

    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'LESSON_ACCESS_DENIED' },
    });
  });

  it('does not bypass enrollment even if the student paid (PENDING_APPROVAL) — Req 6.6', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    prisma.enrollment.findUnique.mockResolvedValue({
      id: 'enrollment-1',
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'PENDING_APPROVAL',
    });

    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each(['REJECTED', 'PAUSED'])(
    'rejects STUDENT whose Enrollment status is %s — Req 6.6',
    async (status) => {
      prisma.lesson.findUnique.mockResolvedValue(lessonRow());
      prisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status,
      });

      const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
        id: LESSON_ID,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: { code: 'LESSON_ACCESS_DENIED' },
      });
    },
  );

  // ------------------------------------------------------------------
  // Lesson caching on the request
  // ------------------------------------------------------------------

  it('attaches the resolved lesson to the request for downstream handlers', async () => {
    const lesson = lessonRow();
    prisma.lesson.findUnique.mockResolvedValue(lesson);
    prisma.enrollment.findUnique.mockResolvedValue({
      id: 'enrollment-1',
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'APPROVED',
    });

    const ctx = makeContext({ sub: STUDENT_ID, role: 'STUDENT' }, {
      id: LESSON_ID,
    });
    await guard.canActivate(ctx);

    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.lesson).toBe(lesson);
  });

  // ------------------------------------------------------------------
  // Param extraction
  // ------------------------------------------------------------------

  it('reads lesson id from params.lessonId for nested routes', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    const ctx = makeContext({ sub: TEACHER_ID, role: 'TEACHER' }, {
      lessonId: LESSON_ID,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.lesson.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LESSON_ID } }),
    );
  });

  // ------------------------------------------------------------------
  // Unknown role
  // ------------------------------------------------------------------

  it('rejects unknown roles with FORBIDDEN_ROLE', async () => {
    prisma.lesson.findUnique.mockResolvedValue(lessonRow());
    const ctx = makeContext({ sub: 'u', role: 'UNKNOWN' }, { id: LESSON_ID });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
