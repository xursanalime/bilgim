import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HomeworkModuleType, SubmissionStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import {
  SpeakingScoringContext,
  SpeakingSubmissionRepository,
} from './repositories/speaking-submission.repository';
import {
  SpeakingScoringActor,
  SpeakingScoringService,
} from './speaking-scoring.service';
import {
  SPEAKING_AI_DRAFT_AUTHOR_TYPE,
  SPEAKING_GRADED_TOPIC,
  SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
  SPEAKING_SCORING_FAILED_TOPIC,
  SPEAKING_SCORING_JOB_NAME,
  SPEAKING_TEACHER_AUTHOR_TYPE,
  type SpeakingScoreResult,
  type SpeakingScoringPort,
} from './speaking-scoring.types';
import { OutboxService } from '../../infra/outbox/outbox.service';

/**
 * Unit tests for SpeakingScoringService (Task 4.2, Req 7.3, 7.4, 7.6).
 *
 * Cover:
 *   - enqueue-on-SUBMITTED (Req 7.3): a SPEAKING/PRONUNCIATION submission
 *     in SUBMITTED with an AUDIO answer is enqueued; non-applicable
 *     submissions are not.
 *   - score (Req 7.4): produces a numeric score + pronunciation/fluency
 *     AI_DRAFT Feedback and transitions SUBMITTED → IN_REVIEW; idempotent.
 *   - instructor override (Req 7.6): owning teacher overrides the AI
 *     score/feedback before GRADED; authorization + window + range guards.
 */
