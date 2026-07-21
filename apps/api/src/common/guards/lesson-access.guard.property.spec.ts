import { ForbiddenException } from '@nestjs/common';
import * as fc from 'fast-check';

import { LessonAccessGuard } from './lesson-access.guard';

/**
 * Property 1 — Enrollment access invariant
 * (Task 2.4 from .kiro/specs/edubridge-platform/tasks.md)
 *
 * For any (user, lesson, enrollment) triple, the LessonAccessGuard allows
 * access iff:
 *   user.role = ADMIN
 *   ∨ (user.role = TEACHER ∧ lesson.group.course.teacherId = user.id)
 *   ∨ (user.role = STUDENT
 *        ∧ ∃ enrollment(groupId = lesson.groupId,
 *                       studentId = user.id,
 *                       status = APPROVED))
 *
 * This file ONLY implements Property 1 from the design document.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

// ----------------------------------------------------------------------------
// Generators
// ----------------------------------------------------------------------------

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
type EnrollmentStatus =
  | 'APPROVED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'REVOKED'
  | 'PAUSED';

const roleArb: fc.Arbitrary<Role> = fc.constantFrom('ADMIN', 'TEACHER', 'STUDENT');

const enrollmentStatusArb: fc.Arbitrary<EnrollmentStatus> = fc.constantFrom(
  'APPROVED',
  'PENDING_APPROVAL',
  'REJECTED',
  'REVOKED',
  'PAUSED',
);

/**
 * Triple = everything the access decision depends on.
 *  - role: requester's role
 *  - userId: requester's id
 *  - ownerTeacherId: id of the teacher who owns the lesson's course
 *  - groupId: lesson.groupId
 *  - hasEnrollment: whether an Enrollment row exists for (groupId, userId)
 *  - enrollmentStatus: status of that row (only relevant when hasEnrollment=true)
 *
 * We deliberately allow the requester id to coincide with the owning
 * teacher id so we explore both the OWNING_TEACHER and NOT_OWNING_TEACHER
 * branches naturally.
 */
const tripleArb = fc.record({
  role: roleArb,
  userId: fc.constantFrom('user-1', 'user-2', 'user-3'),
  ownerTeacherId: fc.constantFrom('user-1', 'user-2', 'teacher-X'),
  groupId: fc.constantFrom('group-A', 'group-B'),
  hasEnrollment: fc.boolean(),
  enrollmentStatus: enrollmentStatusArb,
});

type Triple = ReturnType<typeof tripleArb.generate> extends fc.Value<infer T>
  ? T
  : never;

// ----------------------------------------------------------------------------
// Spec predicate — derived directly from design.md Property 1.
// ----------------------------------------------------------------------------

function specCanRead(t: Triple): boolean {
  if (t.role === 'ADMIN') return true;
  if (t.role === 'TEACHER') return t.userId === t.ownerTeacherId;
  // STUDENT
  return t.hasEnrollment && t.enrollmentStatus === 'APPROVED';
}

/**
 * When the spec says the access is denied, which Forbidden code does the
 * guard emit?
 */
function specDeniedCode(t: Triple): string {
  // Only invoked when specCanRead(t) === false.
  if (t.role === 'TEACHER') return 'NOT_OWNING_TEACHER';
  // STUDENT path — both "no enrollment" and "not APPROVED" map to
  // LESSON_ACCESS_DENIED in the guard (Req 6.2, 6.6).
  return 'LESSON_ACCESS_DENIED';
}

// ----------------------------------------------------------------------------
// Guard wiring under test
// ----------------------------------------------------------------------------

const LESSON_ID = 'lesson-1';

function makePrismaMock(t: Triple) {
  return {
    lesson: {
      findUnique: jest.fn().mockResolvedValue({
        id: LESSON_ID,
        groupId: t.groupId,
        title: 'Lesson 1',
        group: {
          id: t.groupId,
          course: { teacherId: t.ownerTeacherId },
        },
      }),
    },
    enrollment: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          t.hasEnrollment
            ? {
                id: 'enrollment-1',
                groupId: t.groupId,
                studentId: t.userId,
                status: t.enrollmentStatus,
              }
            : null,
        ),
    },
  };
}

function makeContext(t: Triple) {
  const request: any = {
    user: { sub: t.userId, role: t.role },
    params: { id: LESSON_ID },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

// ----------------------------------------------------------------------------
// Property
// ----------------------------------------------------------------------------

describe('LessonAccessGuard — Property 1: Enrollment access invariant', () => {
  it('canRead(user, lesson) ⟺ ADMIN ∨ owning TEACHER ∨ APPROVED STUDENT [Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5]', async () => {
    await fc.assert(
      fc.asyncProperty(tripleArb, async (t) => {
        const prisma = makePrismaMock(t);
        const guard = new LessonAccessGuard(prisma as any);
        const ctx = makeContext(t);

        const expectedAllow = specCanRead(t);

        if (expectedAllow) {
          await expect(guard.canActivate(ctx)).resolves.toBe(true);
        } else {
          // Must reject, and with a Forbidden* error whose code matches
          // the spec.
          let thrown: unknown;
          try {
            await guard.canActivate(ctx);
          } catch (err) {
            thrown = err;
          }
          if (!(thrown instanceof ForbiddenException)) {
            throw new Error(
              `Expected ForbiddenException for triple ${JSON.stringify(t)}, got ${
                thrown === undefined ? 'allow=true' : String(thrown)
              }`,
            );
          }
          const response = (thrown as ForbiddenException).getResponse() as {
            code?: string;
          };
          if (response?.code !== specDeniedCode(t)) {
            throw new Error(
              `Expected denied code ${specDeniedCode(t)} for triple ${JSON.stringify(
                t,
              )}, got ${response?.code}`,
            );
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
