import fc from 'fast-check';
import { CefrLevel, OnboardingQuestion } from '@prisma/client';

import { OnboardingService } from './onboarding.service';
import { SpecialtyService } from './specialty.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { CompleteOnboardingSchema, SubmitAnswersSchema } from './dto';
import type { CompleteOnboardingDto, SubmitAnswersDto } from './dto';

/**
 * Property 6 (design.md): "Specialty deprecation compatibility — endpoints that
 * previously required `specialtyId` continue to succeed while ignoring it
 * during the deprecation window." (Validates Req 2.3.)
 *
 * Req 2.3: "WHERE an existing API endpoint accepts a `specialtyId` parameter,
 * THE Platform SHALL continue to accept the request while ignoring the
 * `specialtyId` value during a defined deprecation period."
 *
 * Strategy: for ANY arbitrary legacy `specialtyId` (present / absent / null /
 * arbitrary garbage string), assert that the behaviour of the onboarding shim
 * is byte-for-byte identical to omitting the field entirely:
 *   - the request is accepted without error (never required),
 *   - the resolved/written Specialty comes from the server (the seeded English
 *     specialty), NEVER from the client-supplied value,
 *   - no specialty lookup or write is ever driven by the supplied value.
 *
 * This is asserted both at the DTO boundary (the schemas accept it) and at the
 * service layer (`submitAnswers`, `completeOnboarding`) which are the two
 * onboarding endpoints that historically carried a `specialtyId`.
 */

const QUESTION_ID = '11111111-1111-1111-1111-111111111111';

const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const englishSpecialty = {
  id: 'spec-english',
  slug: 'english',
  nameUz: 'Ingliz tili',
  nameRu: 'Английский язык',
  nameEn: 'English',
  isActive: true,
  dashboardKey: 'english',
  createdAt: new Date(0),
};

function buildQuestion(): OnboardingQuestion {
  return {
    id: QUESTION_ID,
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
    ],
    isActive: true,
  } as OnboardingQuestion;
}

/**
 * A fully isolated OnboardingService with in-memory mocks, mirroring
 * onboarding.service.spec.ts. Returns the service plus the spies we assert on.
 */
