/**
 * Unit tests — Submission lifecycle state transitions (Task 18.6).
 *
 * Validates Requirements 12.1, 12.2, 12.5, 12.7, 12.8 — the canonical
 * Submission state machine:
 *
 *   DRAFT ──submit──▶ SUBMITTED ──grade──▶ GRADED ──return──▶ RETURNED
 *                          │                  │                    │
 *                          │                  └──return──▶ RETURNED │
 *                          └─(AI precheck)──▶ IN_REVIEW ──grade──▶ GRADED
 *                                                                  │
 *                                                                  └─resubmit──▶ SUBMITTED
 *
 * Scope: this file complements `submission.service.spec.ts` by exercising
 * the lifecycle from a "table of valid/invalid transitions" angle so the
 * state machine cannot silently grow new transitions without a test
 * change. Each transition is asserted both for the happy path and for
 * the "wrong source state" rejection branch.
 *
 * The PrismaService is mocked through plain jest mocks following the same
 * pattern as `submission.service.spec.ts` — no Prisma client is touched.
 */

import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  Submission,
  SubmissionStatus,
} from '@prisma/client';

import { OutboxService } from '../../../infra/outbox/outbox.service';
import { SubmissionService } from '../submission.service';
import {
  SubmissionRepository,
  SubmissionWithContext,
} from '../repositories/submission.repository';
import { HomeworkModuleRuntimeRegistry } from '../runtimes';

// --------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------

const TEACHER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEACHER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ASSIGNMENT_ID = '33333333-3333-3333-3333-333333333333';
const LESSON_ID = '44444444-4444-4444-4444-444444444444';
const GROUP_ID = '55555555-5555-5555-5555-555555555555';
const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';
const ENROLLMENT_ID = '77777777-7777-7777-7777-777777777777';

function makeSubmission(
  status: SubmissionStatus,
  overrides: Partial<SubmissionWithContext> = {},
): SubmissionWithContext {
  return {
    id: SUBMISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID,
    enrollmentId: ENROLLMENT_ID,
    status,
    answersJson: {},
    score: null,
    aiFlagged: false,
    aiLikelihood: null,
    submittedAt: status === 'DRAFT' ? null : new Date(),
    gradedAt: status === 'GRADED' ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignment: {
      id: ASSIGNMENT_ID,
      lessonId: LESSON_ID,
      totalPoints: 100,
      lesson: {
        id: LESSON_ID,
        groupId: GROUP_ID,
        group: {
          id: GROUP_ID,
          course: { teacherId: TEACHER_ID },
        },
      },
    },
    ...overrides,
  } as SubmissionWithContext;
}

interface Harness {
  service: SubmissionService;
  repo: jest.Mocked<SubmissionRepository>;
  outbox: jest.Mocked<OutboxService>;
  prisma: { $transaction: jest.Mock };
  txClient: Record<string, unknown>;
  queue: { add: jest.Mock };
}

function buildHarness(): Harness {
  const txClient: Record<string, unknown> = {};
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(txClient),
    ),
  };
  const repo = {
    findByIdWithContext: jest.fn(),
    findByAssignmentAndStudent: jest.fn(),
    listByAssignment: jest.fn(),
    findAssignmentContext: jest.fn(),
    findApprovedEnrollment: jest.fn(),
    createDraft: jest.fn(),
    updateAnswers: jest.fn(),
    transitionToSubmitted: jest.fn(),
    transitionToGraded: jest.fn(),
    transitionToReturned: jest.fn(),
    addFeedback: jest.fn(),
    getStatus: jest.fn(),
    listAssignmentModules: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SubmissionRepository>;
  const outbox = {
    create: jest.fn().mockResolvedValue('outbox-id'),
    createMany: jest.fn(),
  } as unknown as jest.Mocked<OutboxService>;
  // Empty registry — these tests do not exercise per-module validation.
  const registry = new HomeworkModuleRuntimeRegistry();
  (registry as unknown as { runtimes: Map<unknown, unknown> }).runtimes.clear();
  const queue = { add: jest.fn().mockResolvedValue({ id: 'q-1' }) };
  const service = new SubmissionService(
    prisma as never,
    repo,
    outbox,
    registry,
    queue as never,
  );
  return { service, repo, outbox, prisma, txClient, queue };
}

