import { z } from 'zod';

import { CEFR_LEVELS } from './list-courses.dto';

const CefrLevelSchema = z.enum(CEFR_LEVELS);

/**
 * Accept one or more CEFR levels from the query string (single value or a
 * repeated param), normalised to a string[]. Matches an instructor's
 * `taughtCefrLevels`.
 */
const CefrLevelFacetSchema = z
  .union([CefrLevelSchema, z.array(CefrLevelSchema).min(1)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

/**
 * Query for `GET /discovery/teachers` (Req 14.1, 14.2, 14.4).
 *
 * English-only refocus: the generic `specialtyId` facet is retired and
 * replaced by the English level + exam-track facets (Req 14.4):
 *   - `cefrLevel` matches the instructor's `taughtCefrLevels`.
 *   - `examTrack` matches the instructor's `examTrackFocus` slugs.
 * `specialtyId` is still accepted for backwards compatibility but ignored
 * by the service (Req 2.3).
 *
 * Visibility filter (enforced in the repository, not the DTO):
 *   - `TeacherProfile.publicSlug != NULL`
 *   - the teacher owns at least one published+discoverable course (joins
 *     scoped to `Course.isPublished=true AND Course.isDiscoverable=true`).
 */
export const ListDiscoveryTeachersSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  cefrLevel: CefrLevelFacetSchema.optional(),
  examTrack: z.string().trim().min(1).max(50).optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  /** DEPRECATED (english-only refocus): accepted but ignored — Req 2.3. */
  specialtyId: z.string().uuid().optional(),
});

export type ListDiscoveryTeachersDto = z.infer<
  typeof ListDiscoveryTeachersSchema
>;
