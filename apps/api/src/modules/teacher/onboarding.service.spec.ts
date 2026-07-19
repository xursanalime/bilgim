import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingQuestion } from '@prisma/client';

import { OnboardingService } from './onboarding.service';
import { SpecialtyService } from './specialty.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { SubmitAnswersDto } from './dto';

const QUESTION_ID_1 = '11111111-1111-1111-1111-111111111111';
const QUESTION_ID_2 = '22222222-2222-2222-2222-222222222222';

const englishSpecialty = {
  id: 'spec-english',
  slug: 'english',
  nameUz: 'Ingliz tili',
  nameRu: 'Английский язык',
  nameEn: 'English',
  isActive: true,
  dashboardKey: 'english',
  createdAt: new Date(),
};

function buildQuestion(overrides: Partial<OnboardingQuestion> = {}): OnboardingQuestion {
  return {
    id: QUESTION_ID_1,
    specialtyId: null,
    order: 1,
    textUz: 'Qaysi fanni o‘qitasiz?',
    textRu: 'Какой предмет вы преподаёте?',
    textEn: 'Which subject do you teach?',
    optionsJson: [
      {
        id: 'opt_english',
        text: { uz: 'Ingliz tili', ru: 'Английский', en: 'English' },
        weights: { english: 3 },
      },
      {
        id: 'opt_math',
        text: { uz: 'Matematika', ru: 'Математика', en: 'Math' },
        weights: { mathematics: 3 },
      },
    ],
    isActive: true,
    ...overrides,
  };
}

describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: any;
  let specialtyService: jest.Mocked<SpecialtyService>;
  let teacherProfileRepository: jest.Mocked<TeacherProfileRepository>;
  let mockTx: any;

  beforeEach(() => {
    mockTx = {
      onboardingAnswer: { upsert: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      onboardingQuestion: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockTx)),
    };

    specialtyService = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      getById: jest.fn(),
      listActive: jest.fn(),
    } as any;

    teacherProfileRepository = {
      findByUserId: jest.fn(),
      upsertWithSpecialty: jest.fn().mockResolvedValue({}),
    } as any;

    service = new OnboardingService(
      prisma,
      specialtyService,
      teacherProfileRepository,
    );
  });

  describe('listQuestions', () => {
    it('returns active questions ordered by order with localized text', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([
        buildQuestion({ id: QUESTION_ID_1, order: 1 }),
        buildQuestion({ id: QUESTION_ID_2, order: 2, textUz: 'Ikkinchi savol' }),
      ]);

      const result = await service.listQuestions('uz');

      expect(prisma.onboardingQuestion.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { order: 'asc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.text).toBe('Qaysi fanni o‘qitasiz?');
      expect(result[1]!.text).toBe('Ikkinchi savol');
      expect(result[0]!.options).toEqual([
        { id: 'opt_english', text: 'Ingliz tili' },
        { id: 'opt_math', text: 'Matematika' },
      ]);
      // Crucially, weights must NOT leak to clients
      expect(JSON.stringify(result[0]!.options)).not.toContain('weights');
    });

    it('falls back to Uzbek when locale is not present', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);
      const result = await service.listQuestions('en');
      expect(result[0]!.text).toBe('Which subject do you teach?');
      expect(result[0]!.options[0]!.text).toBe('English');
    });
  });

  describe('classify', () => {
    it('picks the specialty with highest weight sum and computes confidence', () => {
      const dto: SubmitAnswersDto = {
        answers: [
          { questionId: QUESTION_ID_1, selectedOptionId: 'opt_english' },
          { questionId: QUESTION_ID_2, selectedOptionId: 'opt_english_2' },
        ],
      };
      const questionsById = new Map<string, OnboardingQuestion>([
        [QUESTION_ID_1, buildQuestion({ id: QUESTION_ID_1 })],
        [
          QUESTION_ID_2,
          buildQuestion({
            id: QUESTION_ID_2,
            optionsJson: [
              {
                id: 'opt_english_2',
                text: 'English 2',
                weights: { english: 2, mathematics: 1 },
              },
            ],
          }),
        ],
      ]);

      const result = service.classify(dto, questionsById);

      // english totals: 3 + 2 = 5; mathematics totals: 1; sum=6; conf=5/6
      expect(result.specialtySlug).toBe('english');
      expect(result.confidence).toBeCloseTo(5 / 6);
      expect(result.totals).toEqual({ english: 5, mathematics: 1 });
    });

    it('breaks ties alphabetically for determinism', () => {
      const dto: SubmitAnswersDto = {
        answers: [{ questionId: QUESTION_ID_1, selectedOptionId: 'opt_tie' }],
      };
      const questionsById = new Map<string, OnboardingQuestion>([
        [
          QUESTION_ID_1,
          buildQuestion({
            optionsJson: [
              {
                id: 'opt_tie',
                text: 'Tie',
                weights: { mathematics: 1, english: 1 },
              },
            ],
          }),
        ],
      ]);

      const result = service.classify(dto, questionsById);
      expect(result.specialtySlug).toBe('english');
      expect(result.confidence).toBeCloseTo(0.5);
    });

    it('returns __unknown__ with confidence=0 when no weights are present', () => {
      const dto: SubmitAnswersDto = {
        answers: [{ questionId: QUESTION_ID_1, selectedOptionId: 'opt_no_weights' }],
      };
      const questionsById = new Map<string, OnboardingQuestion>([
        [
          QUESTION_ID_1,
          buildQuestion({
            optionsJson: [{ id: 'opt_no_weights', text: 'No weights' }],
          }),
        ],
      ]);

      const result = service.classify(dto, questionsById);
      expect(result.specialtySlug).toBe('__unknown__');
      expect(result.confidence).toBe(0);
    });
  });

  describe('submitAnswers', () => {
    const teacherId = 'teacher-1';
    const dto: SubmitAnswersDto = {
      answers: [{ questionId: QUESTION_ID_1, selectedOptionId: 'opt_english' }],
    };

    it('classifies, persists answers, upserts profile, returns dashboard URL', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);
      specialtyService.findBySlug.mockResolvedValue(englishSpecialty);

      const result = await service.submitAnswers(teacherId, 'Anvar Karimov', dto);

      expect(specialtyService.findBySlug).toHaveBeenCalledWith('english');
      expect(mockTx.onboardingAnswer.upsert).toHaveBeenCalledWith({
        where: {
          teacherId_questionId: { teacherId, questionId: QUESTION_ID_1 },
        },
        create: {
          teacherId,
          questionId: QUESTION_ID_1,
          selectedOptionId: 'opt_english',
        },
        update: { selectedOptionId: 'opt_english' },
      });
      expect(teacherProfileRepository.upsertWithSpecialty).toHaveBeenCalledWith(
        {
          userId: teacherId,
          specialtyId: 'spec-english',
          fullName: 'Anvar Karimov',
        },
        mockTx,
      );
      expect(result.dashboardUrl).toBe('/dashboard/english');
      expect(result.specialty.slug).toBe('english');
      expect(result.usedAiFallback).toBe(false);
      expect(result.confidence).toBe(1);
    });

    it('flags AI fallback when confidence < 55% but still assigns winner', async () => {
      // Two answers, very close so confidence is just barely over 50%
      prisma.onboardingQuestion.findMany.mockResolvedValue([
        buildQuestion({
          id: QUESTION_ID_1,
          optionsJson: [
            {
              id: 'opt_ambiguous',
              text: 'Ambiguous',
              weights: { english: 11, mathematics: 10 },
            },
          ],
        }),
      ]);
      specialtyService.findBySlug.mockResolvedValue(englishSpecialty);

      const result = await service.submitAnswers(teacherId, null, {
        answers: [{ questionId: QUESTION_ID_1, selectedOptionId: 'opt_ambiguous' }],
      });

      // 11/(11+10) ≈ 0.524 < 0.55 → fallback
      expect(result.usedAiFallback).toBe(true);
      expect(result.specialty.slug).toBe('english');
    });

    it('rejects unknown questionId with 404 NOT_FOUND', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([]);

      await expect(
        service.submitAnswers(teacherId, null, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(teacherProfileRepository.upsertWithSpecialty).not.toHaveBeenCalled();
    });

    it('rejects invalid selectedOptionId with 400 INVALID_OPTION', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);

      await expect(
        service.submitAnswers(teacherId, null, {
          answers: [{ questionId: QUESTION_ID_1, selectedOptionId: 'opt_bogus' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(teacherProfileRepository.upsertWithSpecialty).not.toHaveBeenCalled();
    });

    it('rejects when resolved specialty is not seeded', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);
      specialtyService.findBySlug.mockResolvedValue(null);

      await expect(
        service.submitAnswers(teacherId, null, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
