import { Injectable } from '@nestjs/common';
import {
  CefrLevel,
  Course,
  Group,
  Prisma,
  PrismaClient,
  ProficiencyLevelHistory,
} from '@prisma/client';

/**
 * LevelingRepository — Prisma data access for CEFR level / Exam_Track
 * assignment on Course and Group (Req 3.1 – 3.5).
 *
 * Cross-teacher isolation mirrors the catalog convention: the repository
 * only filters by ownership (`teacherId`, or `course.teacherId` for groups);
 * the service raises the canonical 403 / 404 errors. Level mutations are
 * scoped to the owning teacher via `updateMany` so a row owned by another
 * teacher yields `count = 0` rather than a silent cross-teacher write.
 */
@Injectable()
export class LevelingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCourseById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Course | null> {
    const client = tx ?? this.prisma;
    return client.course.findUnique({ where: { id } });
  }

  /**
   * Set `cefrLevel` (and optionally `examTrack`) on a course owned by
   * `teacherId`. `examTrack` is only written when present in `data`
   * (including an explicit `null` to clear it) so a level-only update never
   * clobbers an existing exam track.
   */
  async setCourseLevel(
    id: string,
    teacherId: string,
    data: { cefrLevel: CefrLevel; examTrack?: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.course.updateMany({
      where: { id, teacherId },
      data: {
        cefrLevel: data.cefrLevel,
        ...(data.examTrack !== undefined && { examTrack: data.examTrack }),
      },
    });
  }

  /**
   * Resolve a group together with its parent course's `teacherId` and
   * `cefrLevel`. The course level is needed to compute the effective level
   * (inheritance) and the teacherId to authorize the write (Req 3.3, 3.4).
   */
  async findGroupWithCourse(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Group & { course: { teacherId: string; cefrLevel: CefrLevel | null } })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.group.findUnique({
      where: { id },
      include: {
        course: { select: { teacherId: true, cefrLevel: true } },
      },
    }) as Promise<
      | (Group & { course: { teacherId: string; cefrLevel: CefrLevel | null } })
      | null
    >;
  }

  /**
   * Set (or clear, with `null`) the Group-specific CEFR override. Scoped to
   * the owning teacher through the parent course so a cross-teacher write is
   * impossible (returns `count = 0`).
   */
  async setGroupLevel(
    id: string,
    teacherId: string,
    cefrLevel: CefrLevel | null,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.group.updateMany({
      where: { id, course: { teacherId } },
      data: { cefrLevel },
    });
  }

  // ==================================================================
  // Learner proficiency (Req 4.1 – 4.5)
  // ==================================================================

  /**
   * Fetch the learner's current proficiency level. Returns the `CefrLevel`,
   * `null` when the learner is UNASSESSED (no placement completed yet, Req
   * 4.2), or `undefined` when no StudentProfile row exists at all so the
   * service can distinguish "unknown learner" (404) from "assessed/unassessed".
   */
  async getCurrentCefrLevel(
    learnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<CefrLevel | null | undefined> {
    const client = tx ?? this.prisma;
    const profile = await client.studentProfile.findUnique({
      where: { userId: learnerId },
      select: { currentCefrLevel: true },
    });
    return profile ? profile.currentCefrLevel : undefined;
  }

  /**
   * Apply a proficiency change atomically (Req 4.4): update
   * `StudentProfile.currentCefrLevel` AND append a `ProficiencyLevelHistory`
   * row capturing `fromLevel → toLevel`, `source`, and `changedById`. The
   * update + insert run in a single transaction so the current level and its
   * history never diverge. Returns the appended history row.
   *
   * `toLevel` / `changedById` are nullable to support the full source range:
   * a migration can revert a learner to UNASSESSED (`toLevel = null`) and has
   * no acting user (`changedById = null`).
   */
  async applyProficiencyChange(
    input: {
      learnerId: string;
      fromLevel: CefrLevel | null;
      toLevel: CefrLevel | null;
      source: string;
      changedById: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<ProficiencyLevelHistory> {
    const run = async (
      client: Prisma.TransactionClient,
    ): Promise<ProficiencyLevelHistory> => {
      await client.studentProfile.update({
        where: { userId: input.learnerId },
        data: { currentCefrLevel: input.toLevel },
      });
      return client.proficiencyLevelHistory.create({
        data: {
          learnerId: input.learnerId,
          fromLevel: input.fromLevel,
          toLevel: input.toLevel,
          source: input.source,
          changedById: input.changedById,
        },
      });
    };

    if (tx) {
      return run(tx);
    }
    return this.prisma.$transaction((client) => run(client));
  }

  /**
   * Append-only proficiency history for a learner, newest first. Mirrors the
   * `@@index([learnerId, changedAt])` ordering for an efficient read.
   */
  async findProficiencyHistory(
    learnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ProficiencyLevelHistory[]> {
    const client = tx ?? this.prisma;
    return client.proficiencyLevelHistory.findMany({
      where: { learnerId },
      orderBy: { changedAt: 'desc' },
    });
  }

  /**
   * Authorization fact (Req 4.4): does `instructorId` teach `learnerId`? True
   * when the learner has an APPROVED enrollment in any group whose parent
   * course is owned by the instructor. Mirrors the catalog/enrollment
   * ownership model (course.teacherId is the source of truth).
   */
  async instructorTeachesLearner(
    instructorId: string,
    learnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const count = await client.enrollment.count({
      where: {
        studentId: learnerId,
        status: 'APPROVED',
        group: { course: { teacherId: instructorId } },
      },
    });
    return count > 0;
  }
}