// --------------------------------------------------------------------
// Tests — happy-path transitions
// --------------------------------------------------------------------

describe('Submission lifecycle — happy-path transitions (Req 12.7)', () => {
  it('DRAFT → SUBMITTED via student submit()', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('DRAFT'))
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'));
    h.repo.transitionToSubmitted.mockResolvedValue(1);

    const result = await h.service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe<SubmissionStatus>('SUBMITTED');
    expect(h.repo.transitionToSubmitted).toHaveBeenCalledWith(
      SUBMISSION_ID,
      h.txClient,
    );
    // Lifecycle event emitted exactly once.
    expect(h.outbox.create).toHaveBeenCalledTimes(1);
    expect(h.outbox.create).toHaveBeenCalledWith(
      h.txClient,
      expect.objectContaining({
        topic: 'submission.submitted',
        idempotencyKey: `submission.submitted:${SUBMISSION_ID}`,
      }),
    );
  });

  it('SUBMITTED → GRADED via teacher grade()', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'))
      .mockResolvedValueOnce(makeSubmission('GRADED', { score: 85 }));
    h.repo.transitionToGraded.mockResolvedValue(1);

    const result = await h.service.grade(
      { userId: TEACHER_ID, role: 'TEACHER' },
      SUBMISSION_ID,
      { score: 85 },
    );

    expect(result.status).toBe<SubmissionStatus>('GRADED');
    expect(h.repo.transitionToGraded).toHaveBeenCalledWith(
      SUBMISSION_ID,
      85,
      h.txClient,
    );
    expect(h.outbox.create).toHaveBeenCalledWith(
      h.txClient,
      expect.objectContaining({
        topic: 'homework.graded',
        idempotencyKey: `homework.graded:${SUBMISSION_ID}`,
      }),
    );
  });

  it('IN_REVIEW → GRADED via teacher grade() (post-AI-precheck path)', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('IN_REVIEW'))
      .mockResolvedValueOnce(makeSubmission('GRADED', { score: 90 }));
    h.repo.transitionToGraded.mockResolvedValue(1);

    const result = await h.service.grade(
      { userId: TEACHER_ID, role: 'TEACHER' },
      SUBMISSION_ID,
      { score: 90 },
    );

    expect(result.status).toBe<SubmissionStatus>('GRADED');
  });

  it('GRADED → RETURNED via teacher returnToStudent()', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('GRADED', { score: 60 }))
      .mockResolvedValueOnce(makeSubmission('RETURNED'));
    h.repo.transitionToReturned.mockResolvedValue(1);

    const result = await h.service.returnToStudent(
      { userId: TEACHER_ID, role: 'TEACHER' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe<SubmissionStatus>('RETURNED');
  });

  it('IN_REVIEW → RETURNED via teacher returnToStudent()', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('IN_REVIEW'))
      .mockResolvedValueOnce(makeSubmission('RETURNED'));
    h.repo.transitionToReturned.mockResolvedValue(1);

    const result = await h.service.returnToStudent(
      { userId: TEACHER_ID, role: 'TEACHER' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe<SubmissionStatus>('RETURNED');
  });

  it('RETURNED → SUBMITTED via student re-submit()', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('RETURNED'))
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'));
    h.repo.transitionToSubmitted.mockResolvedValue(1);

    const result = await h.service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe<SubmissionStatus>('SUBMITTED');
  });
});

// --------------------------------------------------------------------
// Tests — invalid transitions
// --------------------------------------------------------------------

