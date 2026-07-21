import { z } from 'zod';

/**
 * Login DTO — Zod schema for POST /auth/login.
 * Validates email and password for authentication.
 *
 * `hCaptchaToken` is optional but **required** when the server's
 * previous response (or `GET /auth/login/state?email=...`) reported
 * `captchaRequired: true`. The auth flow re-checks this flag from
 * Redis on every login attempt — see `BruteForceService.checkAccountStatus`
 * (Task 27.2, Req 27.4). When the env var `HCAPTCHA_SECRET` is unset,
 * the server is in dev-mode bypass and any value (or no value) is
 * accepted.
 */
export const LoginSchema = z.object({
  email: z.string().email('Invalid email format').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
  hCaptchaToken: z.string().min(1).optional(),
});

export type LoginDto = z.infer<typeof LoginSchema>;
