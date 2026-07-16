import { z } from 'zod';

/**
 * Body for `POST /enrollment/invite-links`.
 *
 * - `groupId` is the target group; the controller asserts the authenticated
 *   teacher actually owns it (cross-teacher access is rejected by the
 *   service layer, Req 5.1).
 * - `expiresInHours` defaults to 168 (7 days). `null` means "never expires"
 *   — we keep that escape hatch for back-office invites but the API forbids
 *   negative or zero TTLs.
 * - `usesLimit` defaults to 100. `null` means "unlimited uses". The service
 *   layer enforces `usesCount < usesLimit` on resolve (Req 5.7).
 */
export const CreateInviteSchema = z.object({
  groupId: z.string().uuid('groupId must be a UUID'),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365, 'expiresInHours must be ≤ 1 year')
    .nullable()
    .optional(),
  usesLimit: z
    .number()
    .int()
    .positive()
    .max(100_000)
    .nullable()
    .optional(),
});

export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;
