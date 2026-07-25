import { WsException } from '@nestjs/websockets';
import type { PrismaClient } from '@prisma/client';

import type { WsAuthUser } from '../chat/ws-jwt.guard';

/**
 * Outcome of a successful lesson-access check. `isOwningTeacher` is the
 * "may moderate this room" bit — true for the teacher who owns the
 * lesson's course and for ADMIN, false for enrolled students. Handlers
 * that perform privileged actions (kick, force-mute) must gate on this
 * rather than on `user.role === 'TEACHER'`, which would let any teacher
 * on the platform moderate a colleague's classroom.
 */
export interface WsLessonAccess {
  lessonId: string;
  groupId: string;
  isOwningTeacher: boolean;
}

/**
 * The single WebSocket lesson-access policy, shared by `LiveGateway`
 * (SFU signalling) and `LiveChatGateway`.
 *
 * Mirrors the HTTP `LessonAccessGuard` (Req 6.1 – 6.6):
 *  - ADMIN: always allowed, treated as a moderator
 *  - TEACHER: must own the lesson's course
 *  - STUDENT: must hold an APPROVED enrollment in the lesson's group
 *
 * Throws `WsException` (not `ForbiddenException`) so the Socket.io error
 * pipeline produces a structured payload the client can branch on.
 *
 * Kept as a free function rather than an injectable service so both
 * gateways can call it without a shared module import cycle — the only
 * dependency is the `PrismaClient` each gateway already holds.
 */
export async function assertWsLessonAccess(
  prisma: PrismaClient,
  user: WsAuthUser,
  lessonId: string,
): Promise<WsLessonAccess> {
  if (typeof lessonId !== 'string' || lessonId.length === 0) {
    throw new WsException({
      code: 'LESSON_ID_REQUIRED',
      message: 'lessonId is required',
    });
  }

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      groupId: true,
      group: { select: { course: { select: { teacherId: true } } } },
    },
  });
  if (!lesson) {
    throw new WsException({
      code: 'LESSON_NOT_FOUND',
      message: `Lesson ${lessonId} not found`,
    });
  }

  switch (user.role) {
    case 'ADMIN':
      return { lessonId: lesson.id, groupId: lesson.groupId, isOwningTeacher: true };

    case 'TEACHER':
      if (lesson.group.course.teacherId !== user.sub) {
        throw new WsException({
          code: 'NOT_OWNING_TEACHER',
          message: 'You can only join lessons for your own courses',
        });
      }
      return { lessonId: lesson.id, groupId: lesson.groupId, isOwningTeacher: true };

    case 'STUDENT': {
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          groupId_studentId: { groupId: lesson.groupId, studentId: user.sub },
        },
        select: { status: true },
      });
      if (!enrollment || enrollment.status !== 'APPROVED') {
        throw new WsException({
          code: 'LESSON_ACCESS_DENIED',
          message:
            'You do not have approved access to this lesson. Pay and wait for teacher approval to enroll.',
        });
      }
      return { lessonId: lesson.id, groupId: lesson.groupId, isOwningTeacher: false };
    }

    default:
      throw new WsException({
        code: 'FORBIDDEN_ROLE',
        message: `Role ${user.role} is not allowed to join a live lesson`,
      });
  }
}
