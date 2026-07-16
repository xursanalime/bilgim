import { BadRequestException } from '@nestjs/common';
import { CefrLevel, Course, Group } from '@prisma/client';
import * as fc from 'fast-check';

import {
  EffectiveLevelSource,
  LevelingService,
  computeEffectiveLevel,
} from './leveling.service';
import { LevelingRepository } from './repositories/leveling.repository';

/**
 * Property 2 — Level required for new courses + group inheritance/override.
 * (Task 2.3 from .kiro/specs/english-only-platform-refocus/tasks.md)
 *
 * From design.md "### Property 2":
 *   "A new Course cannot be published without a CEFR level; group level
 *    inherits course level unless overridden."
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5.
 *
 * This file ONLY implements Property 2. It is split into the two invariants
 * that statement asserts, each expressed as a fast-check property over
 * arbitrary course/group CEFR combinations:
 *
 *   P2a (publish-gating, Req 3.5): `assertCoursePublishable` rejects with a
 *       `COURSE_LEVEL_REQUIRED` validation error iff the course has no CEFR
 *       level, and otherwise resolves. Publish is gated exactly on the
 *       presence of a level.
 *
 *   P2b (inheritance/override, Req 3.1/3.3/3.4): the effective level a group
 *       exposes is the group override when present, else the inherited
 *       course level, else none. A group override always takes precedence,
 *       and clearing it (null) falls back to inheritance — driven through the
 *       real `setGroupLevel` write and re-read via `getEffectiveGroupLevel`.
 *
 * Approach mirrors the established repo style (see
 * `homework/homework-toggle.property.spec.ts`): drive the real
 * `LevelingService` over an in-memory fake of `LevelingRepository` that
 * mirrors the production Prisma ownership/mutation semantics, and assert the
 * invariants on every generated world.
 */

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';

/** The six CEFR levels, mirroring the Prisma `CefrLevel` enum (Req 3.1). */
const ALL_CEFR_LEVELS: CefrLevel[] = [
  CefrLevel.A1,
  CefrLevel.A2,
  CefrLevel.B1,
  CefrLevel.B2,
  CefrLevel.C1,
  CefrLevel.C2,
];

/** Arbitrary CEFR level, or `null` for the UNASSIGNED / no-override case. */
const cefrOrNullArb: fc.Arbitrary<CefrLevel | null> = fc.constantFrom<
  Array<CefrLevel | null>
>(...ALL_CEFR_LEVELS, null);

// ----------------------------------------------------------------------------
// World fake — a single course with one group, mutable CEFR levels.
// ----------------------------------------------------------------------------

interface World {
  course: { id: string; teacherId: string; cefrLevel: CefrLevel | null };
  group: { id: string; courseId: string; cefrLevel: CefrLevel | null };
}

function newWorld(
  courseLevel: CefrLevel | null,
  groupLevel: CefrLevel | null,
): World {
  return {
    course: { id: COURSE_ID, teacherId: TEACHER_ID, cefrLevel: courseLevel },
    group: { id: GROUP_ID, courseId: COURSE_ID, cefrLevel: groupLevel },
  };
}

/**
 * Build a `LevelingRepository` fake whose reads/writes operate over the
 * mutable `world`. Only the methods exercised by Property 2 carry behavior;
 * the rest throw so an accidental dependency surfaces loudly rather than
 * silently passing.
 */
function buildRepository(world: World): jest.Mocked<LevelingRepository> {
  return {
    findCourseById: jest.fn(async (id: string) =>
      id === world.course.id ? ({ ...world.course } as Course) : null,
    ),
    setCourseLevel: jest.fn(
      async (
        id: string,
        teacherId: string,
        data: { cefrLevel: CefrLevel; examTrack?: string | null },
      ) => {
        if (id === world.course.id && teacherId === world.course.teacherId) {
          world.course.cefrLevel = data.cefrLevel;
          return { count: 1 };
        }
        return { count: 0 };
      },
    ),
    findGroupWithCourse: jest.fn(async (id: string) =>
      id === world.group.id
        ? ({
            ...world.group,
            course: {
              teacherId: world.course.teacherId,
              cefrLevel: world.course.cefrLevel,
            },
          } as Group & {
            course: { teacherId: string; cefrLevel: CefrLevel | null };
          })
        : null,
    ),
    setGroupLevel: jest.fn(
      async (id: string, teacherId: string, cefrLevel: CefrLevel | null) => {
        if (id === world.group.id && teacherId === world.course.teacherId) {
          world.group.cefrLevel = cefrLevel;
          return { count: 1 };
        }
        return { count: 0 };
      },
    ),
    getCurrentCefrLevel: jest.fn(async () => {
      throw new Error('not exercised by Property 2');
    }),
    applyProficiencyChange: jest.fn(async () => {
      throw new Error('not exercised by Property 2');
    }),
    findProficiencyHistory: jest.fn(async () => {
      throw new Error('not exercised by Property 2');
    }),
    instructorTeachesLearner: jest.fn(async () => {
      throw new Error('not exercised by Property 2');
    }),
  } as unknown as jest.Mocked<LevelingRepository>;
}

/** Independent oracle for the inheritance/override rule (Req 3.3, 3.4). */
function expectedEffective(
  courseLevel: CefrLevel | null,
  groupLevel: CefrLevel | null,
): { effectiveLevel: CefrLevel | null; source: EffectiveLevelSource } {
  if (groupLevel !== null) {
    return { effectiveLevel: groupLevel, source: 'GROUP_OVERRIDE' };
  }
  if (courseLevel !== null) {
    return { effectiveLevel: courseLevel, source: 'COURSE_INHERITED' };
  }
  return { effectiveLevel: null, source: 'UNASSIGNED' };
}

