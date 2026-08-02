import { Injectable } from '@nestjs/common';
import {
  Assignment,
  AssignmentModule,
  HomeworkModuleType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export interface AssignmentModuleSeedInput {
  type: HomeworkModuleType;
  order: number;
  configJson: unknown;
  weight: number;
}

export interface CreateAssignmentInput {
  lessonId: string;
  title: string;
  description?: string | null;
  dueAt?: Date | null;
  totalPoints?: number;
  isPublished?: boolean;
  modules: AssignmentModuleSeedInput[];
}

export interface UpdateAssignmentScalarInput {
  title?: string;
  description?: string | null;
  dueAt?: Date | null;
  totalPoints?: number;
  isPublished?: boolean;
}

/**
 * AssignmentRepository — Prisma access layer for the `Assignment` and
 * `AssignmentModule` tables (Task 17.3, Req 11.5, 11.8).
 *
 * Reads always join through `lesson.group.course.teacherId` so callers
 * can authorize ownership in a single query (no two-step fetch).
 *
 * Writes are kept small and explicit; transactional composition lives in
 * the service layer so create/update/replace flows can wrap them in one
 * `$transaction` together with the outbox emission.
 */
@Injectable()
export class AssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ==================================================================
  // Reads
  // ==================================================================

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Assignment & {
        modules: AssignmentModule[];
      })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.assignment.findUnique({
      where: { id },
      include: { modules: { orderBy: { order: 'asc' } } },
    });
  }

  /**
   * Load an assignment + ownership context (lesson → group → course →
   * teacherId). Used by the service layer to verify the caller owns the
   * assignment in a single round trip.
   */
  async findByIdWithOwnership(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Assignment & {
        modules: AssignmentModule[];
        attachments: Array<{
          id: string;
          assetId: string;
          kind: string;
          role: string;
          position: number;
          caption: string | null;
          createdAt: Date;
          asset: {
            id: string;
            kind: string;
            status: string;
            bytes: bigint | null;
            contentType: string | null;
            metadata: unknown;
            createdAt: Date;
          };
        }>;
        lesson: {
          id: string;
          groupId: string;
          group: { id: string; courseId: string; course: { teacherId: string } };
        };
      })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.assignment.findUnique({
      where: { id },
      include: {
        modules: { orderBy: { order: 'asc' } },
        attachments: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
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
        },
        lesson: {
          select: {
            id: true,
            groupId: true,
            group: {
              select: {
                id: true,
                courseId: true,
                course: { select: { teacherId: true } },
              },
            },
          },
        },
      },
    }) as any;
  }

  /**
   * `lesson.groupId` + `lesson.group.course.teacherId` lookup used to
   * authorize the create flow without fetching the full lesson row.
   */
  async findLessonOwnership(
    lessonId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ groupId: string; teacherId: string } | null> {
    const client = tx ?? this.prisma;
    const row = await client.lesson.findUnique({
      where: { id: lessonId },
      select: {
        groupId: true,
        group: { select: { course: { select: { teacherId: true } } } },
      },
    });
    if (!row) return null;
    return {
      groupId: row.groupId,
      teacherId: row.group.course.teacherId,
    };
  }

  async listByLesson(
    lessonId: string,
    tx?: Prisma.TransactionClient,
    opts: { take?: number; skip?: number } = {},
  ): Promise<(Assignment & { modules: AssignmentModule[] })[]> {
    const client = tx ?? this.prisma;
    // Pagination cap (Task 24.2): a single lesson rarely has more than
    // a handful of assignments; capping at 100 protects the JSON
    // response size when a teacher mass-imports a question bank.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return client.assignment.findMany({
      where: { lessonId },
      include: { modules: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    });
  }

  /** Count submissions for an assignment — used by the delete guard. */
  async countSubmissions(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.submission.count({ where: { assignmentId } });
  }

  // ==================================================================
  // Writes
  // ==================================================================

  /**
   * Create an `Assignment` together with its `AssignmentModule` rows in
   * a single `nestedCreate`. Caller is responsible for opening the
   * surrounding transaction so the outbox emission commits atomically.
   */
  async createWithModules(
    input: CreateAssignmentInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Assignment & { modules: AssignmentModule[] }> {
    const client = tx ?? this.prisma;
    return client.assignment.create({
      data: {
        lessonId: input.lessonId,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        totalPoints: input.totalPoints ?? 100,
        isPublished: input.isPublished ?? false,
        modules: {
          create: input.modules.map((m) => ({
            type: m.type,
            order: m.order,
            configJson: m.configJson as Prisma.InputJsonValue,
            weight: m.weight,
          })),
        },
      },
      include: { modules: { orderBy: { order: 'asc' } } },
    });
  }

  /** Patch the scalar columns on an Assignment row. Returns the new row. */
  async updateScalars(
    id: string,
    input: UpdateAssignmentScalarInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Assignment & { modules: AssignmentModule[] }> {
    const client = tx ?? this.prisma;
    return client.assignment.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.dueAt !== undefined && { dueAt: input.dueAt }),
        ...(input.totalPoints !== undefined && { totalPoints: input.totalPoints }),
        ...(input.isPublished !== undefined && { isPublished: input.isPublished }),
      },
      include: { modules: { orderBy: { order: 'asc' } } },
    });
  }

  /**
   * Replace the entire `AssignmentModule` set for an assignment. Used by
   * the update endpoint when the caller submits a new `modules` array.
   * Atomic when invoked inside a `$transaction`.
   */
  async replaceModules(
    assignmentId: string,
    modules: AssignmentModuleSeedInput[],
    tx?: Prisma.TransactionClient,
  ): Promise<AssignmentModule[]> {
    const client = tx ?? this.prisma;
    await client.assignmentModule.deleteMany({ where: { assignmentId } });
    if (modules.length === 0) return [];
    await client.assignmentModule.createMany({
      data: modules.map((m) => ({
        assignmentId,
        type: m.type,
        order: m.order,
        configJson: m.configJson as Prisma.InputJsonValue,
        weight: m.weight,
      })),
    });
    return client.assignmentModule.findMany({
      where: { assignmentId },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Conditional publish flip — succeeds only when the current row state
   * is still `isPublished=false`. Returns `true` when one row moved.
   */
  async transitionToPublished(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.assignment.updateMany({
      where: { id, isPublished: false },
      data: { isPublished: true },
    });
    return result.count > 0;
  }

  async deleteById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.assignment.deleteMany({ where: { id } });
  }
}
