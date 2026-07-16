import { z } from 'zod';

/**
 * Refresh DTO — Zod schema for POST /auth/refresh.
 * Validates the refresh token for token rotation.
 *
 * Optional in the body: browser clients send no body at all and rely on
 * the HttpOnly `refresh_token` cookie (AuthController falls back to
 * `req.cookies?.refresh_token`); mobile clients (no shared cookie jar)
 * must send it explicitly.
 */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export type RefreshDto = z.infer<typeof RefreshSchema>;
