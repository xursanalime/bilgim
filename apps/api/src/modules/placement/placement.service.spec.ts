import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { LevelingService } from '../leveling/leveling.service';
import {
  PLACEMENT_RESULT_TOPIC,
  PlacementService,
} from './placement.service';
import { PlacementRepository } from './repositories/placement.repository';
import { PLACEMENT_QUESTION_BANK, PLACEMENT_SKILLS } from './question-bank';

const LEARNER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_LEARNER_ID = '00000000-0000-0000-0000-000000000099';
const ASSESSMENT_ID = '11111111-1111-1111-1111-111111111111';

/** A known question ref from the static bank. */
const SAMPLE = PLACEMENT_QUESTION_BANK[0]!;

/**
 * Build a saved-answer row for every question in the bank. When `correct` is
 * true the answer equals the question's `correctOption` (a perfect score →
 * C2); otherwise it is a deliberately wrong index (-1 → A1). Used to drive the
 * submit/scoring tests deterministically.
 */
function answersForBank(correct: boolean): any[] {
  return PLACEMENT_QUESTION_BANK.map((q) => ({
    id: `ans-${q.questionRef}`,
    assessmentId: ASSESSMENT_ID,
    skill: q.skill,
    questionRef: q.questionRef,
    answer: correct ? q.correctOption : -1,
    createdAt: new Date(),
  }));
}

/**
 * PlacementService unit tests — Tasks 3.1 (Req 5.1, 5.4) and 3.2
 * (Req 5.2, 5.3, 5.5, 15.1). Covers start (create + resume), resumable answer
 * persistence, and submit → score → proficiency → notification + idempotency.
 */
