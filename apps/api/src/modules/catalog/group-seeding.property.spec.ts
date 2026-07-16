import * as fc from 'fast-check';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import { CatalogService } from './catalog.service';
import { GLOBAL_ENGLISH_MODULE_CATALOG } from './english-module-catalog';
import { CourseRepository } from './repositories/course.repository';
import { GroupModuleRepository } from './repositories/group-module.repository';
import { GroupRepository } from './repositories/group.repository';
import { LessonRepository } from './repositories/lesson.repository';

/**
 * Property — Global English catalog seeding on group creation
 * (English-Only Platform Refocus, Task 5.2, Property "8 skills seeded").
 *
 * After the refocus, the per-Specialty catalog is replaced by a single
 * global English catalog (Req 6.5). For ANY newly created group — whatever
 * its name, price, capacity, schedule, or the teacher's (now irrelevant)
 * specialty — the seeded GroupModule set is exactly the eight
 * Language_Module_Type skills of `GLOBAL_ENGLISH_MODULE_CATALOG`, with
 * `isEnabled` mirroring each catalog entry's `defaultEnabled` (Req 6.4):
 *
 *   ∀ group g created by teacher t:
 *     { gm.moduleType | gm ∈ g.modules } = { c.moduleType | c ∈ GLOBAL_ENGLISH_MODULE_CATALOG }
 *     ∧ ∀ gm ∈ g.modules: gm.isEnabled = correspondingCatalogEntry.defaultEnabled
 *     ∧ the per-Specialty catalog is never consulted
 *
 * Validates: Requirements 6.4, 6.5
 */

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';

// ----------------------------------------------------------------------------
// Generators
// ----------------------------------------------------------------------------

/**
 * Arbitrary group-creation inputs. None of these should influence the seeded
 * module set — that always comes from the global English catalog.
 */
const createGroupDtoArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  priceUzs: fc.integer({ min: 0, max: 5_000_000 }),
  capacity: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
});

/** A teacher may or may not have a specialty assigned — it must not matter. */
const specialtyIdArb = fc.option(
  fc.constantFrom('spec-a', 'spec-b', 'spec-c'),
  { nil: null },
);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildService(
  specialtyId: string | null,
  /** Captures the actual argument passed to seedForGroup for assertions. */
  capture: { seedInput?: any },
  /** Tracks whether the (now retired) specialty catalog was consulted. */
  specialtyProbe: { consulted: boolean },
): CatalogService {
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
      .mockResolvedValue({ userId: TEACHER_ID, specialtyId }),
  } as unknown as jest.Mocked<TeacherProfileRepository>;

  // If the SUT ever falls back to the specialty catalog, this records it so
  // the property can assert the per-Specialty path is fully retired.
  const specialtyService = {
    listActiveModules: jest.fn(async () => {
      specialtyProbe.consulted = true;
      return [];
    }),
  } as unknown as jest.Mocked<SpecialtyService>;

  const billingService = {} as unknown as jest.Mocked<BillingService>;
  const outboxService = {} as unknown as jest.Mocked<OutboxService>;

  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ email: 'teacher@example.com' }),
    },
    specialty: { findFirst: jest.fn().mockResolvedValue(null) },
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
  );
}

// ----------------------------------------------------------------------------
// Property
// ----------------------------------------------------------------------------

describe('CatalogService.createGroup — Property: seeds the global English catalog (8 skills) [Validates: Requirements 6.4, 6.5]', () => {
  const EXPECTED_TYPES = new Set(
    GLOBAL_ENGLISH_MODULE_CATALOG.map((c) => c.moduleType),
  );
  const EXPECTED_ENABLED_BY_TYPE = new Map<string, boolean>(
    GLOBAL_ENGLISH_MODULE_CATALOG.map((c) => [c.moduleType, c.defaultEnabled]),
  );

  it('always seeds exactly the eight global English skills, regardless of inputs or specialty', async () => {
    await fc.assert(
      fc.asyncProperty(
        createGroupDtoArb,
        specialtyIdArb,
        async (dto, specialtyId) => {
          const capture: { seedInput?: any } = {};
          const specialtyProbe = { consulted: false };
          const service = buildService(specialtyId, capture, specialtyProbe);

          const result = await service.createGroup(
            TEACHER_ID,
            COURSE_ID,
            dto as any,
          );

          // ----- 1. The seeded set equals the global English catalog -------
          const actualTypes = new Set(result.modules.map((m) => m.moduleType));
          expect(actualTypes).toEqual(EXPECTED_TYPES);
          expect(result.modules).toHaveLength(EXPECTED_TYPES.size);

          // ----- 2. isEnabled mirrors the catalog's defaultEnabled ---------
          for (const gm of result.modules) {
            expect(gm.groupId).toBe(GROUP_ID);
            expect(gm.isEnabled).toBe(
              EXPECTED_ENABLED_BY_TYPE.get(gm.moduleType),
            );
          }

          // ----- 3. Seed payload mirrors the catalog 1:1 -------------------
          expect(capture.seedInput).toBeDefined();
          const seededTypes = new Set(
            (capture.seedInput!.modules as Array<{ moduleType: string }>).map(
              (m) => m.moduleType,
            ),
          );
          expect(seededTypes).toEqual(EXPECTED_TYPES);
          expect(capture.seedInput!.groupId).toBe(GROUP_ID);

          // ----- 4. The retired per-Specialty catalog is never consulted ---
          expect(specialtyProbe.consulted).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
