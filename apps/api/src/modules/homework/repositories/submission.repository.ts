import { Injectable } from '@nestjs/common';
import {
  AssignmentModule,
  Feedback,
  Prisma,
  PrismaClient,
  Submission,
  SubmissionStatus,
} from '@prisma/client';

export interface CreateDraftInput {
  assignmentId: string;
  studentId: string;
  enrollmentId: string;
  answersJson?: Prisma.InputJsonValue;
}

export interface UpdateAnswersInput {
  answersJson: Prisma.InputJsonValue;
}

export interface AddFeedbackInput {
  submissionId: string;
  authorType: string;
  authorId: string | null;
  payload: Prisma.InputJsonValue;
  isFinal?: boolean;
}

/**
 * Submission row enriched with the assignment → lesson → group → course
 * chain. Used by SubmissionService to authorise both teacher (owning
 * lesson) and student (APPROVED enrollment in the parent group) callers
 * in a single round trip.
 */
export type SubmissionWithContext = Submission & {
  assignment: {
    id: string;
    lessonId: string;
    totalPoints: number;
    lesson: {
      id: string;
      groupId: string;
      group: {
        id: string;
        course: { teacherId: string };
      };
    };
  };
};

/**
 * SubmissionRepository — Prisma access layer for the `Submission` and
 * `Feedback` tables (Task 18.1, Req 12.1, 12.2, 12.5, 12.7, 12.8).
 *
 * Reads always project the `assignment → lesson → group → course.teacherId`
 * chain so the service can authorize teacher ownership and resolve the
 * group id for student-enrollment checks without re-querying.
 *
 * State transitions are kept conditional (`updateMany` with a `where`
 * filter on the source status) so the repository can report whether a
 * concurrent caller already moved the row — the service layer maps that
 * into a 409 conflict response.
 */
