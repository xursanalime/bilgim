import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Submission, SubmissionStatus } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { SubmissionService } from './submission.service';
import {
  SubmissionRepository,
  SubmissionWithContext,
} from './repositories/submission.repository';
import {
  HomeworkModuleRuntimeRegistry,
  WritingRuntime,
} from './runtimes';

const TEACHER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEACHER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ASSIGNMENT_ID = '33333333-3333-3333-3333-333333333333';
const LESSON_ID = '44444444-4444-4444-4444-444444444444';
const GROUP_ID = '55555555-5555-5555-5555-555555555555';
const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';
const ENROLLMENT_ID = '77777777-7777-7777-7777-777777777777';

function buildSubmission(
  overrides: Partial<SubmissionWithContext> = {},
): SubmissionWithContext {
  const base: SubmissionWithContext = {
    id: SUBMISSION_ID,
    assignmentId: ASSIGNMENT_ID,
    studentId: STUDENT_ID,
    enrollmentId: ENROLLMENT_ID,
    status: 'DRAFT' as SubmissionStatus,
    answersJson: {},
    score: null,
    aiFlagged: false,
    aiLikelihood: null,
    submittedAt: null,
    gradedAt: null,
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
  };
  return { ...base, ...overrides } as SubmissionWithContext;
}

function buildAssignmentContext(
  overrides: Partial<{
    isPublished: boolean;
    teacherId: string;
    totalPoints: number;
  }> = {},
) {
  return {
    assignmentId: ASSIGNMENT_ID,
    isPublished: overrides.isPublished ?? true,
    lessonId: LESSON_ID,
    groupId: GROUP_ID,
    teacherId: overrides.teacherId ?? TEACHER_ID,
    totalPoints: overrides.totalPoints ?? 100,
  };
}

/**
 * Unit tests for SubmissionService — Task 18.1, Req 12.1, 12.2, 12.5,
 * 12.6, 12.7, 12.8.
 *
 * Coverage:
 *   - createDraft happy path + idempotent re-create
 *   - createDraft rejects when no APPROVED enrollment
 *   - State transitions DRAFT→SUBMITTED, SUBMITTED→GRADED,
 *     GRADED→RETURNED, RETURNED→SUBMITTED
 *   - Cross-student access (student can't see another student's row)
 *   - Cross-teacher access (teacher of a different lesson can't grade)
 *   - Score validation (0..totalPoints)
 *   - Feedback creation atomicity (inside the same transaction)
 *   - `homework.graded` outbox emission with correct idempotency key
 */