describe('SpeakingScoringService', () => {
  let service: SpeakingScoringService;
  let repo: jest.Mocked<
    Pick<
      SpeakingSubmissionRepository,
      | 'findScoringContext'
      | 'findAiDraftFeedback'
      | 'createFeedback'
      | 'transitionToInReview'
      | 'transitionToGraded'
      | 'overrideScore'
      | 'runInTransaction'
    >
  >;
  let port: jest.Mocked<SpeakingScoringPort>;
  let queue: jest.Mocked<Pick<Queue, 'add'>>;
  let outbox: jest.Mocked<Pick<OutboxService, 'create'>>;

  const SUBMISSION_ID = '66666666-6666-6666-6666-666666666666';
  const ASSIGNMENT_ID = '22222222-2222-2222-2222-222222222222';
  const MODULE_ID = '33333333-3333-3333-3333-333333333333';
  const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
  const TEACHER_ID = '88888888-8888-8888-8888-888888888888';
  const ASSET_ID = '77777777-7777-7777-7777-777777777777';
  const OTHER_TEACHER_ID = '99999999-9999-9999-9999-999999999999';

  const teacher: SpeakingScoringActor = { userId: TEACHER_ID, role: 'TEACHER' };

  function buildContext(
    overrides: Partial<SpeakingScoringContext> = {},
  ): SpeakingScoringContext {
    return {
      submissionId: SUBMISSION_ID,
      status: (overrides.status ?? 'SUBMITTED') as SubmissionStatus,
      studentId: STUDENT_ID,
      assignmentId: ASSIGNMENT_ID,
      answersJson:
        overrides.answersJson !== undefined
          ? overrides.answersJson
          : {
              [MODULE_ID]: {
                kind: 'AUDIO',
                assetId: ASSET_ID,
                contentType: 'audio/webm',
                fileName: 'answer.webm',
                status: 'UPLOADING',
                registeredAt: new Date().toISOString(),
              },
            },
      totalPoints: overrides.totalPoints ?? 100,
      teacherId: overrides.teacherId ?? TEACHER_ID,
      modules: overrides.modules ?? [
        { id: MODULE_ID, type: 'SPEAKING' as HomeworkModuleType },
      ],
    };
  }

  function buildVerdict(): SpeakingScoreResult {
    return {
      overall: 0.8,
      pronunciation: { score: 0.85, comment: 'Clear articulation.' },
      fluency: { score: 0.75, comment: 'Mostly steady pacing.' },
      summary: 'Solid spoken answer.',
      provider: 'mock-speaking-v1',
      transcript: null,
    };
  }

  beforeEach(() => {
    repo = {
      findScoringContext: jest.fn().mockResolvedValue(buildContext()),
      findAiDraftFeedback: jest.fn().mockResolvedValue(null),
      createFeedback: jest.fn().mockResolvedValue({ id: 'fb-1' }),
      transitionToInReview: jest.fn().mockResolvedValue(1),
      transitionToGraded: jest.fn().mockResolvedValue(1),
      overrideScore: jest.fn().mockResolvedValue(1),
      runInTransaction: jest
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({} as unknown),
        ),
    };
    port = { scoreAudio: jest.fn().mockResolvedValue(buildVerdict()) };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    outbox = { create: jest.fn().mockResolvedValue('outbox-id') };

    service = new SpeakingScoringService(
      repo as unknown as SpeakingSubmissionRepository,
      port as unknown as SpeakingScoringPort,
      queue as unknown as Queue,
      outbox as unknown as OutboxService,
    );
  });

  // ----------------------------------------------------------------
  // 1. enqueue-on-SUBMITTED (Req 7.3)
  // ----------------------------------------------------------------

  describe('enqueueScoring', () => {
    it('enqueues a scoring job for a SUBMITTED speaking submission with an audio answer', async () => {
      const enqueued = await service.enqueueScoring(SUBMISSION_ID);

      expect(enqueued).toBe(true);
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [jobName, payload, opts] = queue.add.mock.calls[0]!;
      expect(jobName).toBe(SPEAKING_SCORING_JOB_NAME);
      expect(payload).toMatchObject({
        submissionId: SUBMISSION_ID,
        moduleId: MODULE_ID,
        assetId: ASSET_ID,
      });
      // Deduped by a stable jobId so a retried submit never piles up runs.
      expect(opts).toMatchObject({ jobId: `speaking-score:${SUBMISSION_ID}` });
    });

    it('enqueues for PRONUNCIATION modules too', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({
          modules: [{ id: MODULE_ID, type: 'PRONUNCIATION' as HomeworkModuleType }],
        }),
      );
      expect(await service.enqueueScoring(SUBMISSION_ID)).toBe(true);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('does not enqueue when the submission is not SUBMITTED', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'DRAFT' as SubmissionStatus }),
      );
      expect(await service.enqueueScoring(SUBMISSION_ID)).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue when there is no speaking audio answer', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ answersJson: { [MODULE_ID]: { text: 'typed answer' } } }),
      );
      expect(await service.enqueueScoring(SUBMISSION_ID)).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue when the audio answer is on a non-speaking module', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({
          modules: [{ id: MODULE_ID, type: 'WRITING' as HomeworkModuleType }],
        }),
      );
      expect(await service.enqueueScoring(SUBMISSION_ID)).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('does not enqueue when the submission does not exist', async () => {
      repo.findScoringContext.mockResolvedValueOnce(null);
      expect(await service.enqueueScoring(SUBMISSION_ID)).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // 2. score (Req 7.4)
  // ----------------------------------------------------------------

  describe('score', () => {
    it('produces a numeric score + pronunciation/fluency AI_DRAFT and moves to IN_REVIEW', async () => {
      const outcome = await service.score(SUBMISSION_ID);

      expect(port.scoreAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: SUBMISSION_ID,
          moduleId: MODULE_ID,
          assetId: ASSET_ID,
          moduleType: 'SPEAKING',
        }),
      );

      // AI_DRAFT Feedback row written with the structured payload.
      expect(repo.createFeedback).toHaveBeenCalledTimes(1);
      const [feedbackInput] = repo.createFeedback.mock.calls[0]!;
      expect(feedbackInput).toMatchObject({
        submissionId: SUBMISSION_ID,
        authorType: SPEAKING_AI_DRAFT_AUTHOR_TYPE,
        authorId: null,
        isFinal: false,
      });
      expect(feedbackInput.payload).toMatchObject({
        kind: 'SPEAKING_SCORE',
        source: 'AI_DRAFT',
        score: 80, // 0.8 overall × 100 totalPoints
        scoreRaw: 0.8,
        pronunciation: { score: 0.85, comment: 'Clear articulation.' },
        fluency: { score: 0.75, comment: 'Mostly steady pacing.' },
        provider: 'mock-speaking-v1',
      });

      // SUBMITTED → IN_REVIEW with the draft score stamped.
      expect(repo.transitionToInReview).toHaveBeenCalledWith(
        SUBMISSION_ID,
        80,
        expect.anything(),
      );

      expect(outcome).toMatchObject({
        submissionId: SUBMISSION_ID,
        feedbackCreated: true,
        skipped: false,
        score: 80,
      });
    });

    it('is idempotent — skips when an AI_DRAFT already exists', async () => {
      repo.findAiDraftFeedback.mockResolvedValueOnce({ id: 'existing-draft' });

      const outcome = await service.score(SUBMISSION_ID);

      expect(port.scoreAudio).not.toHaveBeenCalled();
      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(repo.transitionToInReview).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ feedbackCreated: false, skipped: true });
    });

    it('skips when the submission is no longer SUBMITTED', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'IN_REVIEW' as SubmissionStatus }),
      );

      const outcome = await service.score(SUBMISSION_ID);

      expect(port.scoreAudio).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ feedbackCreated: false, skipped: true });
    });

    it('throws NotFound when the submission does not exist', async () => {
      repo.findScoringContext.mockResolvedValueOnce(null);
      await expect(service.score(SUBMISSION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when there is no audio answer to score (manual-review path)', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ answersJson: {} }),
      );
      await expect(service.score(SUBMISSION_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.createFeedback).not.toHaveBeenCalled();
    });

    it('clamps an out-of-range provider score before scaling', async () => {
      port.scoreAudio.mockResolvedValueOnce({
        ...buildVerdict(),
        overall: 1.5,
      });
      const outcome = await service.score(SUBMISSION_ID);
      // 1.5 clamps to 1.0 → 1.0 × 100 = 100.
      expect(outcome.score).toBe(100);
    });
  });

  // ----------------------------------------------------------------
  // 3. instructor override (Req 7.6)
  // ----------------------------------------------------------------

  describe('overrideScore', () => {
    const overrideDto = {
      score: 90,
      pronunciation: { score: 0.9, comment: 'Better than the draft.' },
      comment: 'Adjusted after listening.',
    };

    it('lets the owning instructor override score + feedback before GRADED', async () => {
      const outcome = await service.overrideScore(
        teacher,
        SUBMISSION_ID,
        overrideDto,
      );

      expect(repo.overrideScore).toHaveBeenCalledWith(
        SUBMISSION_ID,
        90,
        expect.anything(),
      );
      expect(repo.createFeedback).toHaveBeenCalledTimes(1);
      const [feedbackInput] = repo.createFeedback.mock.calls[0]!;
      expect(feedbackInput).toMatchObject({
        submissionId: SUBMISSION_ID,
        authorType: SPEAKING_TEACHER_AUTHOR_TYPE,
        authorId: TEACHER_ID,
        isFinal: false,
      });
      expect(feedbackInput.payload).toMatchObject({
        kind: 'SPEAKING_SCORE_OVERRIDE',
        source: 'TEACHER',
        score: 90,
      });
      expect(outcome).toMatchObject({ score: 90, feedbackCreated: true });
    });

    it('allows override while still SUBMITTED (before AI draft lands)', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'SUBMITTED' as SubmissionStatus }),
      );
      const outcome = await service.overrideScore(teacher, SUBMISSION_ID, {
        score: 50,
      });
      expect(outcome.score).toBe(50);
      expect(repo.overrideScore).toHaveBeenCalled();
    });

    it('allows an ADMIN to override regardless of ownership', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ teacherId: OTHER_TEACHER_ID }),
      );
      await expect(
        service.overrideScore(
          { userId: 'admin-1', role: 'ADMIN' },
          SUBMISSION_ID,
          overrideDto,
        ),
      ).resolves.toMatchObject({ score: 90 });
    });

    it('rejects a non-owning teacher', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ teacherId: OTHER_TEACHER_ID }),
      );
      await expect(
        service.overrideScore(teacher, SUBMISSION_ID, overrideDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.overrideScore).not.toHaveBeenCalled();
    });

    it('rejects a student', async () => {
      await expect(
        service.overrideScore(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          overrideDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.overrideScore).not.toHaveBeenCalled();
    });

    it('rejects an override once the submission is GRADED (window closed)', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'GRADED' as SubmissionStatus }),
      );
      await expect(
        service.overrideScore(teacher, SUBMISSION_ID, overrideDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.overrideScore).not.toHaveBeenCalled();
    });

    it('rejects a score outside [0, totalPoints]', async () => {
      await expect(
        service.overrideScore(teacher, SUBMISSION_ID, { score: 150 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.overrideScore).not.toHaveBeenCalled();
    });

    it('throws NotFound when the submission does not exist', async () => {
      repo.findScoringContext.mockResolvedValueOnce(null);
      await expect(
        service.overrideScore(teacher, SUBMISSION_ID, overrideDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ----------------------------------------------------------------
  // 4. terminal scoring failure (Task 4.3, Req 7.5)
  // ----------------------------------------------------------------

  describe('markScoringFailed', () => {
    it('marks the submission failed and notifies the instructor exactly once', async () => {
      const outcome = await service.markScoringFailed(
        SUBMISSION_ID,
        'provider timeout',
      );

      // Durable failed marker (no FAILED enum → AI_SCORING_FAILED Feedback).
      expect(repo.createFeedback).toHaveBeenCalledTimes(1);
      const [feedbackInput] = repo.createFeedback.mock.calls[0]!;
      expect(feedbackInput).toMatchObject({
        submissionId: SUBMISSION_ID,
        authorType: SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
        authorId: null,
        isFinal: false,
      });
      expect(feedbackInput.payload).toMatchObject({
        kind: 'SPEAKING_SCORE_FAILED',
        manualReviewRequired: true,
        reason: 'provider timeout',
      });

      // Instructor notification emitted through the outbox, once.
      expect(outbox.create).toHaveBeenCalledTimes(1);
      const [, outboxInput] = outbox.create.mock.calls[0]!;
      expect(outboxInput).toMatchObject({
        topic: SPEAKING_SCORING_FAILED_TOPIC,
        idempotencyKey: `${SPEAKING_SCORING_FAILED_TOPIC}:${SUBMISSION_ID}`,
        payload: expect.objectContaining({
          submissionId: SUBMISSION_ID,
          teacherId: TEACHER_ID,
          studentId: STUDENT_ID,
        }),
      });

      expect(outcome).toMatchObject({ feedbackCreated: true, skipped: false });
    });

    it('is idempotent — a re-delivered terminal failure does not notify again', async () => {
      // A failure marker already exists.
      repo.findAiDraftFeedback.mockImplementation(
        async (_id: string, authorType: string) =>
          authorType === SPEAKING_SCORING_FAILED_AUTHOR_TYPE
            ? { id: 'existing-failure' }
            : null,
      );

      const outcome = await service.markScoringFailed(SUBMISSION_ID, 'boom');

      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ feedbackCreated: false, skipped: true });
    });

    it('does not mark failed when scoring already produced an AI draft', async () => {
      repo.findAiDraftFeedback.mockImplementation(
        async (_id: string, authorType: string) =>
          authorType === SPEAKING_AI_DRAFT_AUTHOR_TYPE
            ? { id: 'existing-draft' }
            : null,
      );

      const outcome = await service.markScoringFailed(SUBMISSION_ID, 'boom');

      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ feedbackCreated: false, skipped: true });
    });

    it('does not mark failed when the submission was already GRADED', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'GRADED' as SubmissionStatus }),
      );

      const outcome = await service.markScoringFailed(SUBMISSION_ID, 'boom');

      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ skipped: true });
    });

    it('no-ops (does not throw) when the submission does not exist', async () => {
      repo.findScoringContext.mockResolvedValueOnce(null);

      const outcome = await service.markScoringFailed(SUBMISSION_ID, 'boom');

      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ skipped: true });
    });
  });

  // ----------------------------------------------------------------
  // 5. finalize grade → GRADED + homework-graded notification (Req 15.3)
  // ----------------------------------------------------------------

  describe('finalizeGrade', () => {
    it('moves the submission to GRADED and notifies the student (homework.graded)', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'IN_REVIEW' as SubmissionStatus }),
      );

      const outcome = await service.finalizeGrade(teacher, SUBMISSION_ID, {
        score: 85,
        comment: 'Great fluency.',
      });

      expect(repo.transitionToGraded).toHaveBeenCalledWith(
        SUBMISSION_ID,
        85,
        expect.anything(),
      );

      // Final teacher feedback persisted.
      expect(repo.createFeedback).toHaveBeenCalledTimes(1);
      const [feedbackInput] = repo.createFeedback.mock.calls[0]!;
      expect(feedbackInput).toMatchObject({
        authorType: SPEAKING_TEACHER_AUTHOR_TYPE,
        authorId: TEACHER_ID,
        isFinal: true,
      });

      // Reuses the homework-graded topic + idempotency key (Req 15.3).
      expect(outbox.create).toHaveBeenCalledTimes(1);
      const [, outboxInput] = outbox.create.mock.calls[0]!;
      expect(outboxInput).toMatchObject({
        topic: SPEAKING_GRADED_TOPIC,
        idempotencyKey: `${SPEAKING_GRADED_TOPIC}:${SUBMISSION_ID}`,
        payload: expect.objectContaining({
          submissionId: SUBMISSION_ID,
          studentId: STUDENT_ID,
          score: 85,
          totalPoints: 100,
        }),
      });

      expect(outcome).toMatchObject({ score: 85, skipped: false });
    });

    it('grades without a comment (no feedback row) but still notifies', async () => {
      const outcome = await service.finalizeGrade(teacher, SUBMISSION_ID, {
        score: 70,
      });
      expect(repo.createFeedback).not.toHaveBeenCalled();
      expect(outbox.create).toHaveBeenCalledTimes(1);
      expect(outcome.score).toBe(70);
    });

    it('allows an ADMIN to grade regardless of ownership', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ teacherId: OTHER_TEACHER_ID }),
      );
      await expect(
        service.finalizeGrade(
          { userId: 'admin-1', role: 'ADMIN' },
          SUBMISSION_ID,
          { score: 60 },
        ),
      ).resolves.toMatchObject({ score: 60 });
    });

    it('rejects a non-owning teacher', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ teacherId: OTHER_TEACHER_ID }),
      );
      await expect(
        service.finalizeGrade(teacher, SUBMISSION_ID, { score: 60 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.transitionToGraded).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
    });

    it('rejects a student', async () => {
      await expect(
        service.finalizeGrade(
          { userId: STUDENT_ID, role: 'STUDENT' },
          SUBMISSION_ID,
          { score: 60 },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.transitionToGraded).not.toHaveBeenCalled();
    });

    it('rejects grading an already-GRADED submission', async () => {
      repo.findScoringContext.mockResolvedValueOnce(
        buildContext({ status: 'GRADED' as SubmissionStatus }),
      );
      await expect(
        service.finalizeGrade(teacher, SUBMISSION_ID, { score: 60 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.transitionToGraded).not.toHaveBeenCalled();
      expect(outbox.create).not.toHaveBeenCalled();
    });

    it('rejects a score outside [0, totalPoints]', async () => {
      await expect(
        service.finalizeGrade(teacher, SUBMISSION_ID, { score: 150 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.transitionToGraded).not.toHaveBeenCalled();
    });

    it('throws Conflict when a concurrent caller already graded (0 rows moved)', async () => {
      repo.transitionToGraded.mockResolvedValueOnce(0);
      await expect(
        service.finalizeGrade(teacher, SUBMISSION_ID, { score: 60 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound when the submission does not exist', async () => {
      repo.findScoringContext.mockResolvedValueOnce(null);
      await expect(
        service.finalizeGrade(teacher, SUBMISSION_ID, { score: 60 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