function makeService() {
  const mockTx = {
    onboardingAnswer: { upsert: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    onboardingQuestion: {
      findMany: jest.fn().mockResolvedValue([buildQuestion()]),
    },
    examTrack: {
      // Echo back every requested slug as an active track so examTrackFocus
      // validation always succeeds regardless of generated input.
      findMany: jest.fn(
        ({ where }: { where: { slug: { in: string[] } } }) =>
          Promise.resolve(where.slug.in.map((slug) => ({ slug }))),
      ),
    },
    $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(mockTx)),
  } as any;

  const specialtyService = {
    findById: jest.fn(),
    findBySlug: jest.fn().mockResolvedValue(englishSpecialty),
    getById: jest.fn(),
    listActive: jest.fn(),
  } as unknown as jest.Mocked<SpecialtyService>;

  const teacherProfileRepository = {
    findByUserId: jest.fn().mockResolvedValue(null),
    upsertWithSpecialty: jest.fn().mockResolvedValue({}),
    updateEnglishTeachingAttributes: jest.fn().mockResolvedValue({}),
    isPublicSlugTaken: jest.fn().mockResolvedValue(false),
    updatePublicProfile: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<TeacherProfileRepository>;

  const service = new OnboardingService(
    prisma,
    specialtyService,
    teacherProfileRepository,
  );

  return { service, specialtyService, teacherProfileRepository };
}

/**
 * How a legacy client might (or might not) supply the deprecated `specialtyId`:
 * absent, explicit null, or an arbitrary string (uuid-like, slug, empty, junk).
 */
type SpecialtyIdShape =
  | { kind: 'absent' }
  | { kind: 'null' }
  | { kind: 'string'; value: string };

const specialtyIdArb: fc.Arbitrary<SpecialtyIdShape> = fc.oneof(
  fc.constant<SpecialtyIdShape>({ kind: 'absent' }),
  fc.constant<SpecialtyIdShape>({ kind: 'null' }),
  fc.string().map((value) => ({ kind: 'string' as const, value })),
);

function withSpecialtyId<T extends object>(
  base: T,
  shape: SpecialtyIdShape,
): T & { specialtyId?: string | null } {
  switch (shape.kind) {
    case 'absent':
      return { ...base };
    case 'null':
      return { ...base, specialtyId: null };
    case 'string':
      return { ...base, specialtyId: shape.value };
  }
}

/** The supplied value as it would appear in the body (for "never used" checks). */
function suppliedValue(shape: SpecialtyIdShape): string | null | undefined {
  if (shape.kind === 'string') return shape.value;
  if (shape.kind === 'null') return null;
  return undefined;
}

describe('Property 6: specialty deprecation compatibility (Req 2.3)', () => {
  // ----------------------------------------------------------------
  // DTO boundary: the deprecated specialtyId is always accepted.
  // ----------------------------------------------------------------
  it('both onboarding schemas accept any legacy specialtyId and parse identically to omitting it', () => {
    fc.assert(
      fc.property(specialtyIdArb, (shape) => {
        const submitBase = {
          answers: [{ questionId: QUESTION_ID, selectedOptionId: 'opt_english' }],
        };
        const completeBase = {
          taughtCefrLevels: [CefrLevel.B1],
          examTrackFocus: [],
          publicSlug: 'legacy-shim-teacher',
        };

        const submitWith = SubmitAnswersSchema.safeParse(
          withSpecialtyId(submitBase, shape),
        );
        const completeWith = CompleteOnboardingSchema.safeParse(
          withSpecialtyId(completeBase, shape),
        );

        // Accepted without error in every case (never required, never rejected).
        expect(submitWith.success).toBe(true);
        expect(completeWith.success).toBe(true);

        // The rest of the parsed shape is identical to the omitted baseline:
        // the deprecated field never influences any other parsed value.
        const submitBaseline = SubmitAnswersSchema.parse(submitBase);
        const completeBaseline = CompleteOnboardingSchema.parse(completeBase);

        if (submitWith.success) {
          const { specialtyId: _ignored, ...rest } = submitWith.data;
          expect(rest).toEqual(submitBaseline);
        }
        if (completeWith.success) {
          const { specialtyId: _ignored, ...rest } = completeWith.data;
          expect(rest).toEqual(completeBaseline);
        }
      }),
      { numRuns: 300 },
    );
  });

  // ----------------------------------------------------------------
  // Service layer: submitAnswers ignores the legacy specialtyId.
  // ----------------------------------------------------------------
  it('submitAnswers: any legacy specialtyId is accepted and never changes the outcome', async () => {
    await fc.assert(
      fc.asyncProperty(
        specialtyIdArb,
        fc.uuid(),
        fc.option(fc.string(), { nil: null }),
        async (shape, teacherId, fullName) => {
          const answers = [
            { questionId: QUESTION_ID, selectedOptionId: 'opt_english' },
          ];

          // Run #1: with the (arbitrary) legacy specialtyId attached.
          const withShim = makeService();
          const dtoWith = withSpecialtyId(
            { answers },
            shape,
          ) as SubmitAnswersDto;
          const resultWith = await withShim.service.submitAnswers(
            teacherId,
            fullName,
            dtoWith,
          );

          // Run #2: identical request with the field omitted entirely.
          const baseline = makeService();
          const resultBaseline = await baseline.service.submitAnswers(
            teacherId,
            fullName,
            { answers } as SubmitAnswersDto,
          );

          // (a) Accepted without error AND the returned outcome is identical.
          expect(resultWith).toEqual(resultBaseline);
          expect(resultWith.specialty.slug).toBe('english');

          // (b) The Specialty is resolved server-side ('english'), never from
          //     the client-supplied value.
          expect(withShim.specialtyService.findBySlug).toHaveBeenCalledWith(
            'english',
          );
          const supplied = suppliedValue(shape);
          if (typeof supplied === 'string' && supplied.length > 0) {
            expect(
              withShim.specialtyService.findBySlug,
            ).not.toHaveBeenCalledWith(supplied);
          }

          // (c) The profile write uses the seeded English specialty id, never
          //     the supplied specialtyId.
          const upsertArg = (
            withShim.teacherProfileRepository.upsertWithSpecialty as jest.Mock
          ).mock.calls[0]?.[0];
          expect(upsertArg?.specialtyId).toBe('spec-english');
          if (typeof supplied === 'string') {
            expect(upsertArg?.specialtyId).not.toBe(supplied);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // ----------------------------------------------------------------
  // Service layer: completeOnboarding ignores the legacy specialtyId.
  // ----------------------------------------------------------------
  it('completeOnboarding: any legacy specialtyId is accepted and never changes the outcome', async () => {
    await fc.assert(
      fc.asyncProperty(
        specialtyIdArb,
        fc.uuid(),
        fc.option(fc.string(), { nil: null }),
        fc.array(fc.constantFrom(...CEFR_LEVELS), { maxLength: 6 }),
        async (shape, teacherId, fullName, levels) => {
          const base = {
            taughtCefrLevels: levels,
            examTrackFocus: [],
            publicSlug: 'legacy-shim-teacher-2',
          };

          // Run #1: with the (arbitrary) legacy specialtyId attached.
          const withShim = makeService();
          const resultWith = await withShim.service.completeOnboarding(
            teacherId,
            fullName,
            withSpecialtyId(base, shape) as CompleteOnboardingDto,
          );

          // Run #2: identical request with the field omitted entirely.
          const baseline = makeService();
          const resultBaseline = await baseline.service.completeOnboarding(
            teacherId,
            fullName,
            { ...base } as CompleteOnboardingDto,
          );

          // (a) Accepted without error AND identical outcome regardless of the
          //     deprecated field. Routes to the single English dashboard.
          expect(resultWith).toEqual(resultBaseline);
          expect(resultWith.dashboardUrl).toBe('/dashboard');

          // (b) The specialty stamped on the profile is the seeded English one,
          //     never the supplied value.
          const upsertArg = (
            withShim.teacherProfileRepository.upsertWithSpecialty as jest.Mock
          ).mock.calls[0]?.[0];
          expect(upsertArg?.specialtyId).toBe('spec-english');
          const supplied = suppliedValue(shape);
          if (typeof supplied === 'string') {
            expect(upsertArg?.specialtyId).not.toBe(supplied);
          }

          // (c) The legacy value was never used to look up a Specialty.
          if (typeof supplied === 'string' && supplied.length > 0) {
            expect(
              withShim.specialtyService.findBySlug,
            ).not.toHaveBeenCalledWith(supplied);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
