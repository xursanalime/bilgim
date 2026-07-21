import { z } from 'zod';

/**
 * ResendVerification DTO — Zod schema for POST /auth/resend-verification.
 * Re-sends the email-verification link for a pending user.
 *
 * The endpoint is public (the user can't log in until verified) and
 * always returns 200 to avoid email enumeration. Per-email throttling
 * (1 request / hour) is enforced inside the service via Redis SETNX.
 */
export const ResendVerificationSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
});

export type ResendVerificationDto = z.infer<typeof ResendVerificationSchema>;
