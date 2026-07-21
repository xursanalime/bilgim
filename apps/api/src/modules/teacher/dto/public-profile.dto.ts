import { z } from 'zod';

/**
 * UpdatePublicProfileDto — Zod schema for PATCH /teacher/profile/public.
 *
 * `isPublic=true` makes the teacher discoverable on `/discovery/teachers`
 * (a `publicSlug` is generated on first enable); `isPublic=false` clears
 * the slug so the profile drops out of discovery. `headline` is optional
 * and editable independent of the toggle.
 */
export const UpdatePublicProfileSchema = z.object({
  isPublic: z.boolean(),
  headline: z.string().trim().max(200).optional(),
});

export type UpdatePublicProfileDto = z.infer<typeof UpdatePublicProfileSchema>;
