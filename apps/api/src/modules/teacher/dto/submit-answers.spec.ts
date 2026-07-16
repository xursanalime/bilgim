import { SubmitAnswersSchema } from './submit-answers.dto';

/**
 * Req 2.3 — `specialtyId` deprecation shim (Task 6.3).
 *
 * POST /teacher/onboarding/answers historically belonged to the specialty
 * classification flow. The Specialty abstraction is being retired, so the
 * endpoint must keep accepting a legacy `specialtyId` while ignoring it. These
 * tests assert the request-DTO boundary; "ignored server-side" is asserted in
 * `onboarding.service.spec.ts`.
 */
describe('SubmitAnswersSchema — specialtyId deprecation shim (Req 2.3)', () => {
  const QUESTION_ID = '11111111-1111-1111-1111-111111111111';

  const baseAnswers = {
    answers: [{ questionId: QUESTION_ID, selectedOptionId: 'opt_english' }],
  };

  it('accepts a request that includes a deprecated specialtyId', () => {
    const result = SubmitAnswersSchema.safeParse({
      ...baseAnswers,
      specialtyId: '22222222-2222-2222-2222-222222222222',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a request that omits specialtyId (never required)', () => {
    const result = SubmitAnswersSchema.safeParse(baseAnswers);
    expect(result.success).toBe(true);
  });

  it('accepts a non-UUID specialtyId leniently (does not break legacy clients)', () => {
    const result = SubmitAnswersSchema.safeParse({
      ...baseAnswers,
      specialtyId: 'legacy-slug',
    });
    expect(result.success).toBe(true);
  });

  it('still enforces the real contract (answers required)', () => {
    const result = SubmitAnswersSchema.safeParse({
      answers: [],
      specialtyId: 'whatever',
    });
    expect(result.success).toBe(false);
  });
});
