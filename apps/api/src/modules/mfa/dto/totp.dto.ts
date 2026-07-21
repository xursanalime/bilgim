import { z } from 'zod';

/**
 * Body for `POST /mfa/totp/setup`. The label is optional — clients
 * default to "Authenticator" so the row in `MfaCredential` is always
 * human-readable.
 */
export const TotpSetupSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});
export type TotpSetupDto = z.infer<typeof TotpSetupSchema>;

/**
 * Body for `POST /mfa/totp/verify` and the inner branch of the
 * `/auth/mfa/challenge` flow. TOTP codes are 6 digits per RFC 6238.
 */
export const TotpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/u, 'TOTP code must be 6 digits'),
});
export type TotpVerifyDto = z.infer<typeof TotpVerifySchema>;

/**
 * Body for `POST /mfa/totp/disable`. Requires the user's current
 * password AND a fresh TOTP code so a stolen access token cannot
 * silently strip the second factor.
 */
export const TotpDisableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/u, 'TOTP code must be 6 digits'),
});
export type TotpDisableDto = z.infer<typeof TotpDisableSchema>;
