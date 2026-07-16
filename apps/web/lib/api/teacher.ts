/**
 * Teacher API client — wraps the NestJS `/teacher/*` endpoints used by the
 * instructor onboarding flow.
 *
 * Bilgim is an English-only platform. The live onboarding submission collects
 * English-teaching attributes (taught CEFR levels + exam-track focus) via
 * `POST /teacher/onboarding/complete`. The legacy specialty quiz
 * (`/teacher/onboarding/questions` + `/answers`) is retired by the
 * english-only-platform-refocus work and kept here only for backward
 * compatibility — see the `@deprecated` markers below.
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────
// English-focused instructor onboarding (LIVE — Req 16.2)
// ──────────────────────────────────────────────────────────────────

/** CEFR proficiency levels (mirrors the API `CefrLevel` enum). */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * Request body for `POST /teacher/onboarding/complete`.
 *
 * - `taughtCefrLevels` — the CEFR levels (A1–C2) the instructor teaches.
 *   Validated against the `CefrLevel` enum server-side; duplicates tolerated.
 * - `examTrackFocus` — `ExamTrack.slug` strings (e.g. `["ielts"]`). Each is
 *   validated against the admin-managed `ExamTrack` catalog server-side.
 */
export interface CompleteOnboardingDto {
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
}

/** Response shape from `POST /teacher/onboarding/complete`. */
export interface CompleteOnboardingResult {
  /** Where to send the instructor next — always `/dashboard` (Req 10.4). */
  dashboardUrl: string;
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
}

// ──────────────────────────────────────────────────────────────────
// Legacy specialty quiz (DEPRECATED)
// ──────────────────────────────────────────────────────────────────

/** @deprecated Retired with the english-only refocus. Use {@link CompleteOnboardingDto}. */
export interface OnboardingQuestion {
  id: string;
  order: number;
  text: string;
  specialtyId: string | null;
  options: Array<{ id: string; text: string }>;
}

/** @deprecated Retired with the english-only refocus. */
export interface SubmitAnswersDto {
  answers: Array<{ questionId: string; selectedOptionId: string }>;
}

/** @deprecated Retired with the english-only refocus. */
export interface SubmitAnswersResult {
  specialty: {
    id: string;
    slug: string;
    nameUz: string;
    nameRu: string;
    nameEn: string;
  };
  dashboardUrl: string;
  confidence: number;
  usedAiFallback: boolean;
}

export const teacherApi = {
  /**
   * Complete the English-focused instructor onboarding. Persists the taught
   * CEFR levels + exam-track focus and returns the dashboard URL to route to.
   */
  completeOnboarding: (dto: CompleteOnboardingDto) =>
    apiClient.post<CompleteOnboardingResult>(
      '/teacher/onboarding/complete',
      dto,
    ),

  /**
   * @deprecated Retired with the english-only refocus in favour of
   * {@link teacherApi.completeOnboarding}. The specialty quiz endpoint is kept
   * only for backward compatibility with legacy clients.
   */
  getOnboardingQuestions: () =>
    apiClient.get<OnboardingQuestion[]>('/teacher/onboarding/questions'),

  /**
   * @deprecated Retired with the english-only refocus in favour of
   * {@link teacherApi.completeOnboarding}.
   */
  submitOnboardingAnswers: (dto: SubmitAnswersDto) =>
    apiClient.post<SubmitAnswersResult>('/teacher/onboarding/answers', dto),
};
