import { HomeworkModuleType, SpecialtyModule } from '@prisma/client';
import * as fc from 'fast-check';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { GroupChatRepository } from '../group-chat/repositories/group-chat.repository';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import { CatalogService } from './catalog.service';
import { CourseRepository } from './repositories/course.repository';
import { GroupModuleRepository } from './repositories/group-module.repository';
import { GroupRepository } from './repositories/group.repository';
import { LessonRepository } from './repositories/lesson.repository';

/**
 * Property 13 — Group module seeding matches specialty catalog
 * (Task 7.3 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * For any newly created group, the set of GroupModule rows exactly matches
 * the teacher's active SpecialtyModule catalog, with isEnabled values that
 * mirror SpecialtyModule.defaultEnabled:
 *
 *   ∀ group g created by teacher t:
 *     { gm.moduleType | gm ∈ g.modules }
 *       = { sm.moduleType | sm ∈ SpecialtyModule, sm.specialtyId = t.specialtyId, sm.isActive }
 *     ∧ ∀ gm ∈ g.modules: gm.isEnabled = correspondingSM.defaultEnabled
 *
 * We generate random specialty catalogs of 1–10 distinct active modules with
 * randomised `defaultEnabled` flags, drive them through CatalogService.createGroup,
 * and assert the seed equality on every run.
 *
 * This file ONLY implements Property 13 from the design document.
 *
 * Validates: Requirements 7.2, 7.3, 11.2
 */

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const SPECIALTY_ID = '11111111-1111-1111-1111-111111111111';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';

// ----------------------------------------------------------------------------
// Generators
// ----------------------------------------------------------------------------

/**
 * The full set of HomeworkModuleType enum values, mirroring the Prisma
 * schema. Spelled out here so the test does not silently change shape if a
 * future migration adds a new variant — we want a counterexample if the
 * generator drifts from the SUT's enum.
 */
const ALL_MODULE_TYPES: HomeworkModuleType[] = [
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'SPELLING',
  'VOCABULARY',
  'SPEAKING',
  'PRONUNCIATION',
  'MULTIPLE_CHOICE',
  'GAP_FILL',
  'MATCHING',
  'DRAG_DROP',
  'PROJECT_SUBMISSION',
  'CASE_STUDY',
  'MARKETING_COPY',
  'AUDIENCE_ANALYSIS',
  'CONTENT_CALENDAR',
  'MATH_WORD_PROBLEM',
  'MATH_EQUATION_SOLVER',
  'MATH_GEOMETRY_PROOF',
  'CODE_REVIEW',
  'CODE_UNIT_TEST',
];

/**
 * A specialty catalog: 1–10 distinct active modules, each with an arbitrary
 * `defaultEnabled` flag. The 10-module ceiling matches the Req 11.1 cap on
 * active SpecialtyModule rows per Specialty.
 */
const specialtyCatalogArb: fc.Arbitrary<
  Array<{ moduleType: HomeworkModuleType; defaultEnabled: boolean }>
> = fc
  .uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
    minLength: 1,
    maxLength: 10,
  })
  .chain((moduleTypes) =>
    fc
      .array(fc.boolean(), {
        minLength: moduleTypes.length,
        maxLength: moduleTypes.length,
      })
      .map((flags) =>
        moduleTypes.map((moduleType, i) => ({
          moduleType,
          defaultEnabled: flags[i] as boolean,
        })),
      ),
  );

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Build a CatalogService wired to in-memory mocks. The mocks faithfully
 * reproduce the parts of the real flow we care about for this property:
 *
 *   - CourseRepository.findById   → returns a course owned by TEACHER_ID
 *   - TeacherProfileRepository    → returns a profile with SPECIALTY_ID
 *   - SpecialtyService.listActiveModules → returns the generated catalog
 *   - GroupRepository.create      → returns a fixed Group row
 *   - GroupModuleRepository.seedForGroup → simulates the createMany +
 *     findMany round trip by echoing the input back as GroupModule rows
 *     (sorted asc by moduleType, matching the real repository behaviour).
 */
