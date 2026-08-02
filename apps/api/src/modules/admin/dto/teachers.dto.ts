import { z } from 'zod';

/**
 * Query for `GET /admin/teachers` (Task 23.1).
 *
 * Powers the admin "teacher operations" view: a paginated TeacherProfile
 * list joined with the latest non-terminal subscription (if any) and the
 * onboarding completion timestamp. Filters mirror the operations team's
 * actual triage flow:
 *   - `subscriptionStatus` — narrow to teachers in a specific lifecycle
 *     state (e.g. PAST_DUE for dunning workflows).
 *   - `onboarding` — `complete` or `pending`; resolves against
 *     `TeacherProfile.onboardingCompletedAt IS NULL`.
 *   - `q` — case-insensitive substring match against `User.email`,
 *     `User.username`, `TeacherProfile.fullName` so the list aligns
 *     with how admins find a specific teacher.
 *
 * Pagination is page-based for parity with `listUsers`.
 */
export const ListTeachersQuerySchema = z.object({
  subscriptionStatus: z
    .enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'])
    .optional(),
  onboarding: z.enum(['complete', 'pending']).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type ListTeachersQueryDto = z.infer<typeof ListTeachersQuerySchema>;
