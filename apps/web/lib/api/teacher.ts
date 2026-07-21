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
  discoverableCourseCount: number;
  profileUrlPath: string | null;
}

export interface UpdatePublicProfileDto {
  isPublic: boolean;
  headline?: string;
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
};
