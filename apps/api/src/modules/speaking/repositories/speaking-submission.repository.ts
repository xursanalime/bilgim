import { Injectable } from '@nestjs/common';
import {
  Feedback,
  HomeworkModuleType,
  Prisma,
  PrismaClient,
  Submission,
  SubmissionStatus,
} from '@prisma/client';

/**
 * AssignmentModule row enriched with the assignment → lesson → group →
 * course chain. Mirrors the projection `SubmissionRepository` uses in the
 * Homework module so the Speaking service can authorise the enrolled
 * learner (APPROVED enrollment in the parent group) and confirm the
 * module is a SPEAKING/PRONUNCIATION type in a single round trip.
 */
export interface SpeakingModuleContext {
  moduleId: string;
  moduleType: HomeworkModuleType;
  assignmentId: string;
  isPublished: boolean;
  lessonId: string;
  groupId: string;
  teacherId: string;
}

/**
 * Submission projection used by the AI scoring + instructor override
 * flow (Task 4.2, Req 7.3, 7.4, 7.6). Carries the lifecycle status, the
 * stored `answersJson` (so the service can locate the AUDIO answer
 * slice), the scaling `totalPoints`, and the owning `teacherId` so the
 * override path can authorise the instructor without a second query.
 */
export interface SpeakingScoringContext {
  submissionId: string;
  status: SubmissionStatus;
  studentId: string;
  assignmentId: string;
  answersJson: Prisma.JsonValue | null;
  totalPoints: number;
  teacherId: string;
  /** AssignmentModule rows (id + type) so the service can find the
   *  SPEAKING/PRONUNCIATION module the audio answer belongs to. */
  modules: Array<{ id: string; type: HomeworkModuleType }>;
}

/**
 * SpeakingSubmissionRepository — Prisma access layer for the Speaking
 * module (Req 7.1, 7.2).
 *
 * Kept deliberately thin and self-contained (it owns no business rules)
 * so the Speaking_Assessment_Module does not couple to the Homework
 * module's repositories while those evolve in parallel. The audio
 * MediaAsset reference is persisted into the existing `Submission`
 * `answersJson` Json column under the speaking module's id — the same
 * per-module convention the Homework submission flow already uses — so
 * no schema change is required to associate the asset with the
 * submission.
 */
