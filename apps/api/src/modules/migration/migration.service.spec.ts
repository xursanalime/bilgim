import {
  DEFAULT_COURSE_CEFR_LEVEL,
  MigrationService,
} from './migration.service';
import {
  FakeWorld,
  InMemoryMigrationRepository,
  cloneWorld,
} from './migration.test-harness';

/**
 * Unit tests for the Migration_Process (Req 16.1–16.6).
 *
 * These drive {@link MigrationService} through the in-memory repository fake,
 * so they exercise the real orchestration + guard logic with zero database.
 * The headline guarantee — idempotency (Req 16.6) — is asserted directly by
 * running the migration twice and proving the second run is fully inert.
 */
function seedWorld(): FakeWorld {
  return {
    courses: [
      { id: 'course-no-level-1', cefrLevel: null },
      { id: 'course-no-level-2', cefrLevel: null },
      { id: 'course-has-level', cefrLevel: 'B2' }, // must not be overwritten
    ],
    learners: [
      { userId: 'learner-unassessed-1', currentCefrLevel: null },
      { userId: 'learner-unassessed-2', currentCefrLevel: null },
      // Already assessed (e.g. instructor-set) — must be left alone.
      { userId: 'learner-assessed', currentCefrLevel: 'C1' },
    ],
    proficiencyHistory: [
      // The assessed learner already has a history row.
      {
        learnerId: 'learner-assessed',
        fromLevel: null,
        toLevel: 'C1',
        source: 'instructor',
        changedById: 'teacher-1',
      },
    ],
    groupModules: [
      // Legacy + enabled → must be disabled for new assignments (Req 16.4).
      {
        groupId: 'group-1',
        moduleType: 'MATH_WORD_PROBLEM',
        isEnabled: true,
        disabledAt: null,
      },
      {
        groupId: 'group-1',
        moduleType: 'CODE_REVIEW',
        isEnabled: true,
        disabledAt: null,
      },
      // Language skill + enabled → must stay enabled.
      {
        groupId: 'group-1',
        moduleType: 'WRITING',
        isEnabled: true,
        disabledAt: null,
      },
      // Legacy but already disabled → untouched.
      {
        groupId: 'group-2',
        moduleType: 'PROJECT_SUBMISSION',
        isEnabled: false,
        disabledAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ],
    assignmentModules: [
      { id: 'am-legacy-1', type: 'MATH_WORD_PROBLEM' },
      { id: 'am-language-1', type: 'WRITING' },
    ],
    submissions: [
      { id: 'sub-legacy-1', status: 'GRADED', score: 87, answersJson: { a: 1 } },
      { id: 'sub-legacy-2', status: 'SUBMITTED', score: null, answersJson: { b: 2 } },
    ],
    specialties: [{ id: 'spec-1' }, { id: 'spec-2' }],
    onboardingQuestions: [{ id: 'oq-1' }],
  };
}

describe('MigrationService (Req 16)', () => {
  it('assigns the default CEFR level only to level-less courses (Req 16.1)', async () => {
    const world = seedWorld();
    const service = new MigrationService(new InMemoryMigrationRepository(world));

    const report = await service.run();

    expect(report.defaultCefrLevel).toBe(DEFAULT_COURSE_CEFR_LEVEL);
    expect(report.coursesLeveled).toBe(2);
    expect(world.courses.find((c) => c.id === 'course-no-level-1')!.cefrLevel).toBe(
      DEFAULT_COURSE_CEFR_LEVEL,
    );
    expect(world.courses.find((c) => c.id === 'course-no-level-2')!.cefrLevel).toBe(
      DEFAULT_COURSE_CEFR_LEVEL,
    );
    // The course that already had a level is preserved unchanged.
    expect(world.courses.find((c) => c.id === 'course-has-level')!.cefrLevel).toBe(
      'B2',
    );
  });

  it('honours a configurable default CEFR level (Req 16.1)', async () => {
    const world = seedWorld();
    const service = new MigrationService(new InMemoryMigrationRepository(world), {
      defaultCefrLevel: 'B1',
    });

    const report = await service.run();

    expect(report.defaultCefrLevel).toBe('B1');
    expect(world.courses.find((c) => c.id === 'course-no-level-1')!.cefrLevel).toBe(
      'B1',
    );
  });

  it('leaves existing learners UNASSESSED without fabricating proficiency (Req 16.2)', async () => {
    const world = seedWorld();
    const service = new MigrationService(new InMemoryMigrationRepository(world));

    const report = await service.run();

    expect(report.learnersBaselined).toBe(2);
    // No proficiency is fabricated: unassessed learners remain null.
    expect(
      world.learners.find((l) => l.userId === 'learner-unassessed-1')!
        .currentCefrLevel,
    ).toBeNull();
    // An explicit, auditable migration baseline marker was recorded.
    const markers = world.proficiencyHistory.filter(
      (h) => h.source === 'migration',
    );
    expect(markers).toHaveLength(2);
    expect(markers.every((m) => m.fromLevel === null && m.toLevel === null)).toBe(
      true,
    );
    // The already-assessed learner is untouched (still C1, no new marker).
    expect(
      world.learners.find((l) => l.userId === 'learner-assessed')!
        .currentCefrLevel,
    ).toBe('C1');
  });

  it('disables enabled legacy module toggles but keeps language skills (Req 16.4)', async () => {
    const world = seedWorld();
    const service = new MigrationService(new InMemoryMigrationRepository(world));

    const report = await service.run();

    expect(report.legacyModulesDisabled).toBe(2);
    const math = world.groupModules.find(
      (m) => m.moduleType === 'MATH_WORD_PROBLEM',
    )!;
    const code = world.groupModules.find((m) => m.moduleType === 'CODE_REVIEW')!;
    const writing = world.groupModules.find((m) => m.moduleType === 'WRITING')!;
    expect(math.isEnabled).toBe(false);
    expect(code.isEnabled).toBe(false);
    // Language skill stays enabled.
    expect(writing.isEnabled).toBe(true);
  });

  it('never modifies legacy assignments, submissions, or specialty data (Req 16.3, 16.5)', async () => {
    const world = seedWorld();
    const submissionsBefore = cloneWorld(world).submissions;
    const assignmentModulesBefore = cloneWorld(world).assignmentModules;
    const specialtiesBefore = cloneWorld(world).specialties;
    const onboardingBefore = cloneWorld(world).onboardingQuestions;

    const service = new MigrationService(new InMemoryMigrationRepository(world));
    const report = await service.run();

    // Bit-for-bit unchanged.
    expect(world.submissions).toEqual(submissionsBefore);
    expect(world.assignmentModules).toEqual(assignmentModulesBefore);
    expect(world.specialties).toEqual(specialtiesBefore);
    expect(world.onboardingQuestions).toEqual(onboardingBefore);
    // And reported as retained.
    expect(report.retained.submissions).toBe(2);
    expect(report.retained.legacyAssignmentModules).toBe(1);
    expect(report.retained.specialties).toBe(2);
    expect(report.retained.onboardingQuestions).toBe(1);
  });

  it('is idempotent: a second run changes nothing (Req 16.6)', async () => {
    const world = seedWorld();
    const service = new MigrationService(new InMemoryMigrationRepository(world));

    const first = await service.run();
    const afterFirst = cloneWorld(world);
    const second = await service.run();

    // The first run did real work...
    expect(first.coursesLeveled).toBe(2);
    expect(first.learnersBaselined).toBe(2);
    expect(first.legacyModulesDisabled).toBe(2);

    // ...the second run is fully inert.
    expect(second.coursesLeveled).toBe(0);
    expect(second.learnersBaselined).toBe(0);
    expect(second.legacyModulesDisabled).toBe(0);

    // No new history rows, no duplicated state — the world is byte-identical.
    expect(world).toEqual(afterFirst);
  });
});
