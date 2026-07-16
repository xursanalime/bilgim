import { Injectable } from '@nestjs/common';
import {
  CefrLevel,
  HomeworkModuleType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { LANGUAGE_MODULE_TYPE_SET } from '../homework/language-module-types';

/**
 * A single enabled `GroupModule` row whose `moduleType` is a
 * `Legacy_Module_Type` (i.e. not one of the eight English skills). These are
 * the rows the migration disables for *new* assignment creation (Req 16.4)
 * without ever touching historical Assignment/Submission data.
 */
export interface LegacyGroupModuleRef {
  groupId: string;
  moduleType: HomeworkModuleType;
}

/**
 * Read-only counts the migration captures purely for structured logging and
 * post-run verification. The migration NEVER mutates the underlying rows —
 * legacy assignments/submissions (Req 16.3) and Specialty/Onboarding history
 * (Req 16.5) are retained untouched.
 */
export interface LegacyDataSnapshot {
  legacyAssignmentModules: number;
  submissions: number;
  specialties: number;
  onboardingQuestions: number;
}

/**
 * Data-access port for {@link MigrationService}.
 *
 * Declared as an abstract class so it doubles as a Nest DI token while still
 * being trivially substitutable in unit tests by an in-memory fake (the
 * idempotency spec drives the service through this port over a seeded
 * dataset, with no real database).
 *
 * Every method is intentionally narrow and side-effect-explicit: the service
 * only ever *reads* what still needs migrating and *conditionally writes* the
 * minimum, which is what makes the whole process safe to re-run (Req 16.6).
 */
export abstract class MigrationRepository {
  // ---- Req 16.1: default CEFR level on level-less courses ----------------
  abstract findCourseIdsMissingCefrLevel(): Promise<string[]>;
  abstract setCourseCefrLevel(courseId: string, level: CefrLevel): Promise<void>;

  // ---- Req 16.2: leave legacy learners explicitly UNASSESSED -------------
  abstract findLearnerIdsNeedingUnassessedBaseline(): Promise<string[]>;
  abstract recordUnassessedBaseline(learnerId: string): Promise<void>;

  // ---- Req 16.4: disable Legacy_Module_Type options for NEW assignments --
  abstract findEnabledLegacyGroupModules(): Promise<LegacyGroupModuleRef[]>;
  abstract disableGroupModule(
    groupId: string,
    moduleType: HomeworkModuleType,
  ): Promise<void>;

  // ---- Req 16.3 / 16.5: read-only verification snapshot ------------------
  abstract snapshotLegacyData(): Promise<LegacyDataSnapshot>;
}

/**
 * Prisma-backed implementation of {@link MigrationRepository}.
 *
 * Owns no transaction policy of its own beyond the single atomic
 * baseline-write below; the service orchestrates ordering. All filters are
 * written so that an already-migrated row is excluded from the result set,
 * which is the backbone of the idempotency guarantee.
 */
@Injectable()
export class PrismaMigrationRepository extends MigrationRepository {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  /** Courses that still have no CEFR level (the only ones we backfill). */
  async findCourseIdsMissingCefrLevel(): Promise<string[]> {
    const rows = await this.prisma.course.findMany({
      where: { cefrLevel: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Assign the default level — but only to a course that is *still*
   * level-less. The `cefrLevel: null` guard in the WHERE clause makes a
   * concurrent/re-run write a no-op (it matches zero rows) so we never
   * overwrite a level set by an instructor in the meantime (Req 16.1).
   */
  async setCourseCefrLevel(courseId: string, level: CefrLevel): Promise<void> {
    await this.prisma.course.updateMany({
      where: { id: courseId, cefrLevel: null },
      data: { cefrLevel: level },
    });
  }

  /**
   * Legacy learners that have never been assessed: `currentCefrLevel = null`
   * (UNASSESSED) AND no proficiency-history row at all. The "no history"
   * predicate is what makes the baseline write idempotent — once a baseline
   * (or any real assessment) exists the learner drops out of this set.
   */
  async findLearnerIdsNeedingUnassessedBaseline(): Promise<string[]> {
    const rows = await this.prisma.studentProfile.findMany({
      where: {
        currentCefrLevel: null,
        proficiencyHistory: { none: {} },
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Record an explicit UNASSESSED baseline for a legacy learner (Req 16.2)
   * WITHOUT fabricating any proficiency: `currentCefrLevel` is (re)affirmed
   * as null and a `null → null` `ProficiencyLevelHistory` marker with
   * `source = 'migration'` is appended so the UNASSESSED state is auditable.
   * The update + insert run in one transaction so they can never diverge.
   */
  async recordUnassessedBaseline(learnerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.studentProfile.update({
        where: { userId: learnerId },
        data: { currentCefrLevel: null },
      });
      await tx.proficiencyLevelHistory.create({
        data: {
          learnerId,
          fromLevel: null,
          toLevel: null,
          source: 'migration',
          changedById: null,
        },
      });
    });
  }

  /**
   * Enabled `GroupModule` rows whose type is a `Legacy_Module_Type`. We fetch
   * all enabled rows and filter in memory against the canonical language-skill
   * set so the query stays portable (no enum list duplicated in SQL).
   */
  async findEnabledLegacyGroupModules(): Promise<LegacyGroupModuleRef[]> {
    const rows = await this.prisma.groupModule.findMany({
      where: { isEnabled: true },
      select: { groupId: true, moduleType: true },
    });
    return rows.filter((r) => !LANGUAGE_MODULE_TYPE_SET.has(r.moduleType));
  }

  /**
   * Disable a single legacy `GroupModule` so the assignment builder can no
   * longer offer it (Req 16.4). Guarded on `isEnabled: true` so a re-run is a
   * no-op. Crucially this only flips a per-group toggle — it does not delete
   * or alter any Assignment/AssignmentModule/Submission, so historical legacy
   * submissions remain fully readable (Req 16.3, 16.4).
   */
  async disableGroupModule(
    groupId: string,
    moduleType: HomeworkModuleType,
  ): Promise<void> {
    await this.prisma.groupModule.updateMany({
      where: { groupId, moduleType, isEnabled: true },
      data: { isEnabled: false, disabledAt: new Date() },
    });
  }

  /**
   * Pure read of the legacy data we promise to retain. Used only for logging
   * and for the migration's own before/after verification — never mutated.
   */
  async snapshotLegacyData(): Promise<LegacyDataSnapshot> {
    const [legacyAssignmentModules, submissions, specialties, onboardingQuestions] =
      await Promise.all([
        this.prisma.assignmentModule.count({
          where: { type: { notIn: [...LANGUAGE_MODULE_TYPE_SET] } },
        }),
        this.prisma.submission.count(),
        this.prisma.specialty.count(),
        this.prisma.onboardingQuestion.count(),
      ]);
    return {
      legacyAssignmentModules,
      submissions,
      specialties,
      onboardingQuestions,
    };
  }
}