@Injectable()
export class SpeakingSubmissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolve an AssignmentModule together with the ownership chain needed
   * for authorization. Returns `null` when the module does not exist or
   * does not belong to the given assignment.
   */
  async findModuleContext(
    assignmentId: string,
    moduleId: string,
  ): Promise<SpeakingModuleContext | null> {
    const row = await this.prisma.assignmentModule.findFirst({
      where: { id: moduleId, assignmentId },
      select: {
        id: true,
        type: true,
        assignmentId: true,
        assignment: {
          select: {
            isPublished: true,
            lessonId: true,
            lesson: {
              select: {
                groupId: true,
                group: { select: { course: { select: { teacherId: true } } } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    return {
      moduleId: row.id,
      moduleType: row.type,
      assignmentId: row.assignmentId,
      isPublished: row.assignment.isPublished,
      lessonId: row.assignment.lessonId,
      groupId: row.assignment.lesson.groupId,
      teacherId: row.assignment.lesson.group.course.teacherId,
    };
  }

  /**
   * Look up the APPROVED Enrollment row for `(groupId, studentId)`.
   * Returns the row id when present so the service can stamp
   * `enrollmentId` on a freshly created Submission.
   */
  async findApprovedEnrollment(
    groupId: string,
    studentId: string,
  ): Promise<{ id: string } | null> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
      select: { id: true, status: true },
    });
    if (!enrollment || enrollment.status !== 'APPROVED') return null;
    return { id: enrollment.id };
  }

  /**
   * Idempotently fetch (or create) the learner's DRAFT submission for an
   * assignment. Race-safe through the `(assignmentId, studentId)` unique
   * constraint — a concurrent create surfaces as `P2002`, which the
   * caller resolves by re-reading.
   */
  async getOrCreateDraftSubmission(input: {
    assignmentId: string;
    studentId: string;
    enrollmentId: string;
  }): Promise<Submission> {
    const existing = await this.prisma.submission.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId: input.assignmentId,
          studentId: input.studentId,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.submission.create({
      data: {
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        status: 'DRAFT',
        answersJson: {} as Prisma.InputJsonValue,
      },
    });
  }

  async findSubmissionById(id: string): Promise<Submission | null> {
    return this.prisma.submission.findUnique({ where: { id } });
  }

  /**
   * Replace the submission's `answersJson`. The service merges the new
   * audio answer slice into the existing object before calling this so
   * other modules' answers are preserved.
   */
  async updateAnswers(
    submissionId: string,
    answersJson: Prisma.InputJsonValue,
  ): Promise<Submission> {
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: { answersJson },
    });
  }

  // ==================================================================
  // AI scoring + instructor override (Task 4.2, Req 7.3, 7.4, 7.6)
  // ==================================================================

  /**
   * Load the projection the scoring + override flow needs: lifecycle
   * status, stored answers (to locate the AUDIO slice), the scaling
   * `totalPoints`, the owning `teacherId`, and the assignment modules.
   * Returns `null` when the submission does not exist.
   */
  async findScoringContext(
    submissionId: string,
  ): Promise<SpeakingScoringContext | null> {
    const row = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        studentId: true,
        assignmentId: true,
        answersJson: true,
        assignment: {
          select: {
            totalPoints: true,
            modules: { select: { id: true, type: true } },
            lesson: {
              select: {
                group: { select: { course: { select: { teacherId: true } } } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    return {
      submissionId: row.id,
      status: row.status,
      studentId: row.studentId,
      assignmentId: row.assignmentId,
      answersJson: row.answersJson,
      totalPoints: row.assignment.totalPoints,
      teacherId: row.assignment.lesson.group.course.teacherId,
      modules: row.assignment.modules,
    };
  }

  /**
   * Idempotency guard — return the existing AI_DRAFT Feedback row for a
   * submission (if any) so a re-delivered scoring job does not write a
   * second draft.
   */
  async findAiDraftFeedback(
    submissionId: string,
    authorType: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string } | null> {
    const client = tx ?? this.prisma;
    return client.feedback.findFirst({
      where: { submissionId, authorType },
      select: { id: true },
    });
  }

  /** Insert a Feedback row (AI draft or teacher override). */
  async createFeedback(
    input: {
      submissionId: string;
      authorType: string;
      authorId: string | null;
      payload: Prisma.InputJsonValue;
      isFinal?: boolean;
    },
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
   * SUBMITTED → IN_REVIEW, optionally stamping the AI draft `score`.
   * Guarded on the source status so a concurrent teacher grade
   * transition is never overwritten. Returns the count of rows moved
   * (0 when a concurrent caller already moved the row).
   */
  async transitionToInReview(
    submissionId: string,
    score: number | null,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id: submissionId, status: 'SUBMITTED' },
      data: {
        status: 'IN_REVIEW',
        ...(score !== null ? { score } : {}),
      },
    });
    return result.count;
  }

  /**
   * Overwrite the submission `score` with the instructor's overridden
   * value WITHOUT changing the lifecycle status (Req 7.6 — the override
   * happens before GRADED; the final GRADED transition stays on the
   * existing homework grade path). Guarded so it only applies while the
   * submission is still pre-GRADED (SUBMITTED / IN_REVIEW).
   */
  async overrideScore(
    submissionId: string,
    score: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id: submissionId, status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
      data: { score },
    });
    return result.count;
  }

  /**
   * pre-GRADED (SUBMITTED / IN_REVIEW) → GRADED, stamping the final
   * `score` and `gradedAt` (Task 4.3, Req 15.3). Guarded on the source
   * status so a concurrent caller (or a replayed grade) never re-grades
   * an already-terminal submission. Returns the count of rows moved
   * (0 when the window was already closed).
   */
  async transitionToGraded(
    submissionId: string,
    score: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.submission.updateMany({
      where: { id: submissionId, status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
      data: { status: 'GRADED', score, gradedAt: new Date() },
    });
    return result.count;
  }

  /** Read submission status only (helper for tests / guards). */
  async getStatus(submissionId: string): Promise<SubmissionStatus | null> {
    const row = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  /** Run a function inside a Prisma interactive transaction. */
  async runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
