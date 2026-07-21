import { Injectable } from '@nestjs/common';
import { Lesson, LessonStatus, LessonType, Prisma, PrismaClient } from '@prisma/client';

export interface CreateLessonInput {
  groupId: string;
  title: string;
  description?: string | null;
  type: LessonType;
  position?: number | undefined;
  scheduledAt?: Date | null;
}

/**
 * LessonRepository — Prisma-based CRUD for the Lesson table (Req 7.4 – 7.6).
 *
 * Notes:
 *   - `create` always sets `status=DRAFT`; the service layer handles the
 *     DRAFT → READY transition through a conditional updateMany so two
 *     concurrent publish calls cannot both succeed (lost-update guard).
 *   - Ownership is verified at the service layer by joining through
 *     `group.course.teacherId` (Req 7.7).
 */
@Injectable()
export class LessonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Lesson | null> {
    const client = tx ?? this.prisma;
    return client.lesson.findUnique({ where: { id } });
  }

  async findByIdWithOwnership(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Lesson & {
        group: { course: { teacherId: string }; courseId: string };
      })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.lesson.findUnique({
      where: { id },
      include: {
        group: {
          select: {
            courseId: true,
            course: { select: { teacherId: true } },
          },
        },
      },
    }) as any;
  }

  async listByGroup(
    groupId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<Lesson[]> {
    // Pagination cap (Task 24.2): lessons per group can grow into the
    // hundreds for long-running cohorts. Default 100 / max 100 — the
    // teacher dashboard paginates client-side from there.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.lesson.findMany({
      where: { groupId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take,
      skip,
    });
  }

  /** Lessons of a group filtered by status — used for STUDENT views (only READY). */
  async listByGroupAndStatus(
    groupId: string,
    status: LessonStatus,
    opts: { take?: number; skip?: number } = {},
  ): Promise<Lesson[]> {
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.lesson.findMany({
      where: { groupId, status },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take,
      skip,
    });
  }

  async create(
    input: CreateLessonInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Lesson> {
    const client = tx ?? this.prisma;
    return client.lesson.create({
      data: {
        groupId: input.groupId,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        position: input.position ?? 0,
        scheduledAt: input.scheduledAt ?? null,
        status: 'DRAFT',
      },
    });
  }

  /**
   * Conditional update scoped to teacher ownership (joins through group/course).
   */
  async updateForTeacher(
    id: string,
    teacherId: string,
    data: Prisma.LessonUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.lesson.updateMany({
      where: { id, group: { course: { teacherId } } },
      data,
    });
  }

  async deleteForTeacher(
    id: string,
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.lesson.deleteMany({
      where: { id, group: { course: { teacherId } } },
    });
  }

  /**
   * Atomic DRAFT → READY transition with optimistic lost-update guard.
   * Returns `true` only when one row actually moved out of DRAFT.
   */
  async transitionDraftToReady(
    id: string,
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.lesson.updateMany({
      where: {
        id,
        status: 'DRAFT',
        group: { course: { teacherId } },
      },
      data: {
        status: 'READY',
        publishedAt: new Date(),
      },
    });
    return result.count > 0;
  }
}
