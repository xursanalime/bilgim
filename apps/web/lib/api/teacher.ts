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

/** Accent color options (mirrors the API `TeacherAccentColor` enum) — a
 * closed set so every choice stays contrast-accessible. */
export const ACCENT_COLORS = ['BLUE', 'GREEN', 'PURPLE', 'ORANGE'] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

/**
 * Request body for `POST /teacher/onboarding/complete`.
 *
 * - `taughtCefrLevels` — the CEFR levels (A1–C2) the instructor teaches.
 *   Validated against the `CefrLevel` enum server-side; duplicates tolerated.
 * - `examTrackFocus` — `ExamTrack.slug` strings (e.g. `["ielts"]`). Each is
 *   validated against the admin-managed `ExamTrack` catalog server-side.
 * - `publicSlug` — REQUIRED. The URL segment the teacher's public profile
 *   ("their website", `bilgim.uz/teachers/:publicSlug`) is reachable at.
 *   Lowercase letters/numbers/single hyphens, 3–40 chars; server rejects a
 *   duplicate with `409 PUBLIC_SLUG_TAKEN`.
 * - `headline`/`bio`/`yearsOfExperience` — optional profile copy.
 * - `schoolName` — optional brand name distinct from the teacher's own
 *   name (e.g. "Nodira's English Academy"), shown above `fullName`.
 * - `accentColor` — one of {@link ACCENT_COLORS}; defaults to BLUE server-side.
 */
export interface CompleteOnboardingDto {
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
  publicSlug: string;
  headline?: string | null;
  bio?: string | null;
  yearsOfExperience?: number | null;
  schoolName?: string | null;
  accentColor?: AccentColor;
}

/** Response shape from `POST /teacher/onboarding/complete`. */
export interface CompleteOnboardingResult {
  /** Where to send the instructor next — always `/dashboard` (Req 10.4). */
  dashboardUrl: string;
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
  publicSlug: string;
}

/**
 * Response shape from `GET /teacher/profile/me`. Mirrors
 * `UsersRepository.getProfile` (a `User` row with its `teacherProfile`
 * relation included) — used to pre-fill the onboarding form when a teacher
 * revisits it, and to gate the dashboard on "has the teacher published a
 * public profile yet".
 */
export interface TeacherProfileMe {
  id: string;
  fullName: string;
  teacherProfile: {
    publicSlug: string | null;
    headline: string | null;
    bio: string | null;
    yearsOfExperience: number | null;
    schoolName: string | null;
    accentColor: AccentColor;
    taughtCefrLevels: CefrLevel[];
    examTrackFocus: string[];
  } | null;
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
   * CEFR levels, exam-track focus, and public profile (publicSlug/headline/
   * bio), and returns the dashboard URL to route to.
   */
  completeOnboarding: (dto: CompleteOnboardingDto) =>
    apiClient.post<CompleteOnboardingResult>(
      '/teacher/onboarding/complete',
      dto,
    ),

  /** Fetch the calling teacher's profile (used to gate/pre-fill onboarding). */
  getMyProfile: () => apiClient.get<TeacherProfileMe>('/teacher/profile/me'),

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
