import { z } from 'zod';

/**
 * Shared validator for `TeacherProfile.publicSlug` — the URL segment a
 * teacher's public profile ("their website") is reachable at:
 * `/teachers/:publicSlug`. Used by both the onboarding completion DTO and
 * (future) profile-settings updates so the format rule lives in one place.
 */
export const PublicSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'publicSlug must be at least 3 characters long')
  .max(40, 'publicSlug must be at most 40 characters long')
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'publicSlug may only contain lowercase letters, numbers, and single hyphens (no leading/trailing/double hyphens)',
  );
