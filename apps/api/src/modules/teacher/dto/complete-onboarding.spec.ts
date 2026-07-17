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
  it('accepts valid CEFR levels, exam-track slugs, and publicSlug', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: [CefrLevel.A1, CefrLevel.B2],
      examTrackFocus: ['ielts'],
      publicSlug: 'nodira-rashidova',
    });
    expect(result.success).toBe(true);
  });

  it('defaults both arrays to empty when omitted (no specialty required)', () => {
    const result = CompleteOnboardingSchema.safeParse({
      publicSlug: 'ustoz',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taughtCefrLevels).toEqual([]);
      expect(result.data.examTrackFocus).toEqual([]);
    }
  });

  it('rejects an invalid CEFR level', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: ['Z9'],
      publicSlug: 'ustoz',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string exam-track slug', () => {
    const result = CompleteOnboardingSchema.safeParse({
      examTrackFocus: [''],
      publicSlug: 'ustoz',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a deprecated specialtyId but it is part of the parsed shape (ignored server-side)', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: [CefrLevel.C1],
      examTrackFocus: [],
      publicSlug: 'ustoz',
      specialtyId: 'legacy-slug',
    });
    expect(result.success).toBe(true);
  });

  // ------------------------------------------------------------------
  // publicSlug — claims the teacher's public profile URL ("website")
  // ------------------------------------------------------------------

  it('rejects a missing publicSlug (required — Req: teacher website setup)', () => {
    const result = CompleteOnboardingSchema.safeParse({
      taughtCefrLevels: [CefrLevel.B1],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a publicSlug shorter than 3 characters', () => {
    const result = CompleteOnboardingSchema.safeParse({ publicSlug: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects a publicSlug with spaces or leading/trailing/double hyphens', () => {
    for (const bad of ['nodira rashidova', '-nodira', 'nodira-', 'nodira--rashidova']) {
      expect(CompleteOnboardingSchema.safeParse({ publicSlug: bad }).success).toBe(false);
    }
  });

  it('lowercases and trims a valid publicSlug (case-insensitive input is normalized, not rejected)', () => {
    const result = CompleteOnboardingSchema.safeParse({
      publicSlug: '  Nodira-Rashidova  ',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.publicSlug).toBe('nodira-rashidova');
  });

  it('accepts optional headline and bio, and rejects an over-long headline', () => {
    const ok = CompleteOnboardingSchema.safeParse({
      publicSlug: 'ustoz',
      headline: 'IELTS 8.0 | 7 yillik tajriba',
      bio: 'Cambridge CELTA certified instructor.',
    });
    expect(ok.success).toBe(true);

    const tooLong = CompleteOnboardingSchema.safeParse({
      publicSlug: 'ustoz',
      headline: 'x'.repeat(121),
    });
    expect(tooLong.success).toBe(false);
  });
});
