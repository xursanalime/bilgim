import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CefrLevel, OnboardingQuestion } from '@prisma/client';

import { OnboardingService } from './onboarding.service';
import { SpecialtyService } from './specialty.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { CompleteOnboardingDto, SubmitAnswersDto } from './dto';

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
      examTrack: {
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
      updateEnglishTeachingAttributes: jest.fn().mockResolvedValue({}),
      isPublicSlugTaken: jest.fn().mockResolvedValue(false),
      updatePublicProfile: jest.fn().mockResolvedValue({}),
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

    // ----------------------------------------------------------------
    // Req 2.3 — specialtyId deprecation shim (accept + ignore)
    // ----------------------------------------------------------------
    it('accepts a deprecated specialtyId in the body but ignores it (Req 2.3)', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);
      specialtyService.findBySlug.mockResolvedValue(englishSpecialty);

      // Legacy client posts a specialtyId alongside the answers. It must be
      // ignored: the resolved specialty still comes from classification of
      // the answers, NOT from the supplied value.
      const result = await service.submitAnswers(teacherId, 'Anvar Karimov', {
        answers: [
          { questionId: QUESTION_ID_1, selectedOptionId: 'opt_english' },
        ],
        specialtyId: 'spec-marketing-legacy',
      } as SubmitAnswersDto);

      // Classification drives the specialty, not the body value.
      expect(specialtyService.findBySlug).toHaveBeenCalledWith('english');
      expect(specialtyService.findBySlug).not.toHaveBeenCalledWith(
        'spec-marketing-legacy',
      );
      // The profile is written with the classified specialty, never the
      // client-supplied specialtyId.
      expect(teacherProfileRepository.upsertWithSpecialty).toHaveBeenCalledWith(
        {
          userId: teacherId,
          specialtyId: 'spec-english',
          fullName: 'Anvar Karimov',
        },
        mockTx,
      );
      expect(result.specialty.slug).toBe('english');
    });

    it('succeeds when specialtyId is omitted (Req 2.3 — never required)', async () => {
      prisma.onboardingQuestion.findMany.mockResolvedValue([buildQuestion()]);
      specialtyService.findBySlug.mockResolvedValue(englishSpecialty);

      const result = await service.submitAnswers(teacherId, 'Anvar Karimov', {
        answers: [
          { questionId: QUESTION_ID_1, selectedOptionId: 'opt_english' },
        ],
      });

      expect(result.specialty.slug).toBe('english');
      expect(teacherProfileRepository.upsertWithSpecialty).toHaveBeenCalled();
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

  // ------------------------------------------------------------------
  // completeOnboarding — refocused English-only onboarding (Req 10.2–10.4)
  // ------------------------------------------------------------------
  describe('completeOnboarding', () => {
    const teacherId = 'teacher-1';

    beforeEach(() => {
      // ensureDefaultSpecialty: no existing profile, english specialty seeded.
      teacherProfileRepository.findByUserId.mockResolvedValue(null);
      specialtyService.findBySlug.mockResolvedValue(englishSpecialty);
    });

    it('persists taughtCefrLevels + examTrackFocus and routes to /dashboard (no specialty required)', async () => {
      prisma.examTrack.findMany.mockResolvedValue([{ slug: 'ielts' }]);

      const dto: CompleteOnboardingDto = {
        taughtCefrLevels: [CefrLevel.A1, CefrLevel.B2],
        examTrackFocus: ['ielts'],
        publicSlug: 'anvar-karimov',
        headline: 'IELTS mentor',
        bio: 'Ten years of experience.',
        yearsOfExperience: 7,
      };

      const result = await service.completeOnboarding(
        teacherId,
        'Anvar Karimov',
        dto,
      );

      // English-teaching attributes persisted on the profile.
      expect(
        teacherProfileRepository.updateEnglishTeachingAttributes,
      ).toHaveBeenCalledWith(teacherId, {
        taughtCefrLevels: [CefrLevel.A1, CefrLevel.B2],
        examTrackFocus: ['ielts'],
      });

      // Public profile (the teacher's "website") is claimed + persisted.
      expect(teacherProfileRepository.isPublicSlugTaken).toHaveBeenCalledWith(
        'anvar-karimov',
        teacherId,
      );
      expect(teacherProfileRepository.updatePublicProfile).toHaveBeenCalledWith(
        teacherId,
        {
          publicSlug: 'anvar-karimov',
          headline: 'IELTS mentor',
          bio: 'Ten years of experience.',
          yearsOfExperience: 7,
          schoolName: null,
          accentColor: undefined,
        },
      );

      // Routes to the single English dashboard (Req 10.4), not specialty-specific.
      expect(result.dashboardUrl).toBe('/dashboard');
      expect(result.taughtCefrLevels).toEqual([CefrLevel.A1, CefrLevel.B2]);
      expect(result.examTrackFocus).toEqual(['ielts']);
      expect(result.publicSlug).toBe('anvar-karimov');

      // No specialty quiz/classification was consulted.
      expect(prisma.onboardingQuestion.findMany).not.toHaveBeenCalled();
    });

    it('keeps the profile valid by stamping the English specialty (Req 10.2)', async () => {
      prisma.examTrack.findMany.mockResolvedValue([]);

      await service.completeOnboarding(teacherId, 'Anvar Karimov', {
        taughtCefrLevels: [],
        examTrackFocus: [],
        publicSlug: 'anvar-karimov',
      });

      // ensureDefaultSpecialty upserts the english specialty on the profile.
      expect(teacherProfileRepository.upsertWithSpecialty).toHaveBeenCalledWith({
        userId: teacherId,
        specialtyId: 'spec-english',
        fullName: 'Anvar Karimov',
      });
    });

    it('completes with empty attributes and no headline/bio (only publicSlug required)', async () => {
      const result = await service.completeOnboarding(teacherId, null, {
        taughtCefrLevels: [],
        examTrackFocus: [],
        publicSlug: 'no-frills-teacher',
      });

      expect(prisma.examTrack.findMany).not.toHaveBeenCalled();
      expect(
        teacherProfileRepository.updateEnglishTeachingAttributes,
      ).toHaveBeenCalledWith(teacherId, {
        taughtCefrLevels: [],
        examTrackFocus: [],
      });
      expect(teacherProfileRepository.updatePublicProfile).toHaveBeenCalledWith(
        teacherId,
        {
          publicSlug: 'no-frills-teacher',
          headline: null,
          bio: null,
          yearsOfExperience: null,
          schoolName: null,
          accentColor: undefined,
        },
      );
      expect(result.dashboardUrl).toBe('/dashboard');
    });

    it('de-duplicates repeated CEFR levels and exam tracks', async () => {
      prisma.examTrack.findMany.mockResolvedValue([{ slug: 'ielts' }]);

      await service.completeOnboarding(teacherId, null, {
        taughtCefrLevels: [CefrLevel.A1, CefrLevel.A1, CefrLevel.B1],
        examTrackFocus: ['ielts', 'ielts'],
        publicSlug: 'dedupe-teacher',
      });

      expect(
        teacherProfileRepository.updateEnglishTeachingAttributes,
      ).toHaveBeenCalledWith(teacherId, {
        taughtCefrLevels: [CefrLevel.A1, CefrLevel.B1],
        examTrackFocus: ['ielts'],
      });
    });

    it('rejects an exam-track slug that does not exist / is inactive', async () => {
      // Only "ielts" exists; "toefl" is unknown.
      prisma.examTrack.findMany.mockResolvedValue([{ slug: 'ielts' }]);

      await expect(
        service.completeOnboarding(teacherId, null, {
          taughtCefrLevels: [CefrLevel.B1],
          examTrackFocus: ['ielts', 'toefl'],
          publicSlug: 'rejected-teacher',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(
        teacherProfileRepository.updateEnglishTeachingAttributes,
      ).not.toHaveBeenCalled();
      expect(teacherProfileRepository.updatePublicProfile).not.toHaveBeenCalled();
    });

    it('rejects with 409 when publicSlug is already claimed by another teacher', async () => {
      teacherProfileRepository.isPublicSlugTaken.mockResolvedValue(true);

      await expect(
        service.completeOnboarding(teacherId, null, {
          taughtCefrLevels: [CefrLevel.B1],
          examTrackFocus: [],
          publicSlug: 'already-taken',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(
        teacherProfileRepository.updateEnglishTeachingAttributes,
      ).not.toHaveBeenCalled();
      expect(teacherProfileRepository.updatePublicProfile).not.toHaveBeenCalled();
    });
  });
});
