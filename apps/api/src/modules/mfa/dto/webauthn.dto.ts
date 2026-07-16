import { z } from 'zod';

/**
 * Generation phase: clients only need to declare an optional label
 * for the new credential. Everything else (RP id, RP name, allowed
 * algorithms) is server-side policy.
 */
export const WebAuthnRegistrationOptionsSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
});
export type WebAuthnRegistrationOptionsDto = z.infer<
  typeof WebAuthnRegistrationOptionsSchema
>;

/**
 * Subset of `RegistrationResponseJSON` we need from the browser. We
 * keep it loose (`z.record(z.string(), z.unknown())` for the inner
 * objects) so the SimpleWebAuthn library — which has its own strict
 * verifier — owns format validation.
 */
export const WebAuthnRegistrationFinishSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  response: z.object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.string().min(1),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      authenticatorData: z.string().optional(),
      transports: z.array(z.string()).optional(),
      publicKeyAlgorithm: z.number().optional(),
      publicKey: z.string().optional(),
    }),
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    authenticatorAttachment: z.string().optional(),
  }),
});
export type WebAuthnRegistrationFinishDto = z.infer<
  typeof WebAuthnRegistrationFinishSchema
>;

/**
 * Authentication phase trigger. The server picks the user from the
 * authenticated session (or the MFA challenge token) so the body is
 * empty by design.
 */
export const WebAuthnAuthenticationOptionsSchema = z
  .object({})
  .partial();
export type WebAuthnAuthenticationOptionsDto = z.infer<
  typeof WebAuthnAuthenticationOptionsSchema
>;

/**
 * Subset of `AuthenticationResponseJSON` we need from the browser to
 * verify an assertion.
 */
export const WebAuthnAuthenticationFinishSchema = z.object({
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
});
export type WebAuthnAuthenticationFinishDto = z.infer<
  typeof WebAuthnAuthenticationFinishSchema
>;
