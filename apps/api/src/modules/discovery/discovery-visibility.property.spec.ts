import { NotFoundException } from '@nestjs/common';
import * as fc from 'fast-check';
import { Prisma } from '@prisma/client';

import { DiscoveryService } from './discovery.service';
import { DiscoveryRepository } from './repositories/discovery.repository';

/**
 * Property 10 — Discovery visibility respects `isDiscoverable` /
 * `isPublished` / `publicSlug`
 * (Task 15.3 from .kiro/specs/edubridge-platform/tasks.md)
 *
 *   ∀ Course c where c.isDiscoverable = false OR c.isPublished = false:
 *     c ∉ DiscoveryService.listCourses(*)
 *     ∧ DiscoveryService.getCourseById(c.id) → 404 NotFoundException
 *
 *   ∀ TeacherProfile t where t.publicSlug = NULL
 *     OR t owns no Course with isPublished = true ∧ isDiscoverable = true:
 *     t ∉ DiscoveryService.listTeachers(*)
 *
 * This file ONLY implements Property 10 from the design document.
 *
 * Validates: Requirements 14.2, 14.3, 14.4
 *
 * Approach: drive the real `DiscoveryService` (and through it, the real
 * `DiscoveryRepository`) over an in-memory Prisma fake. The fake is
 * deliberately schema-aware about *only* the `where`-clause constructs the
 * production repository emits — `isPublished`, `isDiscoverable`,
 * `publicSlug: { not: null }`, `courses: { some: ... }`, range/contains
 * filters, cursor pagination — so we exercise the actual visibility
 * predicates the repository ships, not a parallel reimplementation.
 *
 * fast-check generates a fresh universe per run:
 *   - teachers with assorted (publicSlug ∈ {null, "slug-…"}, specialtyId)
 *   - courses with assorted (teacherId, isPublished, isDiscoverable, level,
 *     fromPriceUzs, title, description)
 *
 * Then for each universe we run a battery of `listCourses`, `getCourseById`
 * and `listTeachers` calls under a sweep of filter combinations and assert
 * the three visibility invariants on every response.
 */

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

interface FakeTeacher {
  userId: string;
  publicSlug: string | null;
  fullName: string | null;
  headline: string | null;
  coverUrl: string | null;
  rating: Prisma.Decimal | null;
  studentsCount: number;
  createdAt: Date;
  specialtyId: string | null;
  specialty: {
    id: string;
    slug: string;
    nameUz: string;
    nameRu: string;
    nameEn: string;
  } | null;
}

interface FakeCourse {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  coverUrl: string | null;
  fromPriceUzs: number | null;
  isPublished: boolean;
  isDiscoverable: boolean;
  teacherId: string;
  createdAt: Date;
}

class FakeDB {
  teachers = new Map<string, FakeTeacher>();
  courses = new Map<string, FakeCourse>();

  coursesByTeacher(teacherId: string): FakeCourse[] {
    return [...this.courses.values()].filter((c) => c.teacherId === teacherId);
  }
}

// ---------------------------------------------------------------------------
// `where`-clause evaluators — schema-aware about ONLY the constructs the
// production repository emits. Anything else throws so silent drift in the
// repository surfaces immediately as a noisy test failure.
// ---------------------------------------------------------------------------

const SUPPORTED_COURSE_KEYS = new Set([
  'id',
  'isPublished',
  'isDiscoverable',
  'teacher',
  'level',
  'fromPriceUzs',
  'OR',
]);

const SUPPORTED_TEACHER_KEYS = new Set([
  'publicSlug',
  'courses',
  'specialtyId',
  'OR',
]);

function ilikeMatch(haystack: string | null, pattern: string): boolean {
  if (haystack === null) return false;
  return haystack.toLowerCase().includes(pattern.toLowerCase());
}

function matchesNumberFilter(
  value: number | null,
  filter: { gte?: number; lte?: number },
): boolean {
  if (value === null) return false;
  if (filter.gte !== undefined && value < filter.gte) return false;
  if (filter.lte !== undefined && value > filter.lte) return false;
  return true;
}