describe('SubmissionService', () => {
  let service: SubmissionService;
  let prisma: any;
  let submissionRepository: jest.Mocked<SubmissionRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let aiGradingQueue: { add: jest.Mock };
  let txClient: any;

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };

    submissionRepository = {
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
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;

    // Default registry — empty so existing tests with opaque
    // answersJson payloads still pass. New tests below register the
    // WritingRuntime explicitly to exercise the runtime path.
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    (runtimeRegistry as any).runtimes.clear();

    // BullMQ queue mock — `submit()` enqueues an AiGradingJob after the
    // SUBMITTED transaction commits (Task 18.2). Tests below assert the
    // payload + jobId; older tests don't care so we just keep the spy.
    aiGradingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'ai-grading-1' }),
    };

    service = new SubmissionService(
      prisma,
      submissionRepository,
      outboxService,
      runtimeRegistry,
      aiGradingQueue as any,
    );
  });

  // ==================================================================
  // createDraft
  // ==================================================================

  describe('createDraft', () => {
    it('creates a fresh DRAFT row when none exists and the student is APPROVED', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(null);
      submissionRepository.findApprovedEnrollment.mockResolvedValue({
        id: ENROLLMENT_ID,
      });
      const created = buildSubmission();
      submissionRepository.createDraft.mockResolvedValue(created);

      const result = await service.createDraft(
        { userId: STUDENT_ID, role: 'STUDENT' },
        ASSIGNMENT_ID,
      );

      expect(result.id).toBe(SUBMISSION_ID);
      expect(submissionRepository.createDraft).toHaveBeenCalledWith({
        assignmentId: ASSIGNMENT_ID,
        studentId: STUDENT_ID,
        enrollmentId: ENROLLMENT_ID,
      });
      // The teacher-only chain is stripped from the response.
      expect((result as any).assignment).toBeUndefined();
    });

    it('is idempotent — returns the existing DRAFT row on a second call without inserting', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      const existing = buildSubmission({ status: 'DRAFT' });
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(
        existing,
      );

      const result = await service.createDraft(
        { userId: STUDENT_ID, role: 'STUDENT' },
        ASSIGNMENT_ID,
      );

      expect(result.id).toBe(SUBMISSION_ID);
      expect(submissionRepository.createDraft).not.toHaveBeenCalled();
      expect(submissionRepository.findApprovedEnrollment).not.toHaveBeenCalled();
    });

    it('re-fetches the row when a P2002 race fires on insert', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      submissionRepository.findByAssignmentAndStudent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildSubmission());
      submissionRepository.findApprovedEnrollment.mockResolvedValue({
        id: ENROLLMENT_ID,
      });
      submissionRepository.createDraft.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      const result = await service.createDraft(
        { userId: STUDENT_ID, role: 'STUDENT' },
        ASSIGNMENT_ID,
      );

      expect(result.id).toBe(SUBMISSION_ID);
    });

    it('throws ASSIGNMENT_NOT_FOUND when the assignment does not exist', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(null);

      await expect(
        service.createDraft(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ASSIGNMENT_NOT_PUBLISHED when the assignment is still a draft', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext({ isPublished: false }),
      );
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(null);

      await expect(
        service.createDraft(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ASSIGNMENT_NOT_PUBLISHED',
        }),
      });
    });

    it('throws LESSON_ACCESS_DENIED when the student has no APPROVED enrollment', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(null);
      submissionRepository.findApprovedEnrollment.mockResolvedValue(null);

      await expect(
        service.createDraft(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LESSON_ACCESS_DENIED',
        }),
      });
      expect(submissionRepository.createDraft).not.toHaveBeenCalled();
    });

    it('refuses TEACHER callers — teachers cannot create submissions', async () => {
      await expect(
        service.createDraft(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(submissionRepository.findAssignmentContext).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // updateAnswers (autosave)
  // ==================================================================

  describe('updateAnswers', () => {
    it('replaces answersJson on a DRAFT submission owned by the caller', async () => {
      const existing = buildSubmission({ status: 'DRAFT' });
      submissionRepository.findByIdWithContext.mockResolvedValue(existing);
      submissionRepository.updateAnswers.mockResolvedValue(
        buildSubmission({ answersJson: { m: { value: 'new' } } }),
      );

      await service.updateAnswers(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        { answersJson: { m: { value: 'new' } } },
      );

      expect(submissionRepository.updateAnswers).toHaveBeenCalledWith(
        SUBMISSION_ID,
        { answersJson: { m: { value: 'new' } } },
      );
    });

    it('also allows edits in RETURNED status (revision flow)', async () => {
      const existing = buildSubmission({ status: 'RETURNED' });
      submissionRepository.findByIdWithContext.mockResolvedValue(existing);
      submissionRepository.updateAnswers.mockResolvedValue(existing);

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          { answersJson: { m: { v: 1 } } },
        ),
      ).resolves.toBeDefined();
    });

    it('refuses to mutate a SUBMITTED submission (409 SUBMISSION_NOT_EDITABLE)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          { answersJson: {} },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SUBMISSION_NOT_EDITABLE',
        }),
      });
      expect(submissionRepository.updateAnswers).not.toHaveBeenCalled();
    });

    it('refuses cross-student edits with 403 FORBIDDEN', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ studentId: OTHER_STUDENT_ID, status: 'DRAFT' }),
      );

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          { answersJson: {} },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ==================================================================
  // submit (DRAFT/RETURNED → SUBMITTED)
  // ==================================================================

  describe('submit', () => {
    it('moves DRAFT → SUBMITTED, sets submittedAt, and emits submission.submitted', async () => {
      const draft = buildSubmission({ status: 'DRAFT' });
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(
          buildSubmission({
            status: 'SUBMITTED',
            submittedAt: new Date(),
          }),
        );
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);

      const result = await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );

      expect(result.status).toBe('SUBMITTED');
      expect(submissionRepository.transitionToSubmitted).toHaveBeenCalledWith(
        SUBMISSION_ID,
        txClient,
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({
          topic: 'submission.submitted',
          idempotencyKey: `submission.submitted:${SUBMISSION_ID}`,
          payload: expect.objectContaining({
            submissionId: SUBMISSION_ID,
            assignmentId: ASSIGNMENT_ID,
            studentId: STUDENT_ID,
            teacherId: TEACHER_ID,
          }),
        }),
      );

      // Task 18.2 — submit() also pushes an AiGradingJob onto the
      // dedicated `ai-grading` BullMQ queue with a deterministic
      // jobId for BullMQ-side dedup.
      expect(aiGradingQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = aiGradingQueue.add.mock.calls[0];
      expect(jobName).toBe('submission.precheck');
      expect(payload).toEqual(
        expect.objectContaining({
          submissionId: SUBMISSION_ID,
          assignmentId: ASSIGNMENT_ID,
          studentId: STUDENT_ID,
          modules: expect.any(Array),
          idempotencyKey: `ai-precheck:${SUBMISSION_ID}`,
        }),
      );
      expect(opts).toEqual(
        expect.objectContaining({
          jobId: `ai-precheck:${SUBMISSION_ID}`,
        }),
      );
    });

    it('moves RETURNED → SUBMITTED on re-submission', async () => {
      const returned = buildSubmission({ status: 'RETURNED' });
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(returned)
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }));
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);

      const result = await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );

      expect(result.status).toBe('SUBMITTED');
    });

    it('rejects with INVALID_SUBMISSION_TRANSITION from a non-editable status', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'GRADED' }),
      );

      await expect(
        service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
    });

    it('rejects cross-student submit', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ studentId: OTHER_STUDENT_ID }),
      );

      await expect(
        service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 409 when transitionToSubmitted reports zero rows updated', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.transitionToSubmitted.mockResolvedValue(0);

      await expect(
        service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.create).not.toHaveBeenCalled();
      // The AI grading queue must NOT receive a job when the submit
      // transaction rolls back — otherwise we'd grade a submission
      // that never landed in SUBMITTED.
      expect(aiGradingQueue.add).not.toHaveBeenCalled();
    });

    it('does NOT block the submit response when the AI grading enqueue fails', async () => {
      const draft = buildSubmission({ status: 'DRAFT' });
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }));
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);
      aiGradingQueue.add.mockRejectedValueOnce(new Error('redis timeout'));

      // Submit still resolves with the SUBMITTED row — the OutboxDispatcher
      // routes `submission.submitted` to `ai-grading` as a backup path
      // (see outbox.dispatcher.ts), so a transient queue failure here
      // does not lose work.
      const result = await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );
      expect(result.status).toBe('SUBMITTED');
      expect(outboxService.create).toHaveBeenCalled();
    });

    it('snapshots assignment.modules × answersJson into the AI grading job payload', async () => {
      const draft = buildSubmission({
        status: 'DRAFT',
        answersJson: {
          'mod-1': { text: 'My essay' },
          'mod-2': { value: 42 },
        },
      });
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(
          buildSubmission({
            status: 'SUBMITTED',
            answersJson: draft.answersJson,
          }),
        );
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);
      submissionRepository.listAssignmentModules.mockResolvedValue([
        {
          id: 'mod-1',
          assignmentId: ASSIGNMENT_ID,
          type: 'WRITING' as any,
          order: 0,
          configJson: { minWords: 50 },
          weight: 60,
        } as any,
        {
          id: 'mod-2',
          assignmentId: ASSIGNMENT_ID,
          type: 'MULTIPLE_CHOICE' as any,
          order: 1,
          configJson: { options: ['a', 'b'] },
          weight: 40,
        } as any,
      ]);

      await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );

      expect(aiGradingQueue.add).toHaveBeenCalledTimes(1);
      const [, payload] = aiGradingQueue.add.mock.calls[0];
      expect(payload.modules).toEqual([
        {
          type: 'WRITING',
          configJson: { minWords: 50 },
          answer: { text: 'My essay' },
        },
        {
          type: 'MULTIPLE_CHOICE',
          configJson: { options: ['a', 'b'] },
          answer: { value: 42 },
        },
      ]);
    });
  });

  // ==================================================================
  // grade (SUBMITTED/IN_REVIEW → GRADED)
  // ==================================================================

  describe('grade', () => {
    function setupSubmittedRow(): void {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }))
        .mockResolvedValueOnce(
          buildSubmission({
            status: 'GRADED',
            score: 85,
            gradedAt: new Date(),
          }),
        );
      submissionRepository.transitionToGraded.mockResolvedValue(1);
    }

    it('flips SUBMITTED → GRADED, writes feedback, and emits homework.graded', async () => {
      setupSubmittedRow();
      submissionRepository.addFeedback.mockResolvedValue({} as any);

      await service.grade(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        {
          score: 85,
          feedback: [
            { moduleId: 'm1', comment: 'Nice work', payload: { score: 5 } },
          ],
        },
      );

      expect(submissionRepository.transitionToGraded).toHaveBeenCalledWith(
        SUBMISSION_ID,
        85,
        txClient,
      );
      expect(submissionRepository.addFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: SUBMISSION_ID,
          authorType: 'TEACHER',
          authorId: TEACHER_ID,
          isFinal: true,
        }),
        txClient,
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({
          topic: 'homework.graded',
          idempotencyKey: `homework.graded:${SUBMISSION_ID}`,
          payload: expect.objectContaining({
            submissionId: SUBMISSION_ID,
            studentId: STUDENT_ID,
            teacherId: TEACHER_ID,
            score: 85,
            totalPoints: 100,
          }),
        }),
      );
    });

    it('also accepts an IN_REVIEW source state', async () => {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'IN_REVIEW' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 90 }));
      submissionRepository.transitionToGraded.mockResolvedValue(1);

      await service.grade(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { score: 90 },
      );

      expect(submissionRepository.transitionToGraded).toHaveBeenCalled();
    });

    it('rejects with SCORE_OUT_OF_RANGE when score > totalPoints', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 150 },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SCORE_OUT_OF_RANGE',
          details: expect.objectContaining({ totalPoints: 100, score: 150 }),
        }),
      });
      expect(submissionRepository.transitionToGraded).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('rejects negative scores', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: -5 },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SCORE_OUT_OF_RANGE' }),
      });
    });

    it('rejects grading from a non-owning teacher (NOT_OWNING_TEACHER)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.grade(
          { userId: OTHER_TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 80 },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_OWNING_TEACHER' }),
      });
    });

    it('refuses STUDENT callers', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.grade(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          { score: 80 },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to grade a DRAFT submission (409 INVALID_SUBMISSION_TRANSITION)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );

      await expect(
        service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 80 },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
    });

    it('does NOT emit the outbox event when transitionToGraded is a no-op', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );
      submissionRepository.transitionToGraded.mockResolvedValue(0);

      await expect(
        service.grade(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          { score: 80 },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('lets ADMIN bypass the teacher ownership check', async () => {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(
          buildSubmission({ status: 'SUBMITTED', assignment: undefined as any }),
        )
        // Refresh after grade
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 100 }));
      // Re-set with proper context for assertion
      submissionRepository.findByIdWithContext.mockReset();
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 100 }));
      submissionRepository.transitionToGraded.mockResolvedValue(1);

      await expect(
        service.grade(
          { userId: ADMIN_ID, role: 'ADMIN' },
          SUBMISSION_ID,
          { score: 100 },
        ),
      ).resolves.toBeDefined();
    });
  });

  // ==================================================================
  // returnToStudent (IN_REVIEW/GRADED → RETURNED)
  // ==================================================================

  describe('returnToStudent', () => {
    it('flips GRADED → RETURNED and stores the optional teacher comment as Feedback', async () => {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 60 }))
        .mockResolvedValueOnce(buildSubmission({ status: 'RETURNED' }));
      submissionRepository.transitionToReturned.mockResolvedValue(1);
      submissionRepository.addFeedback.mockResolvedValue({} as any);

      const result = await service.returnToStudent(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { comment: 'Please revise paragraph 2' },
      );

      expect(result.status).toBe('RETURNED');
      expect(submissionRepository.addFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: SUBMISSION_ID,
          authorType: 'TEACHER',
          authorId: TEACHER_ID,
          isFinal: false,
        }),
        txClient,
      );
    });

    it('also accepts IN_REVIEW as the source state', async () => {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'IN_REVIEW' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'RETURNED' }));
      submissionRepository.transitionToReturned.mockResolvedValue(1);

      await expect(
        service.returnToStudent(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          {},
        ),
      ).resolves.toBeDefined();
    });

    it('refuses to return from DRAFT/SUBMITTED', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'SUBMITTED' }),
      );

      await expect(
        service.returnToStudent(
          { userId: TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_SUBMISSION_TRANSITION',
        }),
      });
    });

    it('rejects cross-teacher return', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'GRADED' }),
      );

      await expect(
        service.returnToStudent(
          { userId: OTHER_TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_OWNING_TEACHER' }),
      });
    });
  });

  // ==================================================================
  // Reads
  // ==================================================================

  describe('reads', () => {
    it('getById allows the owning student', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission(),
      );

      const result = await service.getById(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
      );

      expect(result.id).toBe(SUBMISSION_ID);
      expect((result as any).assignment).toBeUndefined();
    });

    it('getById refuses cross-student read with 403 FORBIDDEN', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ studentId: OTHER_STUDENT_ID }),
      );

      await expect(
        service.getById(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('getById refuses cross-teacher read with NOT_OWNING_TEACHER', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission(),
      );

      await expect(
        service.getById(
          { userId: OTHER_TEACHER_ID, role: 'TEACHER' },
          SUBMISSION_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_OWNING_TEACHER' }),
      });
    });

    it('listForAssignment refuses STUDENT callers', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );

      await expect(
        service.listForAssignment(
          { userId: STUDENT_ID, role: 'STUDENT' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('listForAssignment refuses non-owning TEACHER', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext({ teacherId: OTHER_TEACHER_ID }),
      );

      await expect(
        service.listForAssignment(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_OWNING_TEACHER' }),
      });
    });

    it('listForAssignment returns the rows for an owning teacher', async () => {
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      const rows = [{ id: 'a' }, { id: 'b' }] as Submission[];
      submissionRepository.listByAssignment.mockResolvedValue(rows);

      const result = await service.listForAssignment(
        { userId: TEACHER_ID, role: 'TEACHER' },
        ASSIGNMENT_ID,
      );
      expect(result).toEqual(rows);
    });

    it('getMyForAssignment returns null when the student has no row yet', async () => {
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(null);

      const result = await service.getMyForAssignment(
        { userId: STUDENT_ID, role: 'STUDENT' },
        ASSIGNMENT_ID,
      );
      expect(result).toBeNull();
    });

    it('getMyForAssignment refuses non-STUDENT callers', async () => {
      await expect(
        service.getMyForAssignment(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ==================================================================
  // Full lifecycle smoke test
  // ==================================================================

  describe('full lifecycle DRAFT → SUBMITTED → GRADED → RETURNED → SUBMITTED', () => {
    it('walks through every transition with the right outbox emissions', async () => {
      // Step 1: createDraft
      submissionRepository.findAssignmentContext.mockResolvedValue(
        buildAssignmentContext(),
      );
      submissionRepository.findByAssignmentAndStudent.mockResolvedValue(null);
      submissionRepository.findApprovedEnrollment.mockResolvedValue({
        id: ENROLLMENT_ID,
      });
      submissionRepository.createDraft.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      const draft = await service.createDraft(
        { userId: STUDENT_ID, role: 'STUDENT' },
        ASSIGNMENT_ID,
      );
      expect(draft.status).toBe('DRAFT');

      // Step 2: submit (DRAFT → SUBMITTED)
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'DRAFT' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }));
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);
      const submitted = await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );
      expect(submitted.status).toBe('SUBMITTED');

      // Step 3: grade (SUBMITTED → GRADED)
      submissionRepository.findByIdWithContext.mockReset();
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 80 }));
      submissionRepository.transitionToGraded.mockResolvedValue(1);
      const graded = await service.grade(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        { score: 80 },
      );
      expect(graded.status).toBe('GRADED');

      // Step 4: return (GRADED → RETURNED)
      submissionRepository.findByIdWithContext.mockReset();
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'GRADED', score: 80 }))
        .mockResolvedValueOnce(buildSubmission({ status: 'RETURNED' }));
      submissionRepository.transitionToReturned.mockResolvedValue(1);
      const returned = await service.returnToStudent(
        { userId: TEACHER_ID, role: 'TEACHER' },
        SUBMISSION_ID,
        {},
      );
      expect(returned.status).toBe('RETURNED');

      // Step 5: re-submit (RETURNED → SUBMITTED)
      submissionRepository.findByIdWithContext.mockReset();
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(buildSubmission({ status: 'RETURNED' }))
        .mockResolvedValueOnce(buildSubmission({ status: 'SUBMITTED' }));
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);
      const resubmitted = await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {},
      );
      expect(resubmitted.status).toBe('SUBMITTED');

      // The outbox saw exactly one homework.graded and two submission.submitted.
      const topics = outboxService.create.mock.calls.map((c) => c[1].topic);
      expect(topics.filter((t) => t === 'homework.graded')).toHaveLength(1);
      expect(topics.filter((t) => t === 'submission.submitted')).toHaveLength(2);
    });
  });
});

