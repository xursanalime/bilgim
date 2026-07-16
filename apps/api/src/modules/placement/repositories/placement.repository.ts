import { Injectable } from '@nestjs/common';
import {
  CefrLevel,
  PlacementAnswer,
  PlacementAssessment,
  Prisma,
  PrismaClient,
} from '@prisma/client';

/** A PlacementAssessment together with its persisted answers. */
export type AssessmentWithAnswers = PlacementAssessment & {
  answers: PlacementAnswer[];
};

/**
 * PlacementRepository — Prisma data access for PlacementAssessment and
 * PlacementAnswer (Task 3.1).
 *
 * The `(assessmentId, questionRef)` UNIQUE index (see `schema.prisma`) makes
 * answer persistence idempotent: re-submitting the same question upserts the
 * single existing row, which is what makes the assessment resumable (Req 5.4).
 */
@Injectable()
export class PlacementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Ensure a StudentProfile exists for the user before creating an
   * assessment. `PlacementAssessment.learnerId` FKs to
   * `StudentProfile.userId`, so this must run first (same pattern as
   * EnrollmentRepository.ensureStudentProfile).
   */
  async ensureStudentProfile(
    userId: string,
    primaryLocale = 'uz',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.studentProfile.upsert({
      where: { userId },
      create: { userId, primaryLocale },
      update: {},
    });
  }

  /** Create a fresh IN_PROGRESS assessment for the learner. */
  async createAssessment(
    learnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AssessmentWithAnswers> {
    const client = tx ?? this.prisma;
    return client.placementAssessment.create({
      data: { learnerId, status: 'IN_PROGRESS' },
      include: { answers: true },
    });
  }

  /** Latest IN_PROGRESS assessment for a learner, if any (for resume-on-start). */
  async findInProgressForLearner(
    learnerId: string,
  ): Promise<AssessmentWithAnswers | null> {
    return this.prisma.placementAssessment.findFirst({
      where: { learnerId, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
      include: { answers: true },
    });
  }

  /** Load an assessment with its answers by id. */
  async findById(id: string): Promise<AssessmentWithAnswers | null> {
    return this.prisma.placementAssessment.findUnique({
      where: { id },
      include: { answers: true },
    });
  }

  /**
   * Persist (insert or update) a single answer for an assessment. Idempotent
   * on `(assessmentId, questionRef)` — re-answering a question overwrites the
   * previous response rather than creating a duplicate (Req 5.4).
   */
  async upsertAnswer(
    input: {
      assessmentId: string;
      skill: string;
      questionRef: string;
      answer: Prisma.InputJsonValue;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<PlacementAnswer> {
    const client = tx ?? this.prisma;
    return client.placementAnswer.upsert({
      where: {
        assessmentId_questionRef: {
          assessmentId: input.assessmentId,
          questionRef: input.questionRef,
        },
      },
      create: {
        assessmentId: input.assessmentId,
        skill: input.skill,
        questionRef: input.questionRef,
        answer: input.answer,
      },
      update: {
        skill: input.skill,
        answer: input.answer,
      },
    });
  }

  /**
   * Atomically transition an assessment from IN_PROGRESS → SCORED, writing the
   * per-skill scores, computed CEFR level and submission time (Task 3.2,
   * Req 5.2, 5.5).
   *
   * Uses an optimistic `updateMany` guarded on `status: 'IN_PROGRESS'` so the
   * write is the idempotency gate: exactly one of N concurrent submits flips
   * the row (`count = 1`); every later / racing submit gets `count = 0` and is
   * treated by the service as an idempotent replay (no double proficiency
   * write, no re-notify). Mirrors the optimistic publish transition used by
   * the catalog module.
   *
   * Returns `true` iff this call performed the transition.
   */
  async completeAssessment(
    input: {
      assessmentId: string;
      perSkillScores: Prisma.InputJsonValue;
      computedLevel: CefrLevel;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.placementAssessment.updateMany({
      where: { id: input.assessmentId, status: 'IN_PROGRESS' },
      data: {
        status: 'SCORED',
        perSkillScores: input.perSkillScores,
        computedLevel: input.computedLevel,
        submittedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  /**
   * Run `fn` inside a Prisma transaction on this module's client. Exposed so
   * the service can emit the `placement.result` outbox event transactionally
   * without reaching into the private `PrismaClient` (the OutboxService
   * contract takes a `Prisma.TransactionClient`).
   */
  async runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
