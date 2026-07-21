import {
  AssignmentModule,
  GroupModule,
  HomeworkModuleType,
  Prisma,
  SpecialtyModule,
} from '@prisma/client';
import * as fc from 'fast-check';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupChatRepository } from '../group-chat/repositories/group-chat.repository';
import { CatalogService } from '../catalog/catalog.service';
import { CourseRepository } from '../catalog/repositories/course.repository';
import { GroupModuleRepository } from '../catalog/repositories/group-module.repository';
import { GroupRepository } from '../catalog/repositories/group.repository';
import { LessonRepository } from '../catalog/repositories/lesson.repository';
import { BillingService } from '../billing/billing.service';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import { AssignmentService } from './assignment.service';
import {
  HomeworkService,
  SPECIALTY_MODULE_ACTIVE_CAP,
} from './homework.service';
import { AssignmentRepository } from './repositories/assignment.repository';
import { SpecialtyModuleRepository } from './repositories/specialty-module.repository';
import { HomeworkModuleRuntimeRegistry } from './runtimes';

/**
 * Property 9 — Group-scoped homework module toggle (with specialty
 * catalog ⊇ group toggles).
 * (Task 17.4 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * Three sub-properties from design.md plus the non-destructive toggle
 * invariant from Req 11.4:
 *
 *   P9a: An Assignment may only contain modules ENABLED in its parent
 *        group at the moment it is written.
 *          ∀ assignment a, ∀ module m ∈ a.modules:
 *            ∃ GroupModule(groupId = a.lesson.groupId,
 *                          moduleType = m.type,
 *                          isEnabled = true)
 *
 *   P9b: A GroupModule may only exist for module types in the group's
 *        specialty catalog.
 *          ∀ GroupModule gm:
 *            ∃ SpecialtyModule(specialtyId = group.teacher.specialtyId,
 *                              moduleType = gm.moduleType,
 *                              isActive = true)
 *
 *   P9c: Per-specialty cap.
 *          ∀ Specialty s:
 *            |{ sm | sm.specialtyId = s.id ∧ sm.isActive }| ≤ 10
 *
 *   Non-destructive: Disabling a module never mutates rows for
 *        Assignments / AssignmentModules created while the module was
 *        enabled (Req 11.4).
 *
 * This file ONLY implements Property 9 from the design document.
 *
 * Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8
 *
 * Approach: drive the real `HomeworkService`, `CatalogService` and
 * `AssignmentService` over in-memory fakes that mirror the production
 * Prisma + outbox semantics. fast-check generates a fresh world per
 * run (specialty catalog × group toggle state × assignment plans) and
 * we assert the four invariants above on every replay.
 */

const ADMIN_ID = '00000000-0000-0000-0000-0000000000ad';
const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const SPECIALTY_ID = '11111111-1111-1111-1111-111111111111';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const LESSON_ID = '44444444-4444-4444-4444-444444444444';

/**
 * The full set of HomeworkModuleType enum values, mirroring
 * `packages/db/prisma/schema.prisma`. Spelled out here so the test
 * surfaces a counter-example if the enum drifts from the SUT.
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

// ----------------------------------------------------------------------------
// Generators
// ----------------------------------------------------------------------------

/**
 * A specialty catalog: 1..N distinct module types, each tagged with an
 * arbitrary `isActive` and `defaultEnabled`. We deliberately allow up
 * to 12 distinct types so P9c counter-examples — attempting to push
 * the active count past 10 — can shrink onto a clean failure.
 */
const specialtyCatalogArb = (maxSize = 12): fc.Arbitrary<
  Array<{
    moduleType: HomeworkModuleType;
    isActive: boolean;
    defaultEnabled: boolean;
  }>
> =>
  fc
    .uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
      minLength: 1,
      maxLength: maxSize,
    })
    .chain((moduleTypes) =>
      fc
        .tuple(
          fc.array(fc.boolean(), {
            minLength: moduleTypes.length,
            maxLength: moduleTypes.length,
          }),
          fc.array(fc.boolean(), {
            minLength: moduleTypes.length,
            maxLength: moduleTypes.length,
          }),
        )
        .map(([actives, defaults]) =>
          moduleTypes.map((moduleType, i) => ({
            moduleType,
            isActive: actives[i] as boolean,
            defaultEnabled: defaults[i] as boolean,
          })),
        ),
    );

// ----------------------------------------------------------------------------
// World fakes
// ----------------------------------------------------------------------------