@Injectable()
export class SubmissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ==================================================================
  // Reads
  // ==================================================================

  private static readonly contextSelect = {
    assignment: {
      select: {
        id: true,
        lessonId: true,
        totalPoints: true,
        lesson: {
          select: {
            id: true,
            groupId: true,
            group: {
              select: {
                id: true,
                course: { select: { teacherId: true } },
              },
            },
          },
        },
      },
    },
  } as const;

  async findByIdWithContext(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SubmissionWithContext | null> {
    const client = tx ?? this.prisma;
    return client.submission.findUnique({
      where: { id },
      include: SubmissionRepository.contextSelect,
    }) as unknown as Promise<SubmissionWithContext | null>;
  }

  async findByAssignmentAndStudent(
    assignmentId: string,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SubmissionWithContext | null> {
    const client = tx ?? this.prisma;
    return client.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      include: SubmissionRepository.contextSelect,
    }) as unknown as Promise<SubmissionWithContext | null>;
  }

  async listByAssignment(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
    opts: { take?: number; skip?: number } = {},
  ): Promise<Submission[]> {
    const client = tx ?? this.prisma;
    // Pagination cap (Task 24.2): an assignment can have hundreds of
    // submissions for a popular cohort. Default 50 / max 100 — the
    // teacher grading queue paginates from there.
    const take = Math.min(Math.max(1, opts.take ?? 50), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return client.submission.findMany({
      where: { assignmentId },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    }) as unknown as Promise<Submission[]>;
  }

  /**
   * Resolve `assignment → lesson → group → course.teacherId` in a single
   * query. Used by `createDraft` so the service can validate ownership
   * and derive the group id for the enrollment check before any write.
   */
  async findAssignmentContext(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    assignmentId: string;
    isPublished: boolean;
    lessonId: string;
    groupId: string;
    teacherId: string;
    totalPoints: number;
  } | null> {
    const client = tx ?? this.prisma;
    const row = await client.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        isPublished: true,
        lessonId: true,
        totalPoints: true,
        lesson: {
          select: {
            groupId: true,
            group: { select: { course: { select: { teacherId: true } } } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      assignmentId: row.id,
      isPublished: row.isPublished,
      lessonId: row.lessonId,
      groupId: row.lesson.groupId,
      teacherId: row.lesson.group.course.teacherId,
      totalPoints: row.totalPoints,
    };
  }

  /**
   * Look up the APPROVED Enrollment row for `(groupId, studentId)`.
   * Returns the row id when present so the SubmissionService can stamp
   * `enrollmentId` on the new Submission for downstream auditing.
   */
  async findApprovedEnrollment(
    groupId: string,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string } | null> {
    const client = tx ?? this.prisma;
    const enrollment = await client.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
      select: { id: true, status: true },
    });
    if (!enrollment || enrollment.status !== 'APPROVED') return null;
    return { id: enrollment.id };
  }

  // ==================================================================
  // Writes — DRAFT lifecycle
  // ==================================================================

  /**
   * Insert a fresh DRAFT submission. Race-safe through the
   * `(assignmentId, studentId)` unique constraint; the service layer
   * catches `P2002` and re-fetches the existing row so the create path
   * is idempotent.
   */
  async createDraft(
    input: CreateDraftInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SubmissionWithContext> {
    const client = tx ?? this.prisma;
    return client.submission.create({
      data: {
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        status: 'DRAFT',
        answersJson: input.answersJson ?? ({} as Prisma.InputJsonValue),
      },
      include: SubmissionRepository.contextSelect,
    }) as unknown as Promise<SubmissionWithContext>;
  }

  /**
   * Persist new answers on a DRAFT or RETURNED submission. The service
   * verifies status before calling this method.
   */
  async updateAnswers(
    id: string,
    input: UpdateAnswersInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SubmissionWithContext> {
    const client = tx ?? this.prisma;
    return client.submission.update({
      where: { id },
      data: { answersJson: input.answersJson },
      include: SubmissionRepository.contextSelect,
    }) as unknown as Promise<SubmissionWithContext>;
  }

  // ==================================================================
  // Writes — status transitions
  // ==================================================================

  /**
   * DRAFT or RETURNED → SUBMITTED. Sets `submittedAt = NOW()`. Returns
   * the count of rows that actually transitioned (0 when a concurrent
   * caller already moved the row).
   */
  async transitionToSubmitted(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id, status: { in: ['DRAFT', 'RETURNED'] } },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    return result.count;
  }

  /**
   * SUBMITTED or IN_REVIEW → GRADED. Sets `score` and `gradedAt = NOW()`.
   */
  async transitionToGraded(
    id: string,
    score: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id, status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
      data: { status: 'GRADED', score, gradedAt: new Date() },
    });
    return result.count;
  }

  /**
   * IN_REVIEW or GRADED → RETURNED. Resets `submittedAt` so the student
   * can revise; existing answers are preserved.
   */
  async transitionToReturned(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id, status: { in: ['IN_REVIEW', 'GRADED'] } },
      data: { status: 'RETURNED', submittedAt: null },
    });
    return result.count;
  }

  // ==================================================================
  // Feedback (Req 12.5)
  // ==================================================================

  /**
   * Insert a Feedback row scoped to a submission. The grading flow uses
   * this together with `transitionToGraded` inside a single transaction
   * so that score + feedback land atomically.
   */
  async addFeedback(
    input: AddFeedbackInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Feedback> {
    const client = tx ?? this.prisma;
    return client.feedback.create({
      data: {
        submissionId: input.submissionId,
        authorType: input.authorType,
        authorId: input.authorId,
        payload: input.payload,
        isFinal: input.isFinal ?? false,
      },
    });
  }

  /**
   * Load the AssignmentModule rows for an assignment so the runtime
   * validation path can resolve `moduleId → { type, configJson }`.
   * Returned in `order` ascending so callers can iterate deterministically.
   */
  async listAssignmentModules(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AssignmentModule[]> {
    const client = tx ?? this.prisma;
    return client.assignmentModule.findMany({
      where: { assignmentId },
      orderBy: { order: 'asc' },
    });
  }

  /** Helper for tests — read submission status only. */
  async getStatus(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SubmissionStatus | null> {
    const client = tx ?? this.prisma;
    const row = await client.submission.findUnique({
      where: { id },
      select: { status: true },
    });
    return row?.status ?? null;
  }
}