// ====================================================================
// Runtime registry validation on answersJson (Task 18.3)
// ====================================================================

describe('SubmissionService — answersJson runtime validation (Task 18.3)', () => {
  const MODULE_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

  let service: SubmissionService;
  let prisma: any;
  let submissionRepository: jest.Mocked<SubmissionRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let aiGradingQueue: { add: jest.Mock };
  let txClient: any;

  function buildSubmission(
    overrides: Partial<SubmissionWithContext> = {},
  ): SubmissionWithContext {
    return {
      id: SUBMISSION_ID,
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      enrollmentId: ENROLLMENT_ID,
      status: 'DRAFT' as SubmissionStatus,
      answersJson: {},
      score: null,
      aiFlagged: false,
      aiLikelihood: null,
      submittedAt: null,
      gradedAt: null,
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

  function buildModuleRow(opts: {
    type?: 'WRITING' | 'READING';
    config?: unknown;
  } = {}) {
    return {
      id: MODULE_ID,
      assignmentId: ASSIGNMENT_ID,
      type: opts.type ?? 'WRITING',
      order: 0,
      configJson: opts.config ?? {
        prompt: 'Write 10..50 words',
        minWords: 10,
        maxWords: 50,
      },
      weight: 100,
    };
  }

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };
    submissionRepository = {
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
      listAssignmentModules: jest.fn(),
    } as any;
    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;
    // Real registry — WritingRuntime active by default.
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    aiGradingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'ai-grading-1' }),
    };
    service = new SubmissionService(
      prisma,
      submissionRepository,
      outboxService,
      runtimeRegistry,
      aiGradingQueue as any,
    );
  });

  describe('updateAnswers', () => {
    it('accepts a writing answer that satisfies the configured word range', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);
      submissionRepository.updateAnswers.mockResolvedValue(
        buildSubmission(),
      );

      await service.updateAnswers(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {
          answersJson: {
            [MODULE_ID]: {
              text: Array(20).fill('word').join(' '), // 20 words
            },
          },
        },
      );

      expect(submissionRepository.updateAnswers).toHaveBeenCalled();
    });

    it('rejects writing answer with too few words as ANSWER_TOO_SHORT (400)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {
            answersJson: {
              [MODULE_ID]: { text: 'too short' }, // 2 words, min=10
            },
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ANSWER_TOO_SHORT',
          details: expect.objectContaining({
            moduleId: MODULE_ID,
            type: 'WRITING',
            wordCount: 2,
            minWords: 10,
          }),
        }),
      });
      expect(submissionRepository.updateAnswers).not.toHaveBeenCalled();
    });

    it('rejects writing answer with too many words as ANSWER_TOO_LONG (400)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {
            answersJson: {
              [MODULE_ID]: {
                text: Array(60).fill('word').join(' '), // 60 words, max=50
              },
            },
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ANSWER_TOO_LONG',
        }),
      });
    });

    it('rejects answers with an invalid shape as INVALID_MODULE_ANSWER (400)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);

      await expect(
        service.updateAnswers(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {
            answersJson: {
              [MODULE_ID]: { wrong: 'shape' }, // missing required `text`
            },
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'INVALID_MODULE_ANSWER',
        }),
      });
    });

    it('ignores orphan moduleIds in the payload (no-op pass-through)', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);
      submissionRepository.updateAnswers.mockResolvedValue(buildSubmission());

      await service.updateAnswers(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {
          answersJson: {
            'unknown-module-id': { whatever: true },
          },
        },
      );

      expect(submissionRepository.updateAnswers).toHaveBeenCalled();
    });

    it('skips runtime validation when no runtime is registered for the module type', async () => {
      // Strip the writing runtime so the registered module type has no
      // runtime — the service must accept the payload as opaque JSON.
      (runtimeRegistry as any).runtimes.clear();

      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({ status: 'DRAFT' }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow({ type: 'READING' }) as any,
      ]);
      submissionRepository.updateAnswers.mockResolvedValue(buildSubmission());

      await service.updateAnswers(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {
          answersJson: { [MODULE_ID]: { anything: { goes: true } } },
        },
      );

      expect(submissionRepository.updateAnswers).toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    it('validates answersJson on submit and rejects ANSWER_TOO_SHORT', async () => {
      submissionRepository.findByIdWithContext.mockResolvedValue(
        buildSubmission({
          status: 'DRAFT',
          answersJson: { [MODULE_ID]: { text: 'short' } },
        }),
      );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);

      await expect(
        service.submit(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          {},
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ANSWER_TOO_SHORT',
        }),
      });
      expect(submissionRepository.transitionToSubmitted).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('uses the freshly supplied answersJson for validation when present', async () => {
      submissionRepository.findByIdWithContext
        .mockResolvedValueOnce(
          buildSubmission({ status: 'DRAFT', answersJson: {} }),
        )
        .mockResolvedValueOnce(
          buildSubmission({ status: 'SUBMITTED' }),
        );
      submissionRepository.listAssignmentModules.mockResolvedValue([
        buildModuleRow() as any,
      ]);
      submissionRepository.transitionToSubmitted.mockResolvedValue(1);
      submissionRepository.updateAnswers.mockResolvedValue(
        buildSubmission(),
      );

      await service.submit(
        { userId: STUDENT_ID, role: 'STUDENT' },
        SUBMISSION_ID,
        {
          answersJson: {
            [MODULE_ID]: { text: Array(20).fill('w').join(' ') },
          },
        },
      );

      expect(submissionRepository.transitionToSubmitted).toHaveBeenCalled();
      expect(outboxService.create).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({ topic: 'submission.submitted' }),
      );
    });
  });
});


