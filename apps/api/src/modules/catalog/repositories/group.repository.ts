import { Injectable } from '@nestjs/common';
import { Group, Prisma, PrismaClient } from '@prisma/client';

export interface CreateGroupInput {
  courseId: string;
  name: string;
  priceUzs: number;
  capacity?: number | null;
  startsOn?: Date | null;
  endsOn?: Date | null;
  joinCode?: string | null;
}

/**
 * GroupRepository — Prisma-based CRUD for the Group table.
 *
 * Cross-teacher safety: the service layer joins through `course.teacherId`
 * to authorize reads and writes (Req 7.7).
 */
@Injectable()
export class GroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<(Group & { course: { teacherId: string } }) | null> {
    const client = tx ?? this.prisma;
    return client.group.findUnique({
      where: { id },
      include: { course: { select: { teacherId: true } } },
    }) as Promise<(Group & { course: { teacherId: string } }) | null>;
  }

  /**
   * Resolve a group together with its teacher's `specialtyId`, used by the
   * per-Group module toggle endpoint (Task 17.2) — toggling a moduleType
   * requires confirming it lives in the teacher's `SpecialtyModule` catalog.
   *
   * Returns `null` if either the group or the parent `TeacherProfile` is
   * missing. The teacher record is mandatory in normal flows (a course
   * cannot exist without a teacher) but the SQL `LEFT JOIN` keeps this
   * defensive against truncated test fixtures.
   */
  async findByIdWithTeacherSpecialty(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Group & {
        course: {
          teacherId: string;
          teacher: { specialtyId: string | null } | null;
        };
      })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.group.findUnique({
      where: { id },
      include: {
        course: {
          select: {
            teacherId: true,
            teacher: { select: { specialtyId: true } },
          },
        },
      },
    }) as Promise<
      | (Group & {
          course: {
            teacherId: string;
            teacher: { specialtyId: string | null } | null;
          };
        })
      | null
    >;
  }

  async listByCourse(
    courseId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<Group[]> {
    // Pagination cap (Task 24.2): groups per course are usually small
    // (≤ 50) but we still bound the result set so a misconfigured
    // course can't blow the response budget.
    const take = Math.min(Math.max(1, opts.take ?? 50), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.group.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async create(
    input: CreateGroupInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Group> {
    const client = tx ?? this.prisma;
    return client.group.create({
      data: {
        courseId: input.courseId,
        name: input.name,
        priceUzs: input.priceUzs,
        capacity: input.capacity ?? null,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        joinCode: input.joinCode ?? null,
      },
    });
  }

  /**
   * Conditional update scoped to teacher ownership: matches a row only when
   * its parent course's teacherId equals `teacherId`. Returns `count = 0`
   * if the group does not exist or belongs to another teacher.
   */
  async updateForTeacher(
    id: string,
    teacherId: string,
    data: Prisma.GroupUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.group.updateMany({
      where: { id, course: { teacherId } },
      data,
    });
  }

  async deleteForTeacher(
    id: string,
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.group.deleteMany({
      where: { id, course: { teacherId } },
    });
  }

  /**
   * Unscoped update by id — used for the ADMIN path of the group-settings
   * toggle (`downloadAllowed`), where authorization is enforced at the
   * service layer (ADMIN bypass) rather than via a teacher-ownership join.
   * Teacher writes go through {@link updateForTeacher} so they stay scoped
   * to `course.teacherId`. Returns `count = 0` when the group is missing.
   */
  async updateById(
    id: string,
    data: Prisma.GroupUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.group.updateMany({ where: { id }, data });
  }
}