describe('PlacementService', () => {
  let service: PlacementService;
  let repository: jest.Mocked<PlacementRepository>;
  let levelingService: jest.Mocked<Pick<LevelingService, 'recordProficiencyChange'>>;
  let outboxService: jest.Mocked<Pick<OutboxService, 'create'>>;

  const baseAssessment = {
    id: ASSESSMENT_ID,
    learnerId: LEARNER_ID,
    status: 'IN_PROGRESS' as const,
    perSkillScores: null,
    computedLevel: null,
    startedAt: new Date('2024-01-01T00:00:00Z'),
    submittedAt: null,
    answers: [] as any[],
  };

  beforeEach(() => {
    repository = {
      ensureStudentProfile: jest.fn().mockResolvedValue(undefined),
      createAssessment: jest.fn(),
      findInProgressForLearner: jest.fn(),
      findById: jest.fn(),
      upsertAnswer: jest.fn(),
      completeAssessment: jest.fn().mockResolvedValue(true),
      // Run the supplied transactional fn against a dummy tx client.
      runInTransaction: jest.fn().mockImplementation((fn: any) => fn({})),
    } as any;

    levelingService = {
      recordProficiencyChange: jest.fn().mockResolvedValue({
        proficiency: {
          learnerId: LEARNER_ID,
          currentCefrLevel: 'C2',
          status: 'ASSESSED',
        },
        history: {},
      }),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
    } as any;

    service = new PlacementService(
      repository,
      levelingService as unknown as LevelingService,
      outboxService as unknown as OutboxService,
    );
  });

  // ------------------------------------------------------------------
  // start (Req 5.1)
  // ------------------------------------------------------------------

  describe('start', () => {
    it('creates a new IN_PROGRESS assessment when none is in progress', async () => {
      repository.findInProgressForLearner.mockResolvedValue(null);
      repository.createAssessment.mockResolvedValue({ ...baseAssessment });

      const view = await service.start(LEARNER_ID);

      expect(repository.ensureStudentProfile).toHaveBeenCalledWith(LEARNER_ID);
      expect(repository.createAssessment).toHaveBeenCalledWith(LEARNER_ID);
      expect(view.id).toBe(ASSESSMENT_ID);
      expect(view.status).toBe('IN_PROGRESS');
      expect(view.savedAnswers).toEqual([]);
    });

    it('presents questions covering READING, GRAMMAR and VOCABULARY (Req 5.1)', async () => {
      repository.findInProgressForLearner.mockResolvedValue(null);
      repository.createAssessment.mockResolvedValue({ ...baseAssessment });

      const view = await service.start(LEARNER_ID);

      const skills = new Set(view.questions.map((q) => q.skill));
      for (const required of PLACEMENT_SKILLS) {
        expect(skills.has(required)).toBe(true);
      }
      expect(view.questions.length).toBe(PLACEMENT_QUESTION_BANK.length);
    });

    it('never leaks the answer key to the learner', async () => {
      repository.findInProgressForLearner.mockResolvedValue(null);
      repository.createAssessment.mockResolvedValue({ ...baseAssessment });

      const view = await service.start(LEARNER_ID);

      for (const q of view.questions) {
        expect(q).not.toHaveProperty('correctOption');
        expect(q).not.toHaveProperty('targetLevel');
      }
    });

    it('resumes an existing IN_PROGRESS assessment instead of creating a duplicate (Req 5.4)', async () => {
      repository.findInProgressForLearner.mockResolvedValue({
        ...baseAssessment,
        answers: [
          {
            id: 'ans-1',
            assessmentId: ASSESSMENT_ID,
            skill: SAMPLE.skill,
            questionRef: SAMPLE.questionRef,
            answer: 0,
            createdAt: new Date(),
          },
        ],
      });

      const view = await service.start(LEARNER_ID);

      expect(repository.createAssessment).not.toHaveBeenCalled();
      expect(repository.ensureStudentProfile).not.toHaveBeenCalled();
      expect(view.id).toBe(ASSESSMENT_ID);
      expect(view.savedAnswers).toEqual([
        { questionRef: SAMPLE.questionRef, skill: SAMPLE.skill, answer: 0 },
      ]);
    });
  });

  // ------------------------------------------------------------------
  // saveAnswer (Req 5.4 — resumable persistence)
  // ------------------------------------------------------------------

  describe('saveAnswer', () => {
    it('persists an answer with the skill derived from the question bank', async () => {
      repository.findById
        .mockResolvedValueOnce({ ...baseAssessment }) // ownership load
        .mockResolvedValueOnce({
          ...baseAssessment,
          answers: [
            {
              id: 'ans-1',
              assessmentId: ASSESSMENT_ID,
              skill: SAMPLE.skill,
              questionRef: SAMPLE.questionRef,
              answer: 2,
              createdAt: new Date(),
            },
          ],
        });
      repository.upsertAnswer.mockResolvedValue({} as any);

      const view = await service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
        questionRef: SAMPLE.questionRef,
        answer: 2,
      });

      expect(repository.upsertAnswer).toHaveBeenCalledWith({
        assessmentId: ASSESSMENT_ID,
        skill: SAMPLE.skill,
        questionRef: SAMPLE.questionRef,
        answer: 2,
      });
      expect(view.savedAnswers).toEqual([
        { questionRef: SAMPLE.questionRef, skill: SAMPLE.skill, answer: 2 },
      ]);
    });

    it('is idempotent on questionRef — re-answering upserts the same row', async () => {
      repository.findById.mockResolvedValue({ ...baseAssessment });
      repository.upsertAnswer.mockResolvedValue({} as any);

      await service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
        questionRef: SAMPLE.questionRef,
        answer: 1,
      });
      await service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
        questionRef: SAMPLE.questionRef,
        answer: 3,
      });

      expect(repository.upsertAnswer).toHaveBeenCalledTimes(2);
      expect(repository.upsertAnswer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          questionRef: SAMPLE.questionRef,
          answer: 3,
        }),
      );
    });

    it('rejects an unknown questionRef with 404 PLACEMENT_QUESTION_NOT_FOUND', async () => {
      repository.findById.mockResolvedValue({ ...baseAssessment });

      await expect(
        service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
          questionRef: 'DOES_NOT_EXIST',
          answer: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.upsertAnswer).not.toHaveBeenCalled();
    });

    it('rejects a non-IN_PROGRESS assessment with 409', async () => {
      repository.findById.mockResolvedValue({
        ...baseAssessment,
        status: 'SUBMITTED',
      });

      await expect(
        service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
          questionRef: SAMPLE.questionRef,
          answer: 0,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.upsertAnswer).not.toHaveBeenCalled();
    });

    it('enforces learner ownership with 403 NOT_OWNING_LEARNER', async () => {
      repository.findById.mockResolvedValue({
        ...baseAssessment,
        learnerId: OTHER_LEARNER_ID,
      });

      await expect(
        service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
          questionRef: SAMPLE.questionRef,
          answer: 0,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.upsertAnswer).not.toHaveBeenCalled();
    });

    it('returns 404 when the assessment does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.saveAnswer(LEARNER_ID, ASSESSMENT_ID, {
          questionRef: SAMPLE.questionRef,
          answer: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  // getById (resume)
  // ------------------------------------------------------------------

  describe('getById', () => {
    it('returns the assessment with saved answers for the owner', async () => {
      repository.findById.mockResolvedValue({
        ...baseAssessment,
        answers: [
          {
            id: 'ans-1',
            assessmentId: ASSESSMENT_ID,
            skill: SAMPLE.skill,
            questionRef: SAMPLE.questionRef,
            answer: 'b',
            createdAt: new Date(),
          },
        ],
      });

      const view = await service.getById(LEARNER_ID, ASSESSMENT_ID);

      expect(view.id).toBe(ASSESSMENT_ID);
      expect(view.savedAnswers).toHaveLength(1);
      expect(view.questions.length).toBe(PLACEMENT_QUESTION_BANK.length);
    });

    it('rejects access by a non-owner with 403', async () => {
      repository.findById.mockResolvedValue({
        ...baseAssessment,
        learnerId: OTHER_LEARNER_ID,
      });

      await expect(
        service.getById(LEARNER_ID, ASSESSMENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 for a missing assessment', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getById(LEARNER_ID, ASSESSMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  // submit (Task 3.2 — Req 5.2, 5.3, 5.5, 15.1)
  // ------------------------------------------------------------------

  describe('submit', () => {
    /** An IN_PROGRESS assessment fully answered with all-correct answers. */
    const completeCorrect = {
      ...baseAssessment,
      answers: answersForBank(true),
    };
    /** The SCORED row the repository returns after a successful transition. */
    const scoredAssessment = {
      ...baseAssessment,
      status: 'SCORED' as const,
      computedLevel: 'C2' as const,
      submittedAt: new Date('2024-01-02T00:00:00Z'),
      perSkillScores: [],
      answers: answersForBank(true),
    };

    it('scores a complete assessment → CEFR level and persists per-skill + level (Req 5.2, 5.5)', async () => {
      repository.findById
        .mockResolvedValueOnce(completeCorrect) // ownership load
        .mockResolvedValueOnce(scoredAssessment); // reload after scoring

      const result = await service.submit(LEARNER_ID, ASSESSMENT_ID);

      // All answers correct → maximum weighted ratio → C2.
      expect(repository.completeAssessment).toHaveBeenCalledTimes(1);
      const arg = repository.completeAssessment.mock.calls[0]![0];
      expect(arg.assessmentId).toBe(ASSESSMENT_ID);
      expect(arg.computedLevel).toBe('C2');
      // per-skill breakdown covers every required skill.
      const skills = new Set(
        (arg.perSkillScores as any[]).map((s) => s.skill),
      );
      for (const required of PLACEMENT_SKILLS) {
        expect(skills.has(required)).toBe(true);
      }
      expect(result.computedLevel).toBe('C2');
      expect(result.status).toBe('SCORED');
    });

    it('maps an all-incorrect assessment to A1 (Req 5.2)', async () => {
      const wrong = { ...baseAssessment, answers: answersForBank(false) };
      repository.findById
        .mockResolvedValueOnce(wrong)
        .mockResolvedValueOnce({
          ...wrong,
          status: 'SCORED',
          computedLevel: 'A1',
        });

      const result = await service.submit(LEARNER_ID, ASSESSMENT_ID);

      expect(repository.completeAssessment.mock.calls[0]![0].computedLevel).toBe(
        'A1',
      );
      expect(result.computedLevel).toBe('A1');
    });

    it('sets learner proficiency via LevelingService.recordProficiencyChange (Req 5.3)', async () => {
      repository.findById
        .mockResolvedValueOnce(completeCorrect)
        .mockResolvedValueOnce(scoredAssessment);

      await service.submit(LEARNER_ID, ASSESSMENT_ID);

      expect(levelingService.recordProficiencyChange).toHaveBeenCalledTimes(1);
      expect(levelingService.recordProficiencyChange).toHaveBeenCalledWith(
        LEARNER_ID,
        'C2',
        'placement',
        null,
      );
    });

    it('emits a placement-result notification via the outbox (Req 15.1)', async () => {
      repository.findById
        .mockResolvedValueOnce(completeCorrect)
        .mockResolvedValueOnce(scoredAssessment);

      await service.submit(LEARNER_ID, ASSESSMENT_ID);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
      expect(outboxService.create).toHaveBeenCalledTimes(1);
      const [, payloadArg] = outboxService.create.mock.calls[0]!;
      expect(payloadArg.topic).toBe(PLACEMENT_RESULT_TOPIC);
      expect(payloadArg.idempotencyKey).toBe(
        `${PLACEMENT_RESULT_TOPIC}:${ASSESSMENT_ID}`,
      );
      expect(payloadArg.payload).toMatchObject({
        assessmentId: ASSESSMENT_ID,
        learnerId: LEARNER_ID,
        computedLevel: 'C2',
      });
    });

    it('is idempotent: re-submitting a SCORED assessment does not re-write proficiency or re-notify (Req 5.2)', async () => {
      repository.findById.mockResolvedValue(scoredAssessment);

      const result = await service.submit(LEARNER_ID, ASSESSMENT_ID);

      expect(repository.completeAssessment).not.toHaveBeenCalled();
      expect(levelingService.recordProficiencyChange).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result.computedLevel).toBe('C2');
      expect(result.status).toBe('SCORED');
    });

    it('treats a SUBMITTED assessment as a completed replay (no writes)', async () => {
      repository.findById.mockResolvedValue({
        ...scoredAssessment,
        status: 'SUBMITTED',
      });

      await service.submit(LEARNER_ID, ASSESSMENT_ID);

      expect(repository.completeAssessment).not.toHaveBeenCalled();
      expect(levelingService.recordProficiencyChange).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('treats a lost optimistic-transition race as an idempotent replay', async () => {
      // completeAssessment returns false → another submit won the race.
      repository.completeAssessment.mockResolvedValue(false);
      repository.findById
        .mockResolvedValueOnce(completeCorrect) // ownership load
        .mockResolvedValueOnce(scoredAssessment); // reload stored result

      const result = await service.submit(LEARNER_ID, ASSESSMENT_ID);

      // The losing submit must NOT re-write proficiency or re-notify.
      expect(levelingService.recordProficiencyChange).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result.status).toBe('SCORED');
    });

    it('rejects an incomplete assessment with 409 PLACEMENT_INCOMPLETE (Req 5.2)', async () => {
      // Only the first question answered → missing the rest.
      const partial = {
        ...baseAssessment,
        answers: [answersForBank(true)[0]],
      };
      repository.findById.mockResolvedValue(partial);

      await expect(
        service.submit(LEARNER_ID, ASSESSMENT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.completeAssessment).not.toHaveBeenCalled();
      expect(levelingService.recordProficiencyChange).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('enforces learner ownership with 403 NOT_OWNING_LEARNER', async () => {
      repository.findById.mockResolvedValue({
        ...completeCorrect,
        learnerId: OTHER_LEARNER_ID,
      });

      await expect(
        service.submit(LEARNER_ID, ASSESSMENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.completeAssessment).not.toHaveBeenCalled();
    });

    it('returns 404 when the assessment does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.submit(LEARNER_ID, ASSESSMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
