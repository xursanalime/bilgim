/**
 * Teacher API client — wraps the NestJS `/teacher/*` endpoints used by the
 * onboarding wizard.
 */

import { apiClient } from '../api-client';

export interface OnboardingQuestion {
  id: string;
  order: number;
  text: string;
  specialtyId: string | null;
  options: Array<{ id: string; text: string }>;
}

export interface SubmitAnswersDto {
  answers: Array<{ questionId: string; selectedOptionId: string }>;
}

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

export interface PublicProfileStatus {
  isPublic: boolean;
  publicSlug: string | null;
  headline: string | null;
  fullName: string | null;
  coverUrl: string | null;
  themeColor: string | null;
  discoverableCourseCount: number;
  profileUrlPath: string | null;
}

export interface UpdatePublicProfileDto {
  isPublic: boolean;
  headline?: string;
  publicSlug?: string;
  coverUrl?: string;
  themeColor?: string;
}

export type SlugAvailability =
  | { available: true }
  | { available: false; reason: 'invalid' | 'reserved' | 'taken' };

export interface CreatePreviewTokenDto {
  slug: string;
  headline?: string;
  coverUrl?: string;
  themeColor?: string;
}

export interface CreatePreviewTokenResult {
  previewToken: string;
  expiresInSeconds: number;
}

export const teacherApi = {
  getOnboardingQuestions: () =>
    apiClient.get<OnboardingQuestion[]>('/teacher/onboarding/questions'),
  submitOnboardingAnswers: (dto: SubmitAnswersDto) =>
    apiClient.post<SubmitAnswersResult>('/teacher/onboarding/answers', dto),
  getPublicProfile: () =>
    apiClient.get<PublicProfileStatus>('/teacher/profile/public'),
  updatePublicProfile: (dto: UpdatePublicProfileDto) =>
    apiClient.patch<PublicProfileStatus>('/teacher/profile/public', dto),
  checkPublicSlug: (slug: string) =>
    apiClient.get<SlugAvailability>(
      `/teacher/profile/public-slug/check?slug=${encodeURIComponent(slug)}`,
    ),
  createPreviewToken: (dto: CreatePreviewTokenDto) =>
    apiClient.post<CreatePreviewTokenResult>('/teacher/profile/public-slug/preview-token', dto),
};
