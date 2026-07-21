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

export const teacherApi = {
  getOnboardingQuestions: () =>
    apiClient.get<OnboardingQuestion[]>('/teacher/onboarding/questions'),
  submitOnboardingAnswers: (dto: SubmitAnswersDto) =>
    apiClient.post<SubmitAnswersResult>('/teacher/onboarding/answers', dto),
};
