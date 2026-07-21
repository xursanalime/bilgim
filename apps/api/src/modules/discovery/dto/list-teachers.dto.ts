import { z } from 'zod';

/**
 * Query for `GET /discovery/teachers` (Req 14.1, 14.2, 14.4).
 *
 * Visibility filter (enforced in the repository, not the DTO):
 *   - `TeacherProfile.publicSlug != NULL`
 *   - the teacher owns at least one published+discoverable course (joins
 *     scoped to `Course.isPublished=true AND Course.isDiscoverable=true`).
 */
export const ListDiscoveryTeachersSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  specialtyId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export type ListDiscoveryTeachersDto = z.infer<
  typeof ListDiscoveryTeachersSchema
>;
