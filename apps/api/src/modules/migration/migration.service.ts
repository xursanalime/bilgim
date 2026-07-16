import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CefrLevel } from '@prisma/client';

import {
  LegacyDataSnapshot,
  MigrationRepository,
} from './migration.repository';

/**
 * Configurable default CEFR level assigned to existing courses that have no
 * level when the migration runs (Req 16.1).
 *
 * We pick **A1** as the documented, conservative default: it is the lowest
 * CEFR band, so a course that was never level-tagged is surfaced as
 * "beginner" rather than being mislabelled as advanced. An admin/instructor
 * can raise it afterwards via `PATCH /catalog/courses/:id/level`. The value
 * is overridable per-run (CLI flag / env / option) so a different default can
 * be chosen without a code change.
 */
export const DEFAULT_COURSE_CEFR_LEVEL: CefrLevel = 'A1';

/** Injection token for the per-run options (optional). */
export const MIGRATION_OPTIONS = Symbol('MIGRATION_OPTIONS');

export interface MigrationOptions {
  /** CEFR level applied to level-less courses (Req 16.1). Defaults to A1. */
  defaultCefrLevel?: CefrLevel;
}

/**
 * Structured, machine-readable result of a single migration run. Returned by
 * {@link MigrationService.run} so the CLI can log it and tests can assert that
 * a second run is fully inert (every `*Updated`/`*Baselined`/`*Disabled`
 * counter is 0).
 */
export interface MigrationReport {
  defaultCefrLevel: CefrLevel;
  /** Courses that had no level and were assigned the default (Req 16.1). */
  coursesLeveled: number;
  /** Legacy learners given an explicit UNASSESSED baseline (Req 16.2). */
  learnersBaselined: number;
  /** Enabled legacy GroupModule toggles switched off for new work (Req 16.4). */
  legacyModulesDisabled: number;
  /** Read-only snapshot of retained legacy data (Req 16.3, 16.5). */
  retained: LegacyDataSnapshot;
}

/**
 * Migration_Process (English-Only Platform Refocus, Req 16).
 *
 * A one-time, **idempotent** data migration that converts existing
 * generic-platform data into the English-only model. It is deliberately
 * non-destructive and safe to re-run after a partial failure (Req 16.6):
 *
 *   1. Req 16.1 — assign a configurable default CEFR level to courses that
 *      lack one, never overwriting a course that already has a level.
 *   2. Req 16.2 — leave existing learners explicitly UNASSESSED
 *      (`currentCefrLevel = null`); proficiency is never fabricated.
 *   3. Req 16.3 / 16.4 — preserve all legacy assignments and submissions; only
 *      flip enabled `Legacy_Module_Type` group toggles off so the assignment
 *      builder can't create *new* legacy work. Historical rows stay readable.
 *   4. Req 16.5 — Specialty / OnboardingQuestion data is retained read-only;
 *      this process never deletes it.
 *   5. Req 16.6 — every step reads what still needs migrating and
 *      conditionally writes the minimum, so running twice produces no
 *      duplication and no further changes after the first run.
 *
 * The service depends only on the {@link MigrationRepository} port, so the
 * same logic runs against Prisma in production and against an in-memory fake
 * in the idempotency unit test.
 *
 * Wiring: like {@link import('../placement/placement.module')}, MigrationModule
 * is intentionally NOT registered in `app.module.ts`. It is invoked on demand
 * by the `apps/api/scripts/run-refocus-migration.ts` CLI (and can later be
 * exposed via a guarded admin trigger).
 */
@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private readonly defaultCefrLevel: CefrLevel;

  constructor(
    private readonly repository: MigrationRepository,
    @Optional()
    @Inject(MIGRATION_OPTIONS)
    options?: MigrationOptions,
  ) {
    this.defaultCefrLevel =
      options?.defaultCefrLevel ?? DEFAULT_COURSE_CEFR_LEVEL;
  }

  /**
   * Execute the full migration once. Idempotent: safe to call repeatedly. The
   * returned {@link MigrationReport} reports how many rows actually changed —
   * which is 0 for every mutation counter once the first run has completed.
   */
  async run(): Promise<MigrationReport> {
    this.logger.log(
      `Migration_Process starting (defaultCefrLevel=${this.defaultCefrLevel})`,
    );

    const coursesLeveled = await this.assignDefaultCourseLevels();
    const learnersBaselined = await this.baselineUnassessedLearners();
    const legacyModulesDisabled = await this.disableLegacyModuleTypes();

    // Read-only: capture (and log) the legacy data we are committing to
    // retain untouched (Req 16.3, 16.5). This is purely informational.
    const retained = await this.repository.snapshotLegacyData();

    const report: MigrationReport = {
      defaultCefrLevel: this.defaultCefrLevel,
      coursesLeveled,
      learnersBaselined,
      legacyModulesDisabled,
      retained,
    };

    this.logger.log(
      `Migration_Process complete: ${coursesLeveled} course(s) leveled, ` +
        `${learnersBaselined} learner(s) baselined UNASSESSED, ` +
        `${legacyModulesDisabled} legacy module toggle(s) disabled. ` +
        `Retained read-only: ${retained.legacyAssignmentModules} legacy ` +
        `assignment module(s), ${retained.submissions} submission(s), ` +
        `${retained.specialties} specialty record(s), ` +
        `${retained.onboardingQuestions} onboarding question(s).`,
    );

    return report;
  }

  /**
   * Req 16.1 — assign the configurable default CEFR level to every course
   * that still lacks one. The repository write is guarded on `cefrLevel: null`
   * so a course that already has a level is never overwritten, and a re-run
   * finds nothing to do.
   */
  private async assignDefaultCourseLevels(): Promise<number> {
    const courseIds = await this.repository.findCourseIdsMissingCefrLevel();
    for (const courseId of courseIds) {
      await this.repository.setCourseCefrLevel(courseId, this.defaultCefrLevel);
      this.logger.debug(
        `Course ${courseId} → default CEFR ${this.defaultCefrLevel}`,
      );
    }
    return courseIds.length;
  }

  /**
   * Req 16.2 — leave existing learners UNASSESSED. We never fabricate a level;
   * we only record an explicit `null → null` baseline (source `migration`) for
   * learners that have never had any proficiency event. Because the lookup
   * excludes learners that already have history, a re-run is inert.
   */
  private async baselineUnassessedLearners(): Promise<number> {
    const learnerIds =
      await this.repository.findLearnerIdsNeedingUnassessedBaseline();
    for (const learnerId of learnerIds) {
      await this.repository.recordUnassessedBaseline(learnerId);
      this.logger.debug(`Learner ${learnerId} → UNASSESSED baseline recorded`);
    }
    return learnerIds.length;
  }

  /**
   * Req 16.4 — disable enabled `Legacy_Module_Type` group toggles so the
   * assignment builder can't create new legacy work, while leaving all
   * historical Assignment/Submission rows untouched (Req 16.3). Guarded on
   * `isEnabled: true`, so a re-run disables nothing further.
   */
  private async disableLegacyModuleTypes(): Promise<number> {
    const legacy = await this.repository.findEnabledLegacyGroupModules();
    for (const { groupId, moduleType } of legacy) {
      await this.repository.disableGroupModule(groupId, moduleType);
      this.logger.debug(
        `GroupModule (${groupId}, ${moduleType}) disabled for new assignments`,
      );
    }
    return legacy.length;
  }
}
