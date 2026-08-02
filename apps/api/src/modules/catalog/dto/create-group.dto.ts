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
});

export type CreateGroupDto = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    priceUzs: z.number().int().nonnegative().max(100_000_000).optional(),
    capacity: z.number().int().positive().max(1000).nullable().optional(),
    startsOn: z.string().datetime().nullable().optional(),
    endsOn: z.string().datetime().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>;
