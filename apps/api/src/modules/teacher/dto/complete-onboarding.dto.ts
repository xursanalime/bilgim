import { CefrLevel, TeacherAccentColor } from '@prisma/client';
import { z } from 'zod';

import { PublicSlugSchema } from './public-slug.schema';

/**
 * CompleteOnboardingDto — Zod schema for POST /teacher/onboarding/complete.
 *
 * This is the LIVE instructor-onboarding submission for the English-only
 * platform (Req 10.2, 10.3). There is no specialty selection step: every
 * instructor teaches English. Onboarding instead collects English-teaching
 * attributes:
 *
 *   - `taughtCefrLevels` — the subset of CEFR levels (A1–C2) the instructor
 *     teaches. Each entry is validated against the `CefrLevel` enum, so an
 *     invalid level (e.g. "Z9") is rejected at the boundary. Duplicates are
 *     tolerated here and de-duplicated server-side.
 *   - `examTrackFocus` — `ExamTrack.slug` strings the instructor focuses on
 *     (e.g. ["ielts"]). Each must be a non-empty string; existence against the
 *     admin-managed `ExamTrack` catalog is validated server-side.
 *
 * Both arrays are optional and default to empty: an instructor can complete
 * onboarding without declaring any attribute and still reach the dashboard.
 *
 * `publicSlug` is REQUIRED: onboarding completion is also where a teacher
 * claims the URL their public profile ("website", `/teachers/:publicSlug`)
 * lives at. Without it the teacher can never appear on the public discovery
 * surface (`discovery.repository.ts` requires `publicSlug IS NOT NULL`).
 * `headline`/`bio` are optional polish on top of that profile.
 */
export const CompleteOnboardingSchema = z.object({
  taughtCefrLevels: z
    .array(z.nativeEnum(CefrLevel))
    .max(6, 'taughtCefrLevels cannot contain more than six levels')
    .optional()
    .default([]),
  examTrackFocus: z
    .array(z.string().min(1, 'examTrackFocus entries must be non-empty strings'))
    .optional()
    .default([]),
  publicSlug: PublicSlugSchema,
  headline: z
    .string()
    .trim()
    .max(120, 'headline must be at most 120 characters long')
    .optional()
    .nullable(),
  bio: z
    .string()
    .trim()
    .max(2000, 'bio must be at most 2000 characters long')
    .optional()
    .nullable(),
  yearsOfExperience: z
    .number()
    .int()
    .min(0, 'yearsOfExperience cannot be negative')
    .max(60, 'yearsOfExperience must be at most 60')
    .optional()
    .nullable(),
  /** Optional brand name distinct from the teacher's own name, e.g.
   * "Nodira's English Academy" — shown above `fullName` on the profile. */
  schoolName: z
    .string()
    .trim()
    .max(60, 'schoolName must be at most 60 characters long')
    .optional()
    .nullable(),
  /** Closed set (Req: contrast-accessible branding) — defaults to BLUE
   * server-side when omitted, matching the schema default. */
  accentColor: z.nativeEnum(TeacherAccentColor).optional(),
  /**
   * @deprecated Req 2.3 — the generic Specialty abstraction is being retired.
   * Accepted (and validated leniently) for backward compatibility with legacy
   * clients, but IGNORED: it is never read or used to write/require a
   * Specialty. Omitting it is fully supported.
   */
  specialtyId: z.string().optional().nullable(),
});

export type CompleteOnboardingDto = z.infer<typeof CompleteOnboardingSchema>;
