import { z } from 'zod';

/**
 * VerifyEmail DTO — Zod schema for POST /auth/verify-email.
 * Validates the email verification token (hex string, 64 chars = 32 bytes).
 */
export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type VerifyEmailDto = z.infer<typeof VerifyEmailSchema>;
