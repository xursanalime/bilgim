// Shared types and Zod schemas used across frontend and backend
export { UserRole, SubscriptionStatus } from './enums';

/**
 * Teacher profile shape returned by GET /teacher/profile/me
 * Mirrors the TeacherProfile Prisma model + specialty relation.
 */
export interface TeacherProfile {
  userId: string;
  specialtyId: string | null;
  bio: string | null;
  yearsOfExperience: number | null;
  onboardingCompletedAt: string | null;
  createdAt: string;
  publicSlug: string | null;
  headline: string | null;
  fullName: string | null;
  coverUrl: string | null;
  rating: number | null;
  studentsCount: number;
  specialty?: {
    id: string;
    name: string;
    modules?: { moduleType: string }[];
  } | null;
}
