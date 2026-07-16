import {
  AssignmentModule,
  GroupModule,
  HomeworkModuleType,
} from '@prisma/client';
import * as fc from 'fast-check';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupModuleRepository } from '../catalog/repositories/group-module.repository';
import { AssignmentService } from './assignment.service';
import {
  LANGUAGE_MODULE_TYPES,
  isLanguageModuleType,
} from './language-module-types';
import { AssignmentRepository } from './repositories/assignment.repository';
import { HomeworkModuleRuntimeRegistry } from './runtimes';

/**
 * Property 3 — Homework restricted to the eight English skills.
 * (English-Only Platform Refocus, design.md → "### Property 3";
 *  Task 5.4.)
 *
 *   "Assignment creation rejects any Legacy_Module_Type and only allows
 *    group-enabled language skills, validated server-side."
 *
 * Validates: Requirements 6.1, 6.3, 6.6
 *
 * Sub-properties:
 *   P3a (Req 6.1 / 6.6): For any assignment-creation request whose
 *        modules are drawn ONLY from the eight Language_Module_Type
 *        values — and which are group-enabled — creation succeeds and
 *        persists exactly the requested module set.
 *   P3b (Req 6.3): For any request containing at least one
 *        Legacy_Module_Type, creation is rejected with
 *        MODULE_TYPE_NOT_SUPPORTED and nothing is persisted.
 *   P3c (restriction across arbitrary mixes of the FULL enum): with all
 *        eight language skills group-enabled, creation succeeds iff the
 *        request is free of Legacy_Module_Type, and persists iff it
 *        succeeds.
 *
 * Approach mirrors `homework-toggle.property.spec.ts`: drive the real
 * `AssignmentService` over in-memory fakes that mirror the production
 * Prisma + outbox + repository semantics. fast-check generates a fresh
 * world per run and we assert the restriction on every replay.
 */

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const LESSON_ID = '44444444-4444-4444-4444-444444444444';

/**
 * The full set of HomeworkModuleType enum values, mirroring
 * `packages/db/prisma/schema.prisma`. Spelled out here so the test
 * surfaces a counter-example if the enum drifts from the SUT. The first
 * eight are the Language_Module_Type values; the remainder are
 * Legacy_Module_Type values that assignment creation must reject.
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

const LEGACY_MODULE_TYPES: HomeworkModuleType[] = ALL_MODULE_TYPES.filter(
  (t) => !isLanguageModuleType(t),
);

// ----------------------------------------------------------------------------
// World fake
// ----------------------------------------------------------------------------

interface World {
  /** All GroupModule rows for GROUP_ID. */
  groupModules: Map<HomeworkModuleType, GroupModule>;
  /** Persisted assignments (id → modules) — used to assert that a
   *  rejected request persists nothing. */
  assignments: Map<
    string,
    { id: string; lessonId: string; modules: AssignmentModule[] }
  >;
}