describe('Submission lifecycle — invalid transitions (Req 12.7)', () => {
  it.each(['SUBMITTED', 'IN_REVIEW', 'GRADED'] as const)(
    'submit() from %s is rejected with INVALID_SUBMISSION_TRANSITION',
    async (status) => {
      const h = buildHarness();
      h.repo.findByIdWithContext.mockResolvedValue(makeSubmission(status));

      await expect(
        h.service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
      expect(h.repo.transitionToSubmitted).not.toHaveBeenCalled();
      expect(h.outbox.create).not.toHaveBeenCalled();
    },
  );

  it.each(['DRAFT', 'GRADED', 'RETURNED'] as const)(
    'grade() from %s is rejected with INVALID_SUBMISSION_TRANSITION',
    async (status) => {
      const h = buildHarness();
      h.repo.findByIdWithContext.mockResolvedValue(makeSubmission(status));

      await expect(
        h.service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 80 },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
      expect(h.repo.transitionToGraded).not.toHaveBeenCalled();
      expect(h.outbox.create).not.toHaveBeenCalled();
    },
  );

  it.each(['DRAFT', 'SUBMITTED', 'RETURNED'] as const)(
    'returnToStudent() from %s is rejected with INVALID_SUBMISSION_TRANSITION',
    async (status) => {
      const h = buildHarness();
      h.repo.findByIdWithContext.mockResolvedValue(makeSubmission(status));

      await expect(
        h.service.returnToStudent(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
      expect(h.repo.transitionToReturned).not.toHaveBeenCalled();
    },
  );
});

// --------------------------------------------------------------------
// Tests — race conditions on conditional updates
// --------------------------------------------------------------------

describe('Submission lifecycle — concurrent transitions raise 409', () => {
  it('submit(): transitionToSubmitted returning 0 rolls back the outbox emit', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(makeSubmission('DRAFT'));
    h.repo.transitionToSubmitted.mockResolvedValue(0);

    await expect(
      h.service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.outbox.create).not.toHaveBeenCalled();
    expect(h.queue.add).not.toHaveBeenCalled();
  });

  it('grade(): transitionToGraded returning 0 rolls back the outbox emit', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(makeSubmission('SUBMITTED'));
    h.repo.transitionToGraded.mockResolvedValue(0);

    await expect(
      h.service.grade(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { score: 80 },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.outbox.create).not.toHaveBeenCalled();
  });

  it('returnToStudent(): transitionToReturned returning 0 rolls back', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(
      makeSubmission('GRADED', { score: 60 }),
    );
    h.repo.transitionToReturned.mockResolvedValue(0);

    await expect(
      h.service.returnToStudent(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

// --------------------------------------------------------------------
// Tests — full lifecycle walk-through (smoke)
// --------------------------------------------------------------------

describe('Submission lifecycle — full DRAFT → SUBMITTED → GRADED → RETURNED → SUBMITTED walk', () => {
  it('exercises every transition in order with the right outbox emissions', async () => {
    const h = buildHarness();

    // Step 1: submit (DRAFT → SUBMITTED)
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('DRAFT'))
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'));
    h.repo.transitionToSubmitted.mockResolvedValue(1);
    expect(
      (
        await h.service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        )
      ).status,
    ).toBe<SubmissionStatus>('SUBMITTED');

    // Step 2: grade (SUBMITTED → GRADED)
    h.repo.findByIdWithContext.mockReset();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'))
      .mockResolvedValueOnce(makeSubmission('GRADED', { score: 80 }));
    h.repo.transitionToGraded.mockResolvedValue(1);
    expect(
      (
        await h.service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 80 },
        )
      ).status,
    ).toBe<SubmissionStatus>('GRADED');

    // Step 3: returnToStudent (GRADED → RETURNED)
    h.repo.findByIdWithContext.mockReset();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('GRADED', { score: 80 }))
      .mockResolvedValueOnce(makeSubmission('RETURNED'));
    h.repo.transitionToReturned.mockResolvedValue(1);
    expect(
      (
        await h.service.returnToStudent(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          {},
        )
      ).status,
    ).toBe<SubmissionStatus>('RETURNED');

    // Step 4: re-submit (RETURNED → SUBMITTED)
    h.repo.findByIdWithContext.mockReset();
    h.repo.findByIdWithContext
      .mockResolvedValueOnce(makeSubmission('RETURNED'))
      .mockResolvedValueOnce(makeSubmission('SUBMITTED'));
    h.repo.transitionToSubmitted.mockResolvedValue(1);
    expect(
      (
        await h.service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        )
      ).status,
    ).toBe<SubmissionStatus>('SUBMITTED');

    // Outbox emissions sanity: exactly two submit events, one graded
    // event over the lifecycle.
    const topics = h.outbox.create.mock.calls.map(
      (c) => (c[1] as { topic: string }).topic,
    );
    expect(topics.filter((t) => t === 'submission.submitted')).toHaveLength(2);
    expect(topics.filter((t) => t === 'homework.graded')).toHaveLength(1);
  });
});

// --------------------------------------------------------------------
// Tests — authorization on transitions
// --------------------------------------------------------------------

describe('Submission lifecycle — role-based access on transitions (Req 12.5, 17.5, 17.6)', () => {
  it('grade(): rejects a non-owning teacher with NOT_OWNING_TEACHER', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(makeSubmission('SUBMITTED'));

    await expect(
      h.service.grade(
        { userId: OTHER_TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { score: 80 },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_OWNING_TEACHER' }),
    });
  });

  it('grade(): rejects a STUDENT caller with FORBIDDEN', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(makeSubmission('SUBMITTED'));

    await expect(
      h.service.grade(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        { score: 80 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('submit(): rejects another student touching the row (cross-student access)', async () => {
    const h = buildHarness();
    h.repo.findByIdWithContext.mockResolvedValue(
      makeSubmission('DRAFT', {
        studentId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }),
    );

    await expect(
      h.service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// --------------------------------------------------------------------
// Tests — score validation on grade transition (Req 12.5)
// --------------------------------------------------------------------

describe('Submission lifecycle — score validation on grade (Req 12.5)', () => {
  it.each([-1, 101, 1000])(
    'grade() rejects out-of-range score %s with SCORE_OUT_OF_RANGE (totalPoints=100)',
    async (score) => {
      const h = buildHarness();
      h.repo.findByIdWithContext.mockResolvedValue(
        makeSubmission('SUBMITTED'),
      );

      await expect(
        h.service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SCORE_OUT_OF_RANGE',
          details: expect.objectContaining({ totalPoints: 100, score }),
        }),
      });
      expect(h.repo.transitionToGraded).not.toHaveBeenCalled();
    },
  );

  it.each([0, 50, 100])(
    'grade() accepts in-range score %s (totalPoints=100)',
    async (score) => {
      const h = buildHarness();
      h.repo.findByIdWithContext
        .mockResolvedValueOnce(makeSubmission('SUBMITTED'))
        .mockResolvedValueOnce(makeSubmission('GRADED', { score }));
      h.repo.transitionToGraded.mockResolvedValue(1);

      const result = await h.service.grade(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { score },
      );

      expect(result.status).toBe<SubmissionStatus>('GRADED');
    },
  );
});

// Type-level smoke: ensure the SubmissionStatus enum still has every
// status the lifecycle relies on so a future Prisma schema change that
// removes one of these is caught at compile time.
const _statusGuard: SubmissionStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'GRADED',
  'RETURNED',
];
void _statusGuard;
// Ensure unused Submission import keeps the file type-checking against
// the latest @prisma/client schema (the import is also useful in editor
// completions for the makeSubmission helper).
type _SubmissionTypeGuard = Submission;
