import fc from 'fast-check';
import { CefrLevel, HomeworkModuleType } from '@prisma/client';

import { LANGUAGE_MODULE_TYPES } from '../homework/language-module-types';
import { MigrationService } from './migration.service';
import {
  FakeWorld,
  InMemoryMigrationRepository,
  cloneWorld,
} from './migration.test-harness';

/**
 * Property 5 (design.md): "Non-destructive migration idempotency — re-running
 * the migration never duplicates records and never modifies legacy
 * submissions." (Validates Req 16.3, 16.6.)
 *
 * Strategy: generate an arbitrary legacy dataset, run the migration twice, and
 * assert the invariants hold for every generated world.
 */

const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const LEGACY_MODULE_TYPES: readonly HomeworkModuleType[] = [
  'MULTIPLE_CHOICE',
  'GAP_FILL',
  'MATCHING',
  'DRAG_DROP',
  'PROJECT_SUBMISSION',
  'CASE_STUDY',
  'MARKETING_COPY',
  'MATH_WORD_PROBLEM',
  'MATH_EQUATION_SOLVER',
  'CODE_REVIEW',
  'CODE_UNIT_TEST',
];

const ALL_MODULE_TYPES: readonly HomeworkModuleType[] = [
  ...LANGUAGE_MODULE_TYPES,
  ...LEGACY_MODULE_TYPES,
];

const worldArb: fc.Arbitrary<FakeWorld> = fc
  .record({
    courses: fc.array(
      fc.record({
        id: fc.uuid(),
        cefrLevel: fc.option(fc.constantFrom(...CEFR_LEVELS), { nil: null }),
      }),
      { maxLength: 8 },
    ),
    learners: fc.array(
      fc.record({
        userId: fc.uuid(),
        currentCefrLevel: fc.option(fc.constantFrom(...CEFR_LEVELS), {
          nil: null,
        }),
      }),
      { maxLength: 8 },
    ),
    groupModules: fc.array(
      fc.record({
        groupId: fc.uuid(),
        moduleType: fc.constantFrom(...ALL_MODULE_TYPES),
        isEnabled: fc.boolean(),
        disabledAt: fc.constant<Date | null>(null),
      }),
      { maxLength: 12 },
    ),
    submissions: fc.array(
      fc.record({
        id: fc.uuid(),
        status: fc.constantFrom('DRAFT', 'SUBMITTED', 'GRADED'),
        score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        answersJson: fc.object(),
      }),
      { maxLength: 6 },
    ),
    assignmentModules: fc.array(
      fc.record({ id: fc.uuid(), type: fc.constantFrom(...ALL_MODULE_TYPES) }),
      { maxLength: 6 },
    ),
    specialties: fc.array(fc.record({ id: fc.uuid() }), { maxLength: 4 }),
    onboardingQuestions: fc.array(fc.record({ id: fc.uuid() }), {
      maxLength: 4,
    }),
  })
  .map((w) => {
    // Ensure unique ids across collections so equality/lookup is well-defined,
    // and seed an empty proficiency history (matches a fresh legacy dataset).
    const dedupeById = <T extends { id: string }>(rows: T[]): T[] => {
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    };
    const seen = new Set<string>();
    const learners = w.learners.filter((l) =>
      seen.has(l.userId) ? false : (seen.add(l.userId), true),
    );
    return {
      courses: dedupeById(w.courses),
      learners,
      proficiencyHistory: [],
      groupModules: w.groupModules,
      assignmentModules: dedupeById(w.assignmentModules),
      submissions: dedupeById(w.submissions),
      specialties: dedupeById(w.specialties),
      onboardingQuestions: dedupeById(w.onboardingQuestions),
    } satisfies FakeWorld;
  });

describe('Property 5: non-destructive migration idempotency (Req 16.3, 16.6)', () => {
  it('a second run is fully inert and legacy data is never modified', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async (world) => {
        const submissionsBefore = cloneWorld(world).submissions;
        const specialtiesBefore = cloneWorld(world).specialties;
        const onboardingBefore = cloneWorld(world).onboardingQuestions;
        const assignmentModulesBefore = cloneWorld(world).assignmentModules;

        const service = new MigrationService(
          new InMemoryMigrationRepository(world),
        );

        await service.run();
        const afterFirst = cloneWorld(world);
        const second = await service.run();

        // (a) After migration no course is left without a level (Req 16.1).
        expect(world.courses.every((c) => c.cefrLevel !== null)).toBe(true);

        // (b) The second run performs zero mutations (Req 16.6).
        expect(second.coursesLeveled).toBe(0);
        expect(second.learnersBaselined).toBe(0);
        expect(second.legacyModulesDisabled).toBe(0);

        // (c) No duplication / drift: the world is identical after run #2.
        expect(world).toEqual(afterFirst);

        // (d) Legacy submissions / specialty / onboarding never change (Req 16.3, 16.5).
        expect(world.submissions).toEqual(submissionsBefore);
        expect(world.specialties).toEqual(specialtiesBefore);
        expect(world.onboardingQuestions).toEqual(onboardingBefore);
        expect(world.assignmentModules).toEqual(assignmentModulesBefore);

        // (e) Exactly one migration baseline marker per originally-unassessed,
        //     historyless learner — never more, even across two runs (Req 16.2).
        const markerCount = world.proficiencyHistory.filter(
          (h) => h.source === 'migration',
        ).length;
        const expectedMarkers = afterFirst.proficiencyHistory.filter(
          (h) => h.source === 'migration',
        ).length;
        expect(markerCount).toBe(expectedMarkers);
      }),
      { numRuns: 200 },
    );
  });
});
