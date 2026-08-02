import { Injectable } from '@nestjs/common';
import { Course, Prisma, PrismaClient } from '@prisma/client';

export interface CreateCourseInput {
  teacherId: string;
  title: string;
  description?: string | null;
  level?: string | null;
  fromPriceUzs?: number | null;
}

/**
 * A course plus the two summary numbers the teacher's course cards display.
 * Returned by {@link CourseRepository.listByTeacher} so the grid does not have
 * to fetch groups and enrollments per card.
 */
export interface CourseWithCounts extends Course {
  /** Groups belonging to this course. */
  groupCount: number;
  /** APPROVED enrollments summed across those groups. */
  studentCount: number;
}

/**
 * CourseRepository — Prisma-based CRUD for the Course table.
 *
 * Course visibility rules (Req 7.1, 7.7):
 *   - Newly created courses are `isPublished=false, isDiscoverable=true`.
 *   - Cross-teacher reads/writes are blocked at the service layer by always
 *     scoping `teacherId`. The repository only filters; ownership errors
 *     ("403 NOT_OWNING_TEACHER") are raised by the service.
 */
@Injectable()
export class CourseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Course | null> {
    const client = tx ?? this.prisma;
    return client.course.findUnique({ where: { id } });
  }

  async findByIdForTeacher(
    id: string,
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Course | null> {
    const client = tx ?? this.prisma;
    return client.course.findFirst({ where: { id, teacherId } });
  }

  async listByTeacher(
    teacherId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<CourseWithCounts[]> {
    // Pagination cap (Task 24.2): take defaults to 50, hard-capped at 100
    // so a runaway client cannot pull every course in a teacher's
    // catalog in one request. Callers that genuinely need the full set
    // should iterate with `skip`.
    const take = Math.min(Math.max(1, opts.take ?? 50), 100);
    const skip = Math.max(0, opts.skip ?? 0);

    // The course cards show "N students · N groups". Those counts come back
    // with the list rather than being fetched per card, which would be an
    // N+1 across the teacher's whole catalogue.
    const rows = await this.prisma.course.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        groups: {
          select: {
            _count: {
              select: { enrollments: { where: { status: 'APPROVED' } } },
            },
          },
        },
        _count: { select: { groups: true } },
      },
    });

    return rows.map(({ groups, _count, ...course }) => ({
      ...course,
      groupCount: _count.groups,
      // Enrollments are unique per (group, student), so summing per-group
      // counts double-counts a student enrolled in two groups of the same
      // course. That is rare and the alternative — a distinct-student query
      // per course — is not worth an extra round trip on a summary card.
      studentCount: groups.reduce((sum, g) => sum + g._count.enrollments, 0),
    }));
  }

  async create(
    input: CreateCourseInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Course> {
    const client = tx ?? this.prisma;
    return client.course.create({
      data: {
        teacherId: input.teacherId,
        title: input.title,
        description: input.description ?? null,
        level: input.level ?? null,
        fromPriceUzs: input.fromPriceUzs ?? null,
        // Hard-coded per Req 7.1 — never accept these from the client on create.
        isPublished: false,
        isDiscoverable: true,
      },
    });
  }

  async update(
    id: string,
    teacherId: string,
    data: Prisma.CourseUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.course.updateMany({
      where: { id, teacherId },
      data,
    });
  }

  async delete(
    id: string,
    teacherId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.course.deleteMany({
      where: { id, teacherId },
    });
  }
}