function courseMatches(
  db: FakeDB,
  course: FakeCourse,
  where: any,
): boolean {
  for (const key of Object.keys(where)) {
    if (!SUPPORTED_COURSE_KEYS.has(key)) {
      throw new Error(
        `Course where-clause uses unsupported key '${key}' — update the property fake to mirror the new repository query.`,
      );
    }
  }

  if (where.id !== undefined && course.id !== where.id) return false;
  if (where.isPublished !== undefined && course.isPublished !== where.isPublished)
    return false;
  if (
    where.isDiscoverable !== undefined &&
    course.isDiscoverable !== where.isDiscoverable
  )
    return false;

  if (where.level !== undefined && course.level !== where.level) return false;

  if (where.fromPriceUzs !== undefined) {
    if (!matchesNumberFilter(course.fromPriceUzs, where.fromPriceUzs))
      return false;
  }

  if (where.teacher !== undefined) {
    const teacher = db.teachers.get(course.teacherId);
    if (!teacher) return false;
    if (
      where.teacher.specialtyId !== undefined &&
      teacher.specialtyId !== where.teacher.specialtyId
    )
      return false;
  }

  if (where.OR !== undefined) {
    const anyMatch = (where.OR as any[]).some((clause) => {
      if (clause.title?.contains !== undefined) {
        return ilikeMatch(course.title, clause.title.contains);
      }
      if (clause.description?.contains !== undefined) {
        return ilikeMatch(course.description, clause.description.contains);
      }
      throw new Error(
        `Unsupported OR clause for Course: ${JSON.stringify(clause)}`,
      );
    });
    if (!anyMatch) return false;
  }

  return true;
}