interface World {
  /** All SpecialtyModule rows for SPECIALTY_ID. */
  specialtyModules: Map<HomeworkModuleType, SpecialtyModule>;
  /** All GroupModule rows for GROUP_ID. */
  groupModules: Map<HomeworkModuleType, GroupModule>;
  /** Persisted assignments (id → modules) — used to verify non-destructive
   *  toggle. Populated only by the non-destructive property test. */
  assignments: Map<
    string,
    { id: string; lessonId: string; modules: AssignmentModule[] }
  >;
  outboxKeys: Set<string>;
}

function newWorld(): World {
  return {
    specialtyModules: new Map(),
    groupModules: new Map(),
    assignments: new Map(),
    outboxKeys: new Set(),
  };
}

function buildSpecialtyModule(
  moduleType: HomeworkModuleType,
  isActive: boolean,
  defaultEnabled: boolean,
): SpecialtyModule {
  return {
    specialtyId: SPECIALTY_ID,
    moduleType,
    isActive,
    defaultEnabled,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SpecialtyModule;
}

function buildGroupModule(
  moduleType: HomeworkModuleType,
  isEnabled: boolean,
): GroupModule {
  const now = new Date();
  return {
    groupId: GROUP_ID,
    moduleType,
    isEnabled,
    enabledAt: isEnabled ? now : null,
    disabledAt: isEnabled ? null : now,
    createdAt: now,
    updatedAt: now,
  } as GroupModule;
}

function buildSpecialtyModuleRepository(
  world: World,
): jest.Mocked<SpecialtyModuleRepository> {
  return {
    listBySpecialty: jest.fn(async (_id: string) =>
      Array.from(world.specialtyModules.values()).sort((a, b) =>
        a.moduleType.localeCompare(b.moduleType),
      ),
    ),
    listActiveBySpecialty: jest.fn(async (_id: string) =>
      Array.from(world.specialtyModules.values())
        .filter((m) => m.isActive)
        .sort((a, b) => a.moduleType.localeCompare(b.moduleType)),
    ),
    countActiveBySpecialty: jest.fn(async (_id: string) =>
      Array.from(world.specialtyModules.values()).filter((m) => m.isActive)
        .length,
    ),
    findOne: jest.fn(async (_id, type) => world.specialtyModules.get(type) ?? null),
    upsert: jest.fn(async (input) => {
      const row = buildSpecialtyModule(
        input.moduleType,
        input.isActive,
        input.defaultEnabled ??
          world.specialtyModules.get(input.moduleType)?.defaultEnabled ??
          false,
      );
      world.specialtyModules.set(input.moduleType, row);
      return row;
    }),
  } as unknown as jest.Mocked<SpecialtyModuleRepository>;
}

function buildGroupModuleRepository(
  world: World,
): jest.Mocked<GroupModuleRepository> {
  return {
    seedForGroup: jest.fn(async (input: any) => {
      for (const m of input.modules) {
        world.groupModules.set(
          m.moduleType,
          buildGroupModule(m.moduleType, m.defaultEnabled),
        );
      }
      return Array.from(world.groupModules.values()).sort((a, b) =>
        a.moduleType.localeCompare(b.moduleType),
      );
    }),
    listByGroup: jest.fn(async (_id: string) =>
      Array.from(world.groupModules.values()).sort((a, b) =>
        a.moduleType.localeCompare(b.moduleType),
      ),
    ),
    findOne: jest.fn(async (_g, type) => world.groupModules.get(type) ?? null),
    countActiveByGroup: jest.fn(async (_id: string) =>
      Array.from(world.groupModules.values()).filter((m) => m.isEnabled).length,
    ),
    upsertToggle: jest.fn(async (_g, type, isEnabled) => {
      const row = buildGroupModule(type, isEnabled);
      world.groupModules.set(type, row);
      return row;
    }),
  } as unknown as jest.Mocked<GroupModuleRepository>;
}

function buildOutboxService(world: World): jest.Mocked<OutboxService> {
  return {
    create: jest.fn(async (_tx: any, input: any) => {
      if (world.outboxKeys.has(input.idempotencyKey)) return null;
      world.outboxKeys.add(input.idempotencyKey);
      return 'outbox-id';
    }),
    createMany: jest.fn(),
  } as unknown as jest.Mocked<OutboxService>;
}

function buildSpecialtyService(world: World): jest.Mocked<SpecialtyService> {
  return {
    getById: jest
      .fn()
      .mockResolvedValue({ id: SPECIALTY_ID, slug: 'spec', isActive: true }),
    findById: jest
      .fn()
      .mockResolvedValue({ id: SPECIALTY_ID, slug: 'spec', isActive: true }),
    findBySlug: jest.fn().mockResolvedValue(null),
    listActive: jest.fn().mockResolvedValue([]),
    listActiveModules: jest.fn(async () =>
      Array.from(world.specialtyModules.values())
        .filter((m) => m.isActive)
        .sort((a, b) => a.moduleType.localeCompare(b.moduleType)),
    ),
  } as unknown as jest.Mocked<SpecialtyService>;
}

function buildGroupRepository(): jest.Mocked<GroupRepository> {
  return {
    findById: jest.fn().mockResolvedValue({
      id: GROUP_ID,
      courseId: COURSE_ID,
      course: { teacherId: TEACHER_ID },
    } as any),
    findByIdWithTeacherSpecialty: jest.fn().mockResolvedValue({
      id: GROUP_ID,
      courseId: COURSE_ID,
      course: {
        teacherId: TEACHER_ID,
        teacher: { specialtyId: SPECIALTY_ID },
      },
    } as any),
    listByCourse: jest.fn().mockResolvedValue([]),
    create: jest
      .fn()
      .mockResolvedValue({ id: GROUP_ID, courseId: COURSE_ID } as any),
    updateForTeacher: jest.fn().mockResolvedValue({ count: 1 }),
    deleteForTeacher: jest.fn().mockResolvedValue({ count: 1 }),
  } as unknown as jest.Mocked<GroupRepository>;
}

function buildAssignmentRepository(
  world: World,
): jest.Mocked<AssignmentRepository> {
  return {
    findById: jest.fn(async (id: string) => {
      const a = world.assignments.get(id);
      if (!a) return null;
      return { id: a.id, lessonId: a.lessonId, modules: a.modules } as any;
    }),
    findByIdWithOwnership: jest.fn(async (id: string) => {
      const a = world.assignments.get(id);
      if (!a) return null;
      return {
        id: a.id,
        lessonId: a.lessonId,
        title: 't',
        description: null,
        dueAt: null,
        totalPoints: 100,
        isPublished: false,
        createdAt: new Date(),
        modules: a.modules,
        lesson: {
          id: LESSON_ID,
          groupId: GROUP_ID,
          group: {
            id: GROUP_ID,
            courseId: COURSE_ID,
            course: { teacherId: TEACHER_ID },
          },
        },
      } as any;
    }),
    findLessonOwnership: jest
      .fn()
      .mockResolvedValue({ groupId: GROUP_ID, teacherId: TEACHER_ID }),
    listByLesson: jest.fn(async (_l: string) =>
      Array.from(world.assignments.values()).map((a) => ({
        id: a.id,
        lessonId: a.lessonId,
        modules: a.modules,
      })) as any,
    ),
    countSubmissions: jest.fn().mockResolvedValue(0),
    createWithModules: jest.fn(async (input: any) => {
      const id = `asgn-${world.assignments.size + 1}`;
      const modules = input.modules.map((m: any, i: number) => ({
        id: `${id}-m${i}`,
        assignmentId: id,
        type: m.type,
        order: m.order,
        configJson: m.configJson,
        weight: m.weight,
      })) as AssignmentModule[];
      world.assignments.set(id, { id, lessonId: input.lessonId, modules });
      return {
        id,
        lessonId: input.lessonId,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        totalPoints: input.totalPoints ?? 100,
        isPublished: false,
        createdAt: new Date(),
        modules,
      } as any;
    }),
    updateScalars: jest.fn(),
    replaceModules: jest.fn(),
    transitionToPublished: jest.fn(),
    deleteById: jest.fn(),
  } as unknown as jest.Mocked<AssignmentRepository>;
}

/**
 * Build a `$transaction` shim that runs the callback with `prisma`
 * itself as the tx — same pattern as the rest of the property tests in
 * this repo.
 */
function buildPrismaFake(world: World): any {
  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const res = await fn(prisma);
      const active = Array.from(world.specialtyModules.values()).filter(
        (m) => m.isActive,
      ).length;
      if (active > SPECIALTY_MODULE_ACTIVE_CAP) {
        throw new Prisma.PrismaClientUnknownRequestError(
          `specialty_module_cap_exceeded: max ${SPECIALTY_MODULE_ACTIVE_CAP} active modules per specialty`,
          { clientVersion: 'test' },
        );
      }
      return res;
    }),
    adminAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    enrollment: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  return prisma;
}

