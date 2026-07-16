import { CefrLevel } from '@prisma/client';

import { CompleteOnboardingSchema } from './complete-onboarding.dto';

/**
 * Req 10.2, 10.3 — refocused English-only instructor onboarding.
 *
 * POST /teacher/onboarding/complete collects English-teaching attributes
 * (taught CEFR levels + exam-track focus) instead of a specialty. These tests
 * assert the request-DTO boundary; persistence + dashboard routing are asserted
 * in `onboarding.service.spec.ts`.
 */
describe('CompleteOnboardingSchema (Req 10.2, 10.3)', () => {
  it('accepts valid CEFR levels and exam-track slugs', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: [CefrLevel.A1, CefrLevel.B2],
      examTrackFocus: ['ielts'],
    });
    expect(result.success).toBe(true);
  });

  it('defaults both arrays to empty when omitted (no specialty required)', () => {
    const result = CompleteOnboardingSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taughtCefrLevels).toEqual([]);
      expect(result.data.examTrackFocus).toEqual([]);
    }
  });

  it('rejects an invalid CEFR level', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: ['Z9'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string exam-track slug', () => {
    const result = CompleteOnboardingSchema.safeParse({
      examTrackFocus: [''],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a deprecated specialtyId but it is part of the parsed shape (ignored server-side)', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: [CefrLevel.C1],
      examTrackFocus: [],
      specialtyId: 'legacy-slug',
    });
    expect(result.success).toBe(true);
  });
});
