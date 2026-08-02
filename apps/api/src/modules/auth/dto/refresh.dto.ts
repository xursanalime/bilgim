import { z } from 'zod';

/**
 * Refresh DTO — Zod schema for POST /auth/refresh.
 * Validates the refresh token for token rotation.
 */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshDto = z.infer<typeof RefreshSchema>;