interface Services {
  homework: HomeworkService;
  catalog: CatalogService;
  assignment: AssignmentService;
  specialtyService: jest.Mocked<SpecialtyService>;
  groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  assignmentRepository: jest.Mocked<AssignmentRepository>;
  world: World;
}

function buildServices(world: World): Services {
  const prisma = buildPrismaFake(world);
  const specialtyModuleRepository = buildSpecialtyModuleRepository(world);
  const groupModuleRepository = buildGroupModuleRepository(world);
  const specialtyService = buildSpecialtyService(world);
  const outboxService = buildOutboxService(world);
  const teacherProfileRepository = {
    findByUserId: jest
      .fn()
      .mockResolvedValue({ userId: TEACHER_ID, specialtyId: SPECIALTY_ID }),
  } as unknown as jest.Mocked<TeacherProfileRepository>;
  const groupRepository = buildGroupRepository();
  const courseRepository = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: COURSE_ID, teacherId: TEACHER_ID }),
    create: jest.fn(),
    listByTeacher: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<CourseRepository>;
  const lessonRepository = {} as unknown as jest.Mocked<LessonRepository>;
  const billingService = {
    requireActiveSubscription: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<BillingService>;
  const groupChatRepository = {
    upsertRoomForGroup: jest.fn().mockResolvedValue({ id: 'room-1', scopeRef: GROUP_ID, createdAt: new Date() }),
    addOwner: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<GroupChatRepository>;
  const assignmentRepository = buildAssignmentRepository(world);
  // Use a fresh registry but strip the default runtimes — the property
  // generator passes opaque configJson values that would not satisfy
  // WritingRuntime / ReadingRuntime schemas. The runtime layer is
  // covered by its own unit tests; here we focus on the toggle gate.
  const runtimeRegistry = new HomeworkModuleRuntimeRegistry();
  (runtimeRegistry as any).runtimes.clear();

  const homework = new HomeworkService(
    prisma,
    specialtyModuleRepository,
    specialtyService,
    teacherProfileRepository,
    outboxService,
  );
  const catalog = new CatalogService(
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
  const assignment = new AssignmentService(
    prisma,
    assignmentRepository,
    groupModuleRepository,
    outboxService,
    runtimeRegistry,
  );

  return {
    homework,
    catalog,
    assignment,
    specialtyService,
    groupModuleRepository,
    assignmentRepository,
    world,
  };
}

// ============================================================================
// Property tests
// ============================================================================

describe('Property 9 — Group-scoped homework module toggle [Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8]', () => {
  // --------------------------------------------------------------------------
  // P9a — Assignment may only contain ENABLED modules
  //   Validates: Req 11.5, 11.8
  // --------------------------------------------------------------------------
  it('P9a: createForLesson succeeds iff every requested module has GroupModule.isEnabled = true', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Catalog: 2..6 distinct active modules so we have enough material
        // to mix enabled + disabled in the group toggle map.
        fc
          .uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
            minLength: 2,
            maxLength: 6,
          })
          .chain((catalogTypes) =>
            fc
              .tuple(
                // Per-catalog-module isEnabled flag in GroupModule.
                fc.array(fc.boolean(), {
                  minLength: catalogTypes.length,
                  maxLength: catalogTypes.length,
                }),
                // Subset of catalog types the assignment will request,
                // possibly augmented with an off-catalog type.
                fc.subarray(catalogTypes, {
                  minLength: 1,
                  maxLength: catalogTypes.length,
                }),
                fc.boolean(), // include an off-catalog (unknown) type
              )
              .map(([flags, requestedSubset, withUnknown]) => ({
                catalog: catalogTypes.map((t, i) => ({
                  moduleType: t,
                  isEnabled: flags[i] as boolean,
                })),
                requested: withUnknown
                  ? [
                      ...requestedSubset,
                      // pick an off-catalog type for the negative path
                      ALL_MODULE_TYPES.find(
                        (t) => !catalogTypes.includes(t),
                      ) ?? requestedSubset[0]!,
                    ]
                  : requestedSubset,
              })),
          ),
        async ({ catalog, requested }) => {
          const world = newWorld();
          // Seed both layers — specialty catalog (all active) and group
          // toggle map per the generator.
          for (const c of catalog) {
            world.specialtyModules.set(
              c.moduleType,
              buildSpecialtyModule(c.moduleType, true, false),
            );
            world.groupModules.set(
              c.moduleType,
              buildGroupModule(c.moduleType, c.isEnabled),
            );
          }

          const services = buildServices(world);

          const enabledTypes = new Set(
            catalog.filter((c) => c.isEnabled).map((c) => c.moduleType),
          );
          const allRequestedEnabled = requested.every((t) =>
            enabledTypes.has(t),
          );

          const result = await services.assignment
            .createForLesson(
              { userId: TEACHER_ID, role: 'TEACHER' },
              LESSON_ID,
              {
                title: 'pbt',
                modules: requested.map((type, i) => ({
                  type,
                  order: i,
                  configJson: {},
                  weight: 100,
                })),
              },
            )
            .then(
              (r) => ({ ok: true as const, value: r }),
              (e) => ({ ok: false as const, error: e }),
            );

          if (allRequestedEnabled) {
            // Happy path — assignment persists and contains exactly the
            // requested module set.
            expect(result.ok).toBe(true);
            if (result.ok) {
              const types = result.value.modules.map((m) => m.type);
              expect(new Set(types)).toEqual(new Set(requested));
              // Every persisted module must currently be ENABLED in the
              // group toggle map (the gate we are validating).
              for (const t of types) {
                expect(world.groupModules.get(t)?.isEnabled).toBe(true);
              }
            }
          } else {
            // At least one requested module is disabled (or unknown to
            // the group). The service must reject and persist nothing.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.response?.code).toBe(
                'MODULE_NOT_ENABLED_FOR_GROUP',
              );
            }
            expect(world.assignments.size).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // P9b — GroupModule only for moduleTypes in the specialty catalog
  //   Validates: Req 11.6
  // --------------------------------------------------------------------------
  it('P9b: toggleGroupModule rejects any moduleType not in the active specialty catalog', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Catalog: 1..6 distinct module types, each independently active
        // or inactive. The non-active ones DO live in the
        // SpecialtyModule table, but they should not be reachable from
        // the group toggle.
        specialtyCatalogArb(6),
        // The module type the test will try to toggle.
        fc.constantFrom(...ALL_MODULE_TYPES),
        fc.boolean(),
        async (catalog, attempted, isEnabled) => {
          const world = newWorld();
          for (const c of catalog) {
            world.specialtyModules.set(
              c.moduleType,
              buildSpecialtyModule(c.moduleType, c.isActive, c.defaultEnabled),
            );
          }

          const services = buildServices(world);

          const inActiveCatalog = catalog.some(
            (c) => c.moduleType === attempted && c.isActive,
          );

          const result = await services.catalog
            .toggleGroupModule(
              TEACHER_ID,
              'TEACHER',
              GROUP_ID,
              attempted,
              isEnabled,
            )
            .then(
              (r) => ({ ok: true as const, value: r }),
              (e) => ({ ok: false as const, error: e }),
            );

          if (inActiveCatalog) {
            // Catalog membership is satisfied — toggle must succeed and
            // record the new state for this module type.
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value.moduleType).toBe(attempted);
              expect(result.value.isEnabled).toBe(isEnabled);
              expect(world.groupModules.get(attempted)?.isEnabled).toBe(
                isEnabled,
              );
            }
          } else {
            // Either absent or `isActive = false`. The service must reject
            // so the GroupModule table can never contain a row whose
            // moduleType isn't in the active catalog (P9b invariant).
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.response?.code).toBe(
                'MODULE_NOT_IN_SPECIALTY_CATALOG',
              );
            }
            // Crucially, no GroupModule was written for the attempted type.
            expect(world.groupModules.has(attempted)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // P9c — Per-specialty active cap of 10
  //   Validates: Req 11.1, 11.7
  // --------------------------------------------------------------------------
  it('P9c: bulkUpsertSpecialtyModules succeeds iff projected active count ≤ 10', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Initial state: 0..12 SpecialtyModule rows (active or not).
        specialtyCatalogArb(12),
        // Desired update: 1..6 module types with explicit isActive.
        fc
          .uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
            minLength: 1,
            maxLength: 6,
          })
          .chain((types) =>
            fc
              .array(fc.boolean(), {
                minLength: types.length,
                maxLength: types.length,
              })
              .map((flags) =>
                types.map((t, i) => ({
                  moduleType: t,
                  isActive: flags[i] as boolean,
                })),
              ),
          ),
        async (initialCatalog, desired) => {
          const world = newWorld();
          for (const c of initialCatalog) {
            world.specialtyModules.set(
              c.moduleType,
              buildSpecialtyModule(c.moduleType, c.isActive, c.defaultEnabled),
            );
          }

          const services = buildServices(world);

          // Compute the projected active count exactly the way the
          // service's pre-check should — this is the oracle.
          const initialActive = initialCatalog.filter((c) => c.isActive)
            .length;
          let projected = initialActive;
          for (const d of desired) {
            const prev = initialCatalog.find(
              (c) => c.moduleType === d.moduleType,
            );
            const wasActive = prev?.isActive ?? false;
            if (wasActive && !d.isActive) projected -= 1;
            if (!wasActive && d.isActive) projected += 1;
          }

          const result = await services.homework
            .bulkUpsertSpecialtyModules(
              SPECIALTY_ID,
              { modules: desired },
              ADMIN_ID,
            )
            .then(
              (r) => ({ ok: true as const, value: r }),
              (e) => ({ ok: false as const, error: e }),
            );

          if (projected <= SPECIALTY_MODULE_ACTIVE_CAP) {
            expect(result.ok).toBe(true);
            // Post-state active count must agree with the oracle.
            const postActive = Array.from(
              world.specialtyModules.values(),
            ).filter((m) => m.isActive).length;
            expect(postActive).toBe(projected);
            // Cap invariant always holds on success.
            expect(postActive).toBeLessThanOrEqual(
              SPECIALTY_MODULE_ACTIVE_CAP,
            );
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.response?.code).toBe(
                'SPECIALTY_MODULE_CAP_EXCEEDED',
              );
            }
            // The pre-check must reject before any row is mutated, so
            // the active count remains at its pre-call value.
            const postActive = Array.from(
              world.specialtyModules.values(),
            ).filter((m) => m.isActive).length;
            expect(postActive).toBe(initialActive);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // Non-destructive toggle — Req 11.4
  // --------------------------------------------------------------------------
  it('Non-destructive: flipping a module OFF leaves existing AssignmentModule rows intact', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Catalog of 2..5 active modules; we will create assignments
        // using each one and then flip them all off.
        fc.uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
          minLength: 2,
          maxLength: 5,
        }),
        async (catalogTypes) => {
          const world = newWorld();
          for (const t of catalogTypes) {
            world.specialtyModules.set(
              t,
              buildSpecialtyModule(t, true, false),
            );
            world.groupModules.set(t, buildGroupModule(t, true));
          }

          const services = buildServices(world);

          // Snapshot of the assignment rows for each module type while
          // the toggle was ON. We use one assignment per module so each
          // toggle flip has a corresponding witness assignment.
          const witnesses: Array<{
            assignmentId: string;
            modules: AssignmentModule[];
          }> = [];
          for (let i = 0; i < catalogTypes.length; i++) {
            const t = catalogTypes[i] as HomeworkModuleType;
            const created = await services.assignment.createForLesson(
              { userId: TEACHER_ID, role: 'TEACHER' },
              LESSON_ID,
              {
                title: `hw-${i}`,
                modules: [
                  { type: t, order: 0, configJson: {}, weight: 100 },
                ],
              },
            );
            witnesses.push({
              assignmentId: created.id,
              // Defensive copy so the snapshot is immune to in-place
              // edits if the SUT misbehaves.
              modules: created.modules.map((m) => ({ ...m })),
            });
          }

          // Flip every module OFF, in catalog order.
          for (const t of catalogTypes) {
            await services.catalog.toggleGroupModule(
              TEACHER_ID,
              'TEACHER',
              GROUP_ID,
              t,
              false,
            );
          }

          // Every previously-created assignment must still be present
          // and its module set must equal its pre-toggle snapshot.
          for (const w of witnesses) {
            const stored = world.assignments.get(w.assignmentId);
            expect(stored).toBeDefined();
            expect(stored!.modules).toHaveLength(w.modules.length);
            const storedTypes = stored!.modules.map((m) => m.type).sort();
            const witnessTypes = w.modules.map((m) => m.type).sort();
            expect(storedTypes).toEqual(witnessTypes);
          }

          // And the GroupModule rows reflect the flips — every row is
          // now disabled, with no row dropped from the table.
          for (const t of catalogTypes) {
            const gm = world.groupModules.get(t);
            expect(gm?.isEnabled).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
