import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Lesson with the parent chain we need for access decisions. Re-used by
 * controllers via `request.lesson` to avoid an extra DB hop.
 */
export type LessonWithGroup = NonNullable<
  Awaited<ReturnType<LessonAccessGuard['loadLesson']>>
>;

/**
 * LessonAccessGuard — enforces enrollment-gated access to a lesson
 * (Requirement 6.1 – 6.6).
 *
 * The guard reads the lesson id from one of the standard route params
 * (`lessonId`, `id`) so it works on both `/lessons/:id/...` and any
 * resource nested under `/lessons/:lessonId/...`.
 *
 * Rules:
 *  - STUDENT: must have `Enrollment(groupId, studentId, status=APPROVED)`,
 *    else 403 LESSON_ACCESS_DENIED. The guard NEVER bypasses this — even
 *    if the student paid but is not yet APPROVED (Req 6.6).
 *  - TEACHER: must own the lesson's course
 *    (`lesson.group.course.teacherId == user.id`), else 403
 *    NOT_OWNING_TEACHER (Req 6.3, 6.5).
 *  - ADMIN: read-only audit access — always allowed (Req 6.4).
 *
 * Side effect: the resolved lesson is attached to `request.lesson` so
 * downstream handlers can read it without re-querying.
 */
@Injectable()
export class LessonAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { sub: string; role: string }
      | null
      | undefined;

    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    const lessonId = this.extractLessonId(request);
    if (!lessonId) {
      // No lesson id on the route → guard is mis-applied. Fail closed.
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: 'Lesson id not present on route',
      });
    }

    const lesson = await this.loadLesson(lessonId);
    if (!lesson) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: 'Lesson not found',
      });
    }

    // Cache the resolved lesson on the request for downstream handlers.
    request.lesson = lesson;

    switch (user.role) {
      case 'ADMIN':
        // Read-only audit access (Req 6.4). The guard does not make
        // write decisions — controllers enforce per-route auth on
        // mutating endpoints.
        return true;

      case 'TEACHER':
        if (lesson.group.course.teacherId !== user.sub) {
          throw new ForbiddenException({
            code: 'NOT_OWNING_TEACHER',
            message: 'You can only access lessons for your own courses',
          });
        }
        return true;

      case 'STUDENT': {
        const enrollment = await this.prisma.enrollment.findUnique({
          where: {
            groupId_studentId: {
              groupId: lesson.groupId,
              studentId: user.sub,
            },
          },
        });
        if (!enrollment || enrollment.status !== 'APPROVED') {
          throw new ForbiddenException({
            code: 'LESSON_ACCESS_DENIED',
            message:
              'You do not have approved access to this lesson. Pay and wait for teacher approval to enroll.',
          });
        }
        return true;
      }

      default:
        throw new ForbiddenException({
          code: 'FORBIDDEN_ROLE',
          message: `Role ${user.role} is not allowed to access lessons`,
        });
    }
  }

  /**
   * Pull the lesson id from the route. Supports two conventions:
   *   - `/lessons/:id/...`               → params.id
   *   - `/.../lessons/:lessonId/...`     → params.lessonId
   */
  private extractLessonId(request: {
    params?: Record<string, string>;
  }): string | null {
    const params = request.params ?? {};
    return params['lessonId'] ?? params['id'] ?? null;
  }

  /**
   * Load the lesson with the group + course chain we need for the access
   * decisions. Returned object is also assigned to `request.lesson`.
   */
  async loadLesson(lessonId: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        group: {
          include: {
            course: true,
          },
        },
        attachments: {
          include: {
            asset: {
              select: {
                id: true,
                kind: true,
                status: true,
                bytes: true,
                contentType: true,
                metadata: true,
                createdAt: true,
              },
            },
          },
          orderBy: {
            position: 'asc',
          },
        },
      },
    });

    if (!lesson) return null;

    // Convert BigInt bytes to number safely for response serialization
    if (lesson.attachments) {
      lesson.attachments = lesson.attachments.map((att) => {
        if (att.asset && att.asset.bytes !== null) {
          (att.asset as any).bytes = Number(att.asset.bytes);
        }
        return att;
      }) as any;
    }

    return lesson;
  }
}
