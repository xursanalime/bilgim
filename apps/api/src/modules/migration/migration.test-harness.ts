import { CefrLevel, HomeworkModuleType } from '@prisma/client';

import { LANGUAGE_MODULE_TYPE_SET } from '../homework/language-module-types';
import {
  LegacyDataSnapshot,
  LegacyGroupModuleRef,
  MigrationRepository,
} from './migration.repository';

/**
 * Test-only in-memory model of the slice of the schema the migration touches.
 * Shared by the deterministic spec and the property-based idempotency spec so
 * both drive {@link InMemoryMigrationRepository} the exact way Prisma would.
 *
 * NOTE: this file is intentionally NOT a `*.spec.ts` so Jest does not treat it
 * as a suite; it is imported by the specs that do contain the assertions.
 */

export interface FakeCourse {
  id: string;
  cefrLevel: CefrLevel | null;
}

export interface FakeLearner {
  userId: string;
  currentCefrLevel: CefrLevel | null;
}

export interface FakeProficiencyHistory {
  learnerId: string;
  fromLevel: CefrLevel | null;
  toLevel: CefrLevel | null;
  source: string;
  changedById: string | null;
}

export interface FakeGroupModule {
  groupId: string;
  moduleType: HomeworkModuleType;
  isEnabled: boolean;
  disabledAt: Date | null;
}

export interface FakeAssignmentModule {
  id: string;
  type: HomeworkModuleType;
}

export interface FakeSubmission {
  id: string;
  status: string;
  score: number | null;
  answersJson: unknown;
}

export interface FakeWorld {
  courses: FakeCourse[];
  learners: FakeLearner[];
  proficiencyHistory: FakeProficiencyHistory[];
  groupModules: FakeGroupModule[];
  assignmentModules: FakeAssignmentModule[];
  submissions: FakeSubmission[];
  specialties: { id: string }[];
  onboardingQuestions: { id: string }[];
}

/**
 * In-memory {@link MigrationRepository} backed by a {@link FakeWorld}. Mirrors
 * the Prisma implementation's semantics precisely:
 *   - writes are guarded (level only set when still null; module only disabled
 *     when still enabled), so re-running is inert;
 *   - the UNASSESSED baseline both reaffirms `currentCefrLevel = null` and
 *     appends a `migration` history marker, atomically.
 */
export class InMemoryMigrationRepository extends MigrationRepository {
  constructor(public readonly world: FakeWorld) {
    super();
  }

  async findCourseIdsMissingCefrLevel(): Promise<string[]> {
    return this.world.courses
      .filter((c) => c.cefrLevel === null)
      .map((c) => c.id);
  }

  async setCourseCefrLevel(courseId: string, level: CefrLevel): Promise<void> {
    const course = this.world.courses.find((c) => c.id === courseId);
    // Guard mirrors `updateMany({ where: { cefrLevel: null } })`.
    if (course && course.cefrLevel === null) {
      course.cefrLevel = level;
    }
  }

  async findLearnerIdsNeedingUnassessedBaseline(): Promise<string[]> {
    return this.world.learners
      .filter(
        (l) =>
          l.currentCefrLevel === null &&
          !this.world.proficiencyHistory.some((h) => h.learnerId === l.userId),
      )
      .map((l) => l.userId);
  }

  async recordUnassessedBaseline(learnerId: string): Promise<void> {
    const learner = this.world.learners.find((l) => l.userId === learnerId);
    if (!learner) {
      return;
    }
    // Atomic update + history insert (no fabrication: stays null).
    learner.currentCefrLevel = null;
    this.world.proficiencyHistory.push({
      learnerId,
      fromLevel: null,
      toLevel: null,
      source: 'migration',
      changedById: null,
    });
  }

  async findEnabledLegacyGroupModules(): Promise<LegacyGroupModuleRef[]> {
    return this.world.groupModules
      .filter((m) => m.isEnabled && !LANGUAGE_MODULE_TYPE_SET.has(m.moduleType))
      .map((m) => ({ groupId: m.groupId, moduleType: m.moduleType }));
  }

  async disableGroupModule(
    groupId: string,
    moduleType: HomeworkModuleType,
  ): Promise<void> {
    const mod = this.world.groupModules.find(
      (m) => m.groupId === groupId && m.moduleType === moduleType,
    );
    // Guard mirrors `updateMany({ where: { isEnabled: true } })`.
    if (mod && mod.isEnabled) {
      mod.isEnabled = false;
      mod.disabledAt = new Date();
    }
  }

  async snapshotLegacyData(): Promise<LegacyDataSnapshot> {
    return {
      legacyAssignmentModules: this.world.assignmentModules.filter(
        (m) => !LANGUAGE_MODULE_TYPE_SET.has(m.type),
      ).length,
      submissions: this.world.submissions.length,
      specialties: this.world.specialties.length,
      onboardingQuestions: this.world.onboardingQuestions.length,
    };
  }
}

/**
 * Deep clone helper so tests can snapshot the world before a run. Uses
 * `structuredClone` (Node 20) so `Date` instances and `undefined` property
 * values survive the copy — a JSON round-trip would corrupt both and produce
 * spurious inequalities against the live world.
 */
export function cloneWorld(world: FakeWorld): FakeWorld {
  return structuredClone(world);
}