// ====================================================================
// AI text detection on submit (Task 20.3)
// ====================================================================

describe('SubmissionService — AI text detection on submit (Task 20.3)', () => {
  let service: SubmissionService;
  let prisma: any;
  let submissionRepository: jest.Mocked<SubmissionRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let aiGradingQueue: { add: jest.Mock };
  let aiTextDetect: { detect: jest.Mock };
  let txClient: any;
  let txSubmissionUpdateMany: jest.Mock;

  function buildSubmissionRow(
    overrides: Partial<SubmissionWithContext> = {},
  ): SubmissionWithContext {
    return {
      id: SUBMISSION_ID,
      assignmentId: ASSIGNMENT_ID,
      studentId: STUDENT_ID,
      enrollmentId: ENROLLMENT_ID,
      status: 'DRAFT' as SubmissionStatus,
      answersJson: { 'mod-1': { text: 'student essay text here' } },
      score: null,
      aiFlagged: false,
      aiLikelihood: null,
      submittedAt: null,
      gradedAt: null,
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

  beforeEach(() => {
    txSubmissionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    txClient = {
      submission: { updateMany: txSubmissionUpdateMany },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };
    submissionRepository = {
      findByIdWithContext: jest.fn(),
      findByAssignmentAndStudent: jest.fn(),
      listByAssignment: jest.fn(),
      findAssignmentContext: jest.fn(),
      findApprovedEnrollment: jest.fn(),
      createDraft: jest.fn(),
      updateAnswers: jest.fn(),
      transitionToSubmitted: jest.fn().mockResolvedValue(1),
      transitionToGraded: jest.fn(),
      transitionToReturned: jest.fn(),
      addFeedback: jest.fn(),
      getStatus: jest.fn(),
      listAssignmentModules: jest.fn().mockResolvedValue([]),
    } as any;
    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    (runtimeRegistry as any).runtimes.clear();
    aiGradingQueue = {
      add: jest.fn().mockResolvedValue({ id: 'ai-grading-1' }),
    };
    aiTextDetect = { detect: jest.fn() };
    service = new SubmissionService(
      prisma,
      submissionRepository,
      outboxService,
      runtimeRegistry,
      aiGradingQueue as any,
      aiTextDetect as any,
    );
  });

  it('runs the AI-text detector at submit time and stamps aiLikelihood + aiFlagged on the row', async () => {
    aiTextDetect.detect.mockResolvedValue({
      likelihood: 0.85,
      flagged: true,
      threshold: 0.7,
      signals: ['perplexity-low'],
    });
    submissionRepository.findByIdWithContext
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'DRAFT' }))
      .mockResolvedValueOnce(
        buildSubmissionRow({
          status: 'SUBMITTED',
          aiLikelihood: 0.85,
          aiFlagged: true,
        }),
      );

    const result = await service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(aiTextDetect.detect).toHaveBeenCalledWith({
      userId: STUDENT_ID,
      text: expect.stringContaining('student essay text here'),
      threshold: 0.75,
    });
    expect(result.status).toBe('SUBMITTED');

    // The service updates aiLikelihood + aiFlagged on the row inside the
    // same transaction that flips the status, guarded by status='SUBMITTED'.
    expect(txSubmissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUBMISSION_ID, status: 'SUBMITTED' },
        data: { aiLikelihood: 0.85, aiFlagged: true },
      }),
    );
  });

  it('does NOT flag the row when likelihood is below the configured threshold', async () => {
    aiTextDetect.detect.mockResolvedValue({
      likelihood: 0.3,
      flagged: false,
      threshold: 0.7,
      signals: [],
    });
    submissionRepository.findByIdWithContext
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'DRAFT' }))
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'SUBMITTED' }));

    await service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(txSubmissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { aiLikelihood: 0.3, aiFlagged: false },
      }),
    );
  });

  it('skips the row update when the detector returns nothing useful (empty body)', async () => {
    aiTextDetect.detect.mockResolvedValue({
      likelihood: 0,
      flagged: false,
      threshold: 0.7,
      signals: ['empty-text'],
    });
    submissionRepository.findByIdWithContext
      .mockResolvedValueOnce(
        buildSubmissionRow({ status: 'DRAFT', answersJson: {} }),
      )
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'SUBMITTED' }));

    await service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    // Empty body — service short-circuits before calling the detector.
    expect(aiTextDetect.detect).not.toHaveBeenCalled();
    // We still stamp the row with the zero baseline so the column has
    // a known value (otherwise downstream queries can't distinguish
    // "never ran" from "ran and was clean").
    expect(txSubmissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { aiLikelihood: 0, aiFlagged: false },
      }),
    );
  });

  it('does NOT abort submit when the detector fails — falls back to BullMQ-driven precheck', async () => {
    aiTextDetect.detect.mockRejectedValue(new Error('upstream 502'));
    submissionRepository.findByIdWithContext
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'DRAFT' }))
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'SUBMITTED' }));

    const result = await service.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe('SUBMITTED');
    // The transaction commits but no aiLikelihood update fires on the
    // row — the BullMQ AiGradingService.precheck job will compute it
    // asynchronously.
    expect(txSubmissionUpdateMany).not.toHaveBeenCalled();
    // The submit transition + outbox emission still happen.
    expect(outboxService.create).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({ topic: 'submission.submitted' }),
    );
  });

  it('omits the row update when AiTextDetectService is not wired (older tests / dev)', async () => {
    // Re-build the service without the detector to mirror the legacy
    // ctor signature.
    const legacyService = new SubmissionService(
      prisma,
      submissionRepository,
      outboxService,
      runtimeRegistry,
      aiGradingQueue as any,
    );
    submissionRepository.findByIdWithContext
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'DRAFT' }))
      .mockResolvedValueOnce(buildSubmissionRow({ status: 'SUBMITTED' }));

    const result = await legacyService.submit(
      { userId: STUDENT_ID, role: 'STUDENT' },
      SUBMISSION_ID,
      {},
    );

    expect(result.status).toBe('SUBMITTED');
    expect(txSubmissionUpdateMany).not.toHaveBeenCalled();
  });
});