function newWorld(): World {
  return {
    groupModules: new Map(),
    assignments: new Map(),
  };
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

function buildGroupModuleRepository(
  world: World,
): jest.Mocked<GroupModuleRepository> {
  return {
    seedForGroup: jest.fn(),
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

function buildAssignmentRepository(
  world: World,
): jest.Mocked<AssignmentRepository> {
  return {
    findById: jest.fn(),
    findByIdWithOwnership: jest.fn(),
    findLessonOwnership: jest
      .fn()
      .mockResolvedValue({ groupId: GROUP_ID, teacherId: TEACHER_ID }),
    listByLesson: jest.fn(),
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

function buildOutboxService(): jest.Mocked<OutboxService> {
  return {
    create: jest.fn().mockResolvedValue('outbox-id'),
    createMany: jest.fn(),
  } as unknown as jest.Mocked<OutboxService>;
}

/**
 * `$transaction` shim that runs the callback with `prisma` itself as the
 * tx — same pattern as the other property tests in this repo.
 */
function buildPrismaFake(): any {
  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
      fn(prisma),
    ),
  };
  return prisma;
}

interface Services {
  assignment: AssignmentService;
  groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  assignmentRepository: jest.Mocked<AssignmentRepository>;
  world: World;
}

function buildServices(world: World): Services {
  const prisma = buildPrismaFake();
  const groupModuleRepository = buildGroupModuleRepository(world);
  const assignmentRepository = buildAssignmentRepository(world);
  const outboxService = buildOutboxService();
  // Strip the default runtimes — the generator passes opaque configJson
  // values that would not satisfy the per-type runtime schemas. The
  // runtime layer is covered by its own tests; here we focus on the
  // module-type restriction gate.
  const runtimeRegistry = new HomeworkModuleRuntimeRegistry();
  (runtimeRegistry as any).runtimes.clear();

  const assignment = new AssignmentService(
    prisma,
    assignmentRepository,
    groupModuleRepository,
    outboxService,
    runtimeRegistry,
  );

  return { assignment, groupModuleRepository, assignmentRepository, world };
}

/** Seed every language skill as group-enabled. */
function seedAllLanguageSkillsEnabled(world: World): void {
  for (const t of LANGUAGE_MODULE_TYPES) {
    world.groupModules.set(t, buildGroupModule(t, true));
  }
}

function createForLesson(
  services: Services,
  types: HomeworkModuleType[],
): Promise<
  | { ok: true; value: { modules: AssignmentModule[] } }
  | { ok: false; error: any }
> {
  return services.assignment
    .createForLesson({ userId: TEACHER_ID, role: 'TEACHER' }, LESSON_ID, {
      title: 'pbt',
      modules: types.map((type, i) => ({
        type,
        order: i,
        configJson: {},
        weight: 100,
      })),
    })
    .then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
}

// Keep COURSE_ID referenced so an unused-import style lint stays quiet and
// the constant documents the lesson→group→course chain the fakes model.
void COURSE_ID;

// ============================================================================
// Property tests
// ============================================================================

describe('Property 3 — Homework restricted to eight skills [Validates: Requirements 6.1, 6.3, 6.6]', () => {
  // --------------------------------------------------------------------------
  // P3a — Language-only, group-enabled requests succeed.
  //   Validates: Req 6.1, 6.6
  // --------------------------------------------------------------------------
  it('P3a: a non-empty request using only the eight (group-enabled) language skills always succeeds and persists exactly those modules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...LANGUAGE_MODULE_TYPES), {
          minLength: 1,
          maxLength: LANGUAGE_MODULE_TYPES.length,
        }),
        async (requested) => {
          const world = newWorld();
          seedAllLanguageSkillsEnabled(world);
          const services = buildServices(world);

          const result = await createForLesson(services, requested);

          expect(result.ok).toBe(true);
          if (result.ok) {
            const types = result.value.modules.map((m) => m.type);
            expect(new Set(types)).toEqual(new Set(requested));
            // Every persisted type is one of the eight language skills.
            for (const t of types) {
              expect(isLanguageModuleType(t)).toBe(true);
            }
          }
          expect(world.assignments.size).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // P3b — Any Legacy_Module_Type in the request is rejected.
  //   Validates: Req 6.3
  // --------------------------------------------------------------------------
  it('P3b: a request containing at least one Legacy_Module_Type is rejected with MODULE_TYPE_NOT_SUPPORTED and persists nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // At least one legacy type, plus an arbitrary (possibly empty)
        // set of language types, shuffled together.
        fc
          .tuple(
            fc.uniqueArray(fc.constantFrom(...LEGACY_MODULE_TYPES), {
              minLength: 1,
              maxLength: LEGACY_MODULE_TYPES.length,
            }),
            fc.uniqueArray(fc.constantFrom(...LANGUAGE_MODULE_TYPES), {
              minLength: 0,
              maxLength: LANGUAGE_MODULE_TYPES.length,
            }),
          )
          .chain(([legacy, language]) =>
            fc
              .shuffledSubarray([...legacy, ...language], {
                minLength: legacy.length + language.length,
                maxLength: legacy.length + language.length,
              })
              .map((mixed) => ({ mixed, legacy })),
          ),
        async ({ mixed, legacy }) => {
          const world = newWorld();
          // Even with every language skill enabled, the legacy gate must
          // fire first and reject before the enablement check.
          seedAllLanguageSkillsEnabled(world);
          const services = buildServices(world);

          const result = await createForLesson(services, mixed);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.response?.code).toBe(
              'MODULE_TYPE_NOT_SUPPORTED',
            );
            // Every reported unsupported type is a legacy type and the
            // set matches exactly the legacy types in the request.
            const reported: HomeworkModuleType[] =
              result.error.response?.details?.unsupported ?? [];
            expect(new Set(reported)).toEqual(new Set(legacy));
            for (const t of reported) {
              expect(isLanguageModuleType(t)).toBe(false);
            }
          }
          // Nothing persisted, and the legacy gate ran before any group
          // lookup or repository write.
          expect(world.assignments.size).toBe(0);
          expect(
            services.assignmentRepository.createWithModules,
          ).not.toHaveBeenCalled();
          expect(
            services.groupModuleRepository.listByGroup,
          ).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // P3c — Restriction holds across arbitrary mixes of the FULL enum.
  //   Validates: Req 6.1, 6.3, 6.6
  // --------------------------------------------------------------------------
  it('P3c: with all language skills enabled, creation succeeds iff the request is free of Legacy_Module_Type, and persists iff it succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...ALL_MODULE_TYPES), {
          minLength: 1,
          maxLength: ALL_MODULE_TYPES.length,
        }),
        async (requested) => {
          const world = newWorld();
          seedAllLanguageSkillsEnabled(world);
          const services = buildServices(world);

          const hasLegacy = requested.some((t) => !isLanguageModuleType(t));

          const result = await createForLesson(services, requested);

          if (hasLegacy) {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.response?.code).toBe(
                'MODULE_TYPE_NOT_SUPPORTED',
              );
            }
            expect(world.assignments.size).toBe(0);
          } else {
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(new Set(result.value.modules.map((m) => m.type))).toEqual(
                new Set(requested),
              );
            }
            expect(world.assignments.size).toBe(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
