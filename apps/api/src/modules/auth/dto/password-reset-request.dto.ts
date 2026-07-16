import { z } from 'zod';

/**
 * PasswordResetRequest DTO — Zod schema for POST /auth/password-reset/request.
 * Validates email for password reset initiation.
 */
export const PasswordResetRequestSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
});

export type PasswordResetRequestDto = z.infer<typeof PasswordResetRequestSchema>;
