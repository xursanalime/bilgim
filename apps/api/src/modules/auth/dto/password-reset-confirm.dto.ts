import { z } from 'zod';

/**
 * PasswordResetConfirm DTO — Zod schema for POST /auth/password-reset/confirm.
 * Validates token and new password for password reset completion.
 */
export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type PasswordResetConfirmDto = z.infer<typeof PasswordResetConfirmSchema>;
