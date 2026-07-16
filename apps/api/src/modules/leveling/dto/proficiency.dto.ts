import { z } from 'zod';

import { CefrLevelSchema } from './level.dto';

/**
 * Origin of a learner proficiency change (Req 4.3, 4.4).
 *
 * Persisted verbatim into `ProficiencyLevelHistory.source` (a free string
 * column). Constraining it to this set here keeps the history audit-grade and
 * lets downstream readers (Discovery, reports) rely on a known vocabulary:
 *   - `instructor` → an Instructor recorded a manual level change (Req 4.4).
 *   - `placement`  → set by the Placement_Module after scoring (Req 4.3 / 5.3).
 *   - `migration`  → set by the one-time Migration_Process (Req 16.2).
 */
export const ProficiencySourceSchema = z.enum([
  'instructor',
  'placement',
  'migration',
]);
export type ProficiencySource = z.infer<typeof ProficiencySourceSchema>;

/**
 * Body for `PATCH /leveling/learners/:id/proficiency` (Req 4.4).
 *
 * An Instructor records a concrete CEFR level for an enrolled learner. The
 * level is **required and non-null**: this endpoint promotes/demotes a learner
 * to a known level, it never reverts them to UNASSESSED (that state only
 * arises from never having been assessed). The `source` is fixed to
 * `instructor` server-side, so it is intentionally not part of the body.
 */
export const SetProficiencySchema = z.object({
  cefrLevel: CefrLevelSchema,
});
export type SetProficiencyDto = z.infer<typeof SetProficiencySchema>;
