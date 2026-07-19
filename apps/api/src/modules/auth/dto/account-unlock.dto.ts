import { z } from 'zod';

/**
 * AccountUnlock DTO — Zod schema for `POST /auth/account/unlock`.
 *
 * The token is the raw 64-char hex string emailed to the user when a
 * hard-lock fires (Task 27.2). The service hashes it before lookup,
 * so this layer only needs to validate that we have a non-empty
 * string with a sane length to avoid pointless Redis round-trips on
 * obviously-malformed input.
 */
export const AccountUnlockSchema = z.object({
  token: z
    .string()
    .min(16, 'Token is required')
    .max(256, 'Token is invalid'),
});

export type AccountUnlockDto = z.infer<typeof AccountUnlockSchema>;