function teacherMatches(
  db: FakeDB,
  teacher: FakeTeacher,
  where: any,
): boolean {
  for (const key of Object.keys(where)) {
    if (!SUPPORTED_TEACHER_KEYS.has(key)) {
      throw new Error(
        `TeacherProfile where-clause uses unsupported key '${key}' — update the property fake to mirror the new repository query.`,
      );
    }
  }

  if (where.publicSlug !== undefined) {
    // Repository emits `{ not: null }` — be strict about the shape.
    if (
      typeof where.publicSlug !== 'object' ||
      !('not' in where.publicSlug) ||
      where.publicSlug.not !== null
    ) {
      throw new Error(
        `TeacherProfile.publicSlug filter must be { not: null } — got ${JSON.stringify(where.publicSlug)}`,
      );
    }
    if (teacher.publicSlug === null) return false;
  }

  if (where.specialtyId !== undefined && teacher.specialtyId !== where.specialtyId)
    return false;

  if (where.courses !== undefined) {
    if (where.courses.some === undefined) {
      throw new Error(
        `TeacherProfile.courses filter must use { some: ... } — got ${JSON.stringify(where.courses)}`,
      );
    }
    const innerWhere = where.courses.some;
    const owned = db.coursesByTeacher(teacher.userId);
    const anyMatch = owned.some((c) => courseMatches(db, c, innerWhere));
    if (!anyMatch) return false;
  }

  if (where.OR !== undefined) {
    const anyMatch = (where.OR as any[]).some((clause) => {
      if (clause.fullName?.contains !== undefined) {
        return ilikeMatch(teacher.fullName, clause.fullName.contains);
      }
      if (clause.headline?.contains !== undefined) {
        return ilikeMatch(teacher.headline, clause.headline.contains);
      }
      if (clause.publicSlug?.contains !== undefined) {
        return ilikeMatch(teacher.publicSlug, clause.publicSlug.contains);
      }
      throw new Error(
        `Unsupported OR clause for TeacherProfile: ${JSON.stringify(clause)}`,
      );
    });
    if (!anyMatch) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Pagination helper — mirrors Prisma's cursor + skip semantics for the
// `(createdAt DESC, id DESC)` ordering the repository uses.
// ---------------------------------------------------------------------------

function applyCursorPagination<T extends { createdAt: Date }>(
  rows: T[],
  pickId: (row: T) => string,
  args: { take: number; cursor?: { id?: string; userId?: string }; skip?: number },
): T[] {
  // Stable order: createdAt desc, id desc.
  const sorted = [...rows].sort((a, b) => {
    const dt = b.createdAt.getTime() - a.createdAt.getTime();
    if (dt !== 0) return dt;
    return pickId(b).localeCompare(pickId(a));
  });

  let startIndex = 0;
  if (args.cursor) {
    const cursorId = args.cursor.id ?? args.cursor.userId;
    const idx = sorted.findIndex((r) => pickId(r) === cursorId);
    if (idx === -1) return [];
    startIndex = idx + (args.skip ?? 0);
  }

  return sorted.slice(startIndex, startIndex + Math.max(args.take, 0));
}

// ---------------------------------------------------------------------------
// Build a Prisma-shaped fake. Implements ONLY what DiscoveryRepository uses.
// ---------------------------------------------------------------------------

function projectCourseRow(db: FakeDB, course: FakeCourse) {
  const teacher = db.teachers.get(course.teacherId);
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    level: course.level,
    coverUrl: course.coverUrl,
    fromPriceUzs: course.fromPriceUzs,
    createdAt: course.createdAt,
    teacher: teacher
      ? {
          userId: teacher.userId,
          publicSlug: teacher.publicSlug,
          fullName: teacher.fullName,
          headline: teacher.headline,
          coverUrl: teacher.coverUrl,
          rating: teacher.rating,
          studentsCount: teacher.studentsCount,
          specialty: teacher.specialty,
        }
      : null,
  };
}

function projectTeacherRow(db: FakeDB, teacher: FakeTeacher, countWhere: any) {
  const courseCount = db
    .coursesByTeacher(teacher.userId)
    .filter((c) => courseMatches(db, c, countWhere))
    .length;
  return {
    userId: teacher.userId,
    publicSlug: teacher.publicSlug,
    fullName: teacher.fullName,
    headline: teacher.headline,
    coverUrl: teacher.coverUrl,
    rating: teacher.rating,
    studentsCount: teacher.studentsCount,
    createdAt: teacher.createdAt,
    specialty: teacher.specialty,
    _count: { courses: courseCount },
  };
}

function buildFakePrisma(db: FakeDB): {
  client: any;
  callLog: { courseFindManyWhere: any[]; teacherFindManyWhere: any[] };
} {
  const callLog = {
    courseFindManyWhere: [] as any[],
    teacherFindManyWhere: [] as any[],
  };

  const courseTable = {
    findMany: jest.fn(async (args: any) => {
      callLog.courseFindManyWhere.push(args.where);
      const matches = [...db.courses.values()].filter((c) =>
        courseMatches(db, c, args.where ?? {}),
      );
      const paged = applyCursorPagination(matches, (c) => c.id, {
        take: args.take,
        cursor: args.cursor,
        skip: args.skip,
      });
      return paged.map((c) => projectCourseRow(db, c));
    }),
    findFirst: jest.fn(async (args: any) => {
      const where = args.where ?? {};
      const matches = [...db.courses.values()].filter((c) =>
        courseMatches(db, c, where),
      );
      const first = matches[0];
      return first ? projectCourseRow(db, first) : null;
    }),
  };

  const teacherProfileTable = {
    findMany: jest.fn(async (args: any) => {
      callLog.teacherFindManyWhere.push(args.where);
      const matches = [...db.teachers.values()].filter((t) =>
        teacherMatches(db, t, args.where ?? {}),
      );
      const paged = applyCursorPagination(matches, (t) => t.userId, {
        take: args.take,
        cursor: args.cursor,
        skip: args.skip,
      });
      // The select asks for `_count: { select: { courses: { where } } }`.
      const countWhere =
        args.select?._count?.select?.courses?.where ?? {};
      return paged.map((t) => projectTeacherRow(db, t, countWhere));
    }),
  };

  const client: any = {
    course: courseTable,
    teacherProfile: teacherProfileTable,
  };
  return { client, callLog };
}

// ---------------------------------------------------------------------------
// Universe arbitraries
// ---------------------------------------------------------------------------

interface Universe {
  teachers: FakeTeacher[];
  courses: FakeCourse[];
}

const SPECIALTY_IDS = ['s-ielts', 's-math', 's-physics'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

function makeSpecialty(id: string) {
  return {
    id,
    slug: id,
    nameUz: id.toUpperCase(),
    nameRu: id.toUpperCase(),
    nameEn: id.toUpperCase(),
  };
}

const teacherArb = fc
  .record({
    suffix: fc.integer({ min: 0, max: 999 }),
    hasSlug: fc.boolean(),
    specialtyId: fc.option(fc.constantFrom(...SPECIALTY_IDS), { nil: null }),
    fullName: fc.option(
      fc.stringMatching(/^[a-zA-Z]{3,12}$/),
      { nil: null, freq: 4 },
    ),
    headline: fc.option(
      fc.stringMatching(/^[a-zA-Z ]{3,20}$/),
      { nil: null, freq: 4 },
    ),
    studentsCount: fc.integer({ min: 0, max: 9999 }),
    createdAtOffset: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .map((r): FakeTeacher => {
    const userId = `t-${r.suffix}`;
    return {
      userId,
      publicSlug: r.hasSlug ? `slug-${userId}` : null,
      fullName: r.fullName,
      headline: r.headline,
      coverUrl: null,
      rating: null,
      studentsCount: r.studentsCount,
      createdAt: new Date(2026, 0, 1, 0, 0, 0, r.createdAtOffset),
      specialtyId: r.specialtyId,
      specialty: r.specialtyId ? makeSpecialty(r.specialtyId) : null,
    };
  });

function courseArb(teacherIds: string[]) {
  return fc
    .record({
      suffix: fc.integer({ min: 0, max: 9999 }),
      teacherId: fc.constantFrom(...teacherIds),
      isPublished: fc.boolean(),
      isDiscoverable: fc.boolean(),
      level: fc.option(fc.constantFrom(...LEVELS), { nil: null, freq: 4 }),
      fromPriceUzs: fc.option(
        fc.integer({ min: 50_000, max: 1_500_000 }),
        { nil: null, freq: 5 },
      ),
      title: fc.stringMatching(/^[a-zA-Z]{3,15}$/),
      description: fc.option(
        fc.stringMatching(/^[a-zA-Z ]{3,30}$/),
        { nil: null, freq: 4 },
      ),
      createdAtOffset: fc.integer({ min: 0, max: 1_000_000 }),
    })
    .map((r): FakeCourse => ({
      id: `c-${r.suffix}`,
      title: r.title,
      description: r.description,
      level: r.level,
      coverUrl: null,
      fromPriceUzs: r.fromPriceUzs,
      isPublished: r.isPublished,
      isDiscoverable: r.isDiscoverable,
      teacherId: r.teacherId,
      createdAt: new Date(2026, 0, 1, 0, 0, 0, r.createdAtOffset),
    }));
}

const universeArb: fc.Arbitrary<Universe> = fc
  .array(teacherArb, { minLength: 1, maxLength: 5 })
  .chain((teachersRaw) => {
    // Dedupe teachers by userId (suffix could collide).
    const dedupedTeachers = Array.from(
      new Map(teachersRaw.map((t) => [t.userId, t])).values(),
    );
    const teacherIds = dedupedTeachers.map((t) => t.userId);
    return fc
      .array(courseArb(teacherIds), { minLength: 0, maxLength: 12 })
      .map((coursesRaw) => {
        // Dedupe by course id.
        const dedupedCourses = Array.from(
          new Map(coursesRaw.map((c) => [c.id, c])).values(),
        );
        return { teachers: dedupedTeachers, courses: dedupedCourses };
      });
  });

// Filter sweep — assorted query shapes including no filter, narrow filters,
// and combinations that exercise the OR / range branches in the repository.
interface FilterCase {
  scope: 'courses' | 'teachers';
  q?: string;
  specialtyId?: string;
  level?: string;
  priceMin?: number;
  priceMax?: number;
  pageSize?: number;
}

const FILTER_CASES: FilterCase[] = [
  { scope: 'courses' },
  { scope: 'courses', specialtyId: 's-ielts' },
  { scope: 'courses', level: 'B1' },
  { scope: 'courses', priceMin: 100_000, priceMax: 500_000 },
  { scope: 'courses', q: 'aa' },
  { scope: 'courses', pageSize: 2 },
  { scope: 'teachers' },
  { scope: 'teachers', specialtyId: 's-math' },
  { scope: 'teachers', q: 'aa' },
  { scope: 'teachers', pageSize: 2 },
];

// ---------------------------------------------------------------------------
// Test wiring
// ---------------------------------------------------------------------------

function loadUniverse(db: FakeDB, universe: Universe): void {
  for (const t of universe.teachers) db.teachers.set(t.userId, t);
  for (const c of universe.courses) db.courses.set(c.id, c);
}

function makeService(db: FakeDB): {
  service: DiscoveryService;
  callLog: ReturnType<typeof buildFakePrisma>['callLog'];
} {
  const { client, callLog } = buildFakePrisma(db);
  const repository = new DiscoveryRepository(client as any);
  // CacheService is best-effort in production; a no-op cache keeps the
  // property focused on visibility rather than caching behaviour. The
  // stub mirrors `getOrSet`'s contract: always invoke the fetcher.
  const noopCache = {
    getOrSet: jest.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
      fetcher(),
    ),
  };
  const service = new DiscoveryService(repository, noopCache as any);
  return { service, callLog };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Discovery visibility (Property 10)', () => {
  /**
   * **Validates: Requirements 14.2, 14.3, 14.4**
   *
   * For any random universe of courses with assorted (isPublished,
   * isDiscoverable) flags and teachers with assorted (publicSlug,
   * course-set) shapes, none of the three Discovery surfaces ever leaks a
   * row that should be hidden from visitors.
   */
  it('listCourses, getCourseById and listTeachers never expose hidden rows', async () => {
    await fc.assert(
      fc.asyncProperty(universeArb, async (universe) => {
        const db = new FakeDB();
        loadUniverse(db, universe);
        const { service } = makeService(db);

        // ----------------------------------------------------------------
        // I1: listCourses(*) ⊆ { c | c.isPublished ∧ c.isDiscoverable }
        // ----------------------------------------------------------------
        for (const filter of FILTER_CASES.filter((f) => f.scope === 'courses')) {
          const page = await service.listCourses({
            ...(filter.q !== undefined && { q: filter.q }),
            ...(filter.specialtyId !== undefined && {
              specialtyId: filter.specialtyId,
            }),
            ...(filter.level !== undefined && { level: filter.level }),
            ...(filter.priceMin !== undefined && {
              priceMin: filter.priceMin,
            }),
            ...(filter.priceMax !== undefined && {
              priceMax: filter.priceMax,
            }),
            ...(filter.pageSize !== undefined && {
              pageSize: filter.pageSize,
            }),
          });
          for (const item of page.items) {
            const original = db.courses.get(item.id);
            if (!original) {
              throw new Error(
                `listCourses returned course ${item.id} that does not exist in the universe`,
              );
            }
            if (!original.isPublished || !original.isDiscoverable) {
              throw new Error(
                `[I1 violated] listCourses(${JSON.stringify(filter)}) returned hidden course ${item.id} (isPublished=${original.isPublished}, isDiscoverable=${original.isDiscoverable})`,
              );
            }
          }
        }

        // ----------------------------------------------------------------
        // I2: getCourseById(c.id) → 404 ∀ c with !isPublished ∨ !isDiscoverable
        //     getCourseById(c.id) → c       ∀ c with isPublished ∧ isDiscoverable
        // ----------------------------------------------------------------
        for (const course of db.courses.values()) {
          if (!course.isPublished || !course.isDiscoverable) {
            await expect(service.getCourseById(course.id)).rejects.toBeInstanceOf(
              NotFoundException,
            );
          } else {
            const fetched = await service.getCourseById(course.id);
            expect(fetched.id).toBe(course.id);
          }
        }

        // Bonus: a never-existing id is also a 404 (not a leak path).
        await expect(
          service.getCourseById('c-does-not-exist'),
        ).rejects.toBeInstanceOf(NotFoundException);

        // ----------------------------------------------------------------
        // I3: listTeachers(*) ⊆
        //   { t | t.publicSlug ≠ null
        //         ∧ ∃ c ∈ courses(t). c.isPublished ∧ c.isDiscoverable }
        // ----------------------------------------------------------------
        const teacherIsVisible = (t: FakeTeacher): boolean => {
          if (t.publicSlug === null) return false;
          return db
            .coursesByTeacher(t.userId)
            .some((c) => c.isPublished && c.isDiscoverable);
        };

        for (const filter of FILTER_CASES.filter((f) => f.scope === 'teachers')) {
          const page = await service.listTeachers({
            ...(filter.q !== undefined && { q: filter.q }),
            ...(filter.specialtyId !== undefined && {
              specialtyId: filter.specialtyId,
            }),
            ...(filter.pageSize !== undefined && {
              pageSize: filter.pageSize,
            }),
          });
          for (const item of page.items) {
            const original = db.teachers.get(item.id);
            if (!original) {
              throw new Error(
                `listTeachers returned teacher ${item.id} that does not exist in the universe`,
              );
            }
            if (!teacherIsVisible(original)) {
              const owned = db.coursesByTeacher(original.userId);
              throw new Error(
                `[I3 violated] listTeachers(${JSON.stringify(filter)}) returned hidden teacher ${item.id} ` +
                  `(publicSlug=${original.publicSlug}, ` +
                  `publicCourses=${owned.filter((c) => c.isPublished && c.isDiscoverable).length}/${owned.length})`,
              );
            }
            // Slug is what the public page binds to — and it must mirror
            // the teacher's stored publicSlug exactly.
            expect(item.slug).toBe(original.publicSlug);
          }
        }
      }),
      // Keep the run snappy in CI but wide enough to hit the corner cases
      // (e.g. teacher whose only course is hidden, course on a teacher
      // with publicSlug=null but isPublished=true, etc.).
      { numRuns: 50 },
    );
  });
});
