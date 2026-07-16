import { z } from 'zod';

/**
 * Body for `POST /catalog/courses/:courseId/groups` (Req 7.2).
 *
 * `priceUzs` is required (default 0 means free). Dates are ISO date-time
 * strings; the service converts them to Date objects before persisting.
 */
export const CreateGroupSchema = z.object({
  name: z.string().min(1, 'name is required').max(100),
  priceUzs: z.number().int().nonnegative().max(100_000_000).default(0),
  capacity: z.number().int().positive().max(1000).optional(),
  startsOn: z
    .string()
    .datetime({ message: 'startsOn must be an ISO 8601 datetime' })
    .optional(),
  endsOn: z
    .string()
    .datetime({ message: 'endsOn must be an ISO 8601 datetime' })
    .optional(),
  /**
   * @deprecated Req 2.3 — the generic Specialty abstraction is being retired.
   * Group module seeding now derives from the teacher's (single, English)
   * specialty server-side, never from client input. This field is still
   * accepted (validated leniently) for backward compatibility during the
   * deprecation window but is IGNORED: it is never read or persisted.
   * Omitting it is fully supported. Remove once the Specialty decommission
   * completes (see packages/db/DECOMMISSION.md).
   */
  specialtyId: z.string().optional().nullable(),
});

export type CreateGroupDto = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    priceUzs: z.number().int().nonnegative().max(100_000_000).optional(),
    capacity: z.number().int().positive().max(1000).nullable().optional(),
    startsOn: z.string().datetime().nullable().optional(),
    endsOn: z.string().datetime().nullable().optional(),
    /**
     * @deprecated Req 2.3 — accepted but IGNORED. See CreateGroupSchema for
     * the full rationale. Present so a legacy client that PATCHes a group
     * with a `specialtyId` still succeeds; the value is never read or
     * persisted.
     */
    specialtyId: z.string().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>;