function buildService(
  catalog: Array<{ moduleType: HomeworkModuleType; defaultEnabled: boolean }>,
  /** Captures the actual argument passed to seedForGroup for assertions. */
  capture: { seedInput?: unknown },
): CatalogService {
  const specialtyModules: SpecialtyModule[] = catalog.map((m) => ({
    specialtyId: SPECIALTY_ID,
    moduleType: m.moduleType,
    isActive: true,
    defaultEnabled: m.defaultEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as SpecialtyModule[];

  const courseRepository = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: COURSE_ID, teacherId: TEACHER_ID }),
  } as unknown as jest.Mocked<CourseRepository>;

  const groupRepository = {
    create: jest.fn().mockResolvedValue({
      id: GROUP_ID,
      courseId: COURSE_ID,
      name: 'g',
      priceUzs: 0,
    }),
  } as unknown as jest.Mocked<GroupRepository>;

  const groupModuleRepository = {
    seedForGroup: jest.fn(async (input: any) => {
      capture.seedInput = input;
      // Mimic the real repo: persist what we were given and read back the
      // canonical (groupId, moduleType ASC) view.
      const now = new Date();
      return [...input.modules]
        .sort((a, b) => a.moduleType.localeCompare(b.moduleType))
        .map((m) => ({
          groupId: input.groupId,
          moduleType: m.moduleType,
          isEnabled: m.defaultEnabled,
          enabledAt: m.defaultEnabled ? now : null,
          disabledAt: m.defaultEnabled ? null : now,
          createdAt: now,
          updatedAt: now,
        }));
    }),
  } as unknown as jest.Mocked<GroupModuleRepository>;

  const lessonRepository = {} as unknown as jest.Mocked<LessonRepository>;

  const teacherProfileRepository = {
    findByUserId: jest
      .fn()
      .mockResolvedValue({ userId: TEACHER_ID, specialtyId: SPECIALTY_ID }),
  } as unknown as jest.Mocked<TeacherProfileRepository>;

  const specialtyService = {
    listActiveModules: jest.fn().mockResolvedValue(specialtyModules),
  } as unknown as jest.Mocked<SpecialtyService>;

  const billingService = {} as unknown as jest.Mocked<BillingService>;
  const outboxService = {} as unknown as jest.Mocked<OutboxService>;
  const groupChatRepository = {
    upsertRoomForGroup: jest.fn().mockResolvedValue({ id: 'room-1', scopeRef: GROUP_ID, createdAt: new Date() }),
    addOwner: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<GroupChatRepository>;

  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    user: { findUnique: jest.fn().mockResolvedValue({ email: 'teacher@example.com' }) },
    group: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  return new CatalogService(
    prisma,
    courseRepository,
    groupRepository,
    groupModuleRepository,
    lessonRepository,
    teacherProfileRepository,
    specialtyService,
    billingService,
    outboxService,
    groupChatRepository,
  );
}

// ----------------------------------------------------------------------------
// Property
// ----------------------------------------------------------------------------

describe('CatalogService.createGroup — Property 13: Group module seeding matches specialty catalog [Validates: Requirements 7.2, 7.3, 11.2]', () => {
  it('seeds GroupModule set equal to the active specialty catalog with isEnabled = defaultEnabled', async () => {
    await fc.assert(
      fc.asyncProperty(specialtyCatalogArb, async (catalog) => {
        const capture: { seedInput?: any } = {};
        const service = buildService(catalog, capture);

        const result = await service.createGroup(TEACHER_ID, COURSE_ID, {
          name: 'Test guruh',
          priceUzs: 100_000,
        });

        // ----- 1. Set equality: { gm.moduleType } = { sm.moduleType } ------
        const expectedTypes = new Set(catalog.map((m) => m.moduleType));
        const actualTypes = new Set(result.modules.map((m) => m.moduleType));
        expect(actualTypes.size).toBe(expectedTypes.size);
        for (const t of expectedTypes) {
          expect(actualTypes.has(t)).toBe(true);
        }

        // No spurious GroupModule rows for moduleTypes outside the catalog.
        expect(result.modules).toHaveLength(catalog.length);

        // ----- 2. isEnabled mirrors defaultEnabled per moduleType ----------
        const expectedEnabledByType = new Map(
          catalog.map((m) => [m.moduleType, m.defaultEnabled]),
        );
        for (const gm of result.modules) {
          expect(gm.groupId).toBe(GROUP_ID);
          expect(gm.isEnabled).toBe(expectedEnabledByType.get(gm.moduleType));
        }

        // ----- 3. Seed call shape mirrors the catalog 1:1 ------------------
        // The repository receives exactly one entry per catalog module with
        // the original `defaultEnabled` flag — no fabrication, no drops.
        expect(capture.seedInput).toBeDefined();
        const seededTypes = new Set(
          (capture.seedInput!.modules as Array<{ moduleType: string }>).map(
            (m) => m.moduleType,
          ),
        );
        expect(seededTypes).toEqual(expectedTypes);
        expect(capture.seedInput!.groupId).toBe(GROUP_ID);
        for (const m of capture.seedInput!.modules as Array<{
          moduleType: HomeworkModuleType;
          defaultEnabled: boolean;
        }>) {
          expect(m.defaultEnabled).toBe(
            expectedEnabledByType.get(m.moduleType),
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});
