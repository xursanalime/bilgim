import { z } from 'zod';

/**
 * Body for `POST /auth/mfa/challenge`. Carries the short-lived MFA
 * token issued by `/auth/login` plus EITHER a TOTP/backup code OR a
 * WebAuthn assertion. Exactly one of `code` / `webauthn` MUST be
 * provided — the service validates that condition and rejects
 * ambiguous bodies.
 */
export const MfaChallengeSchema = z.object({
  mfaToken: z.string().min(1, 'mfaToken is required'),
  code: z
    .string()
    .trim()
    .min(6)
    .max(32)
    .optional(),
  webauthn: z
    .object({
      response: z.object({
        id: z.string().min(1),
        rawId: z.string().min(1),
        type: z.string().min(1),
        response: z.object({
          clientDataJSON: z.string().min(1),
          authenticatorData: z.string().min(1),
          signature: z.string().min(1),
          userHandle: z.string().optional(),
        }),
        clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
        authenticatorAttachment: z.string().optional(),
      }),
    })
    .optional(),
});
export type MfaChallengeDto = z.infer<typeof MfaChallengeSchema>;