// ============================================================================
// Property tests
// ============================================================================

describe('Property 2 — Level required + inheritance/override [Validates: Requirements 3.1, 3.3, 3.4, 3.5]', () => {
  // --------------------------------------------------------------------------
  // P2a — Publish is gated exactly on the presence of a CEFR level.
  //   Validates: Req 3.5 (and 3.1 — a level is mandatory before publish).
  // --------------------------------------------------------------------------
  it('P2a: assertCoursePublishable rejects with COURSE_LEVEL_REQUIRED iff the course has no CEFR level', async () => {
    await fc.assert(
      fc.asyncProperty(cefrOrNullArb, async (courseLevel) => {
        const world = newWorld(courseLevel, null);
        const repo = buildRepository(world);
        const service = new LevelingService(repo);

        const result = await service.assertCoursePublishable(COURSE_ID).then(
          () => ({ ok: true as const }),
          (e) => ({ ok: false as const, error: e }),
        );

        if (courseLevel === null) {
          // No level → publish must be rejected, and the error must name the
          // missing CEFR level so the instructor knows how to fix it.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBeInstanceOf(BadRequestException);
            expect(result.error.getResponse()).toMatchObject({
              code: 'COURSE_LEVEL_REQUIRED',
            });
          }
        } else {
          // A level is present → publish guard passes for every CEFR value.
          expect(result.ok).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------------
  // P2b — A group's effective level is override-first, else inherited.
  //   Validates: Req 3.3 (inherit), Req 3.4 (override precedence).
  // --------------------------------------------------------------------------
  it('P2b: getEffectiveGroupLevel resolves override → inherited → unassigned for every course/group combination', async () => {
    await fc.assert(
      fc.asyncProperty(
        cefrOrNullArb,
        cefrOrNullArb,
        async (courseLevel, groupLevel) => {
          const world = newWorld(courseLevel, groupLevel);
          const repo = buildRepository(world);
          const service = new LevelingService(repo);

          const result = await service.getEffectiveGroupLevel(
            TEACHER_ID,
            GROUP_ID,
          );
          const oracle = expectedEffective(courseLevel, groupLevel);

          expect(result.groupLevel).toBe(groupLevel);
          expect(result.courseLevel).toBe(courseLevel);
          expect(result.effectiveLevel).toBe(oracle.effectiveLevel);
          expect(result.source).toBe(oracle.source);

          // The pure resolver must agree with the service path (single
          // source of truth for the inheritance/override rule).
          expect(
            computeEffectiveLevel(courseLevel, groupLevel),
          ).toEqual(oracle);

          // Override precedence invariant: when the group has its own level
          // it ALWAYS wins, even if it equals the course level; when it has
          // none, the effective level is exactly the inherited course level.
          if (groupLevel !== null) {
            expect(result.effectiveLevel).toBe(groupLevel);
            expect(result.source).toBe('GROUP_OVERRIDE');
          } else {
            expect(result.effectiveLevel).toBe(courseLevel);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // --------------------------------------------------------------------------
  // P2c — Writing an override takes precedence; clearing it (null) restores
  //       inheritance. Drives the real setGroupLevel mutation end-to-end.
  //   Validates: Req 3.3, 3.4.
  // --------------------------------------------------------------------------
  it('P2c: setGroupLevel(override) wins over the course level; setGroupLevel(null) falls back to inheritance', async () => {
    await fc.assert(
      fc.asyncProperty(
        cefrOrNullArb, // course level (inheritance source)
        cefrOrNullArb, // initial group override
        cefrOrNullArb, // newly written group override (null = clear)
        async (courseLevel, initialGroupLevel, writtenGroupLevel) => {
          const world = newWorld(courseLevel, initialGroupLevel);
          const repo = buildRepository(world);
          const service = new LevelingService(repo);

          const written = await service.setGroupLevel(TEACHER_ID, GROUP_ID, {
            cefrLevel: writtenGroupLevel,
          });
          const oracle = expectedEffective(courseLevel, writtenGroupLevel);

          // The write returns the freshly-resolved effective level so the
          // caller never has to re-read.
          expect(written.groupLevel).toBe(writtenGroupLevel);
          expect(written.courseLevel).toBe(courseLevel);
          expect(written.effectiveLevel).toBe(oracle.effectiveLevel);
          expect(written.source).toBe(oracle.source);

          // A subsequent read reflects the persisted override and resolves
          // identically — the write is durable and the rule is stable.
          const reread = await service.getEffectiveGroupLevel(
            TEACHER_ID,
            GROUP_ID,
          );
          expect(reread.groupLevel).toBe(writtenGroupLevel);
          expect(reread.effectiveLevel).toBe(oracle.effectiveLevel);
          expect(reread.source).toBe(oracle.source);

          if (writtenGroupLevel !== null) {
            // Override set → it wins regardless of the course level.
            expect(reread.effectiveLevel).toBe(writtenGroupLevel);
            expect(reread.source).toBe('GROUP_OVERRIDE');
          } else {
            // Override cleared → group inherits the course level exactly.
            expect(reread.effectiveLevel).toBe(courseLevel);
            expect(reread.source).toBe(
              courseLevel === null ? 'UNASSIGNED' : 'COURSE_INHERITED',
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
