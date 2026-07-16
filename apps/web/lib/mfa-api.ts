/**
 * MFA API client — wraps the NestJS `/mfa/*` endpoints (TOTP, WebAuthn,
 * backup codes, credential management) plus the public
 * `/auth/mfa/challenge` step used during login.
 *
 * Management endpoints require an authenticated session (the access-token
 * cookie / Authorization header added by `apiClient`). The login challenge
 * endpoint is public — it is authorised by the short-lived `mfaToken` that
 * `/auth/login` returns, not by a session.
 *
 * Endpoint contracts mirror `apps/api/src/modules/mfa/mfa.controller.ts` and
 * the `MfaService` result types one-to-one.
 */

import { apiClient } from './api-client';
import type {
  AuthenticationOptionsJSON,
  AuthenticationResponseJSON,
  RegistrationOptionsJSON,
  RegistrationResponseJSON,
} from './webauthn';

// ─────────────────────────────────────────────────────────────────────────
// Types (mirror MfaService result shapes)
// ─────────────────────────────────────────────────────────────────────────

export type MfaMethod = 'totp' | 'webauthn' | 'backup';

export type MfaCredentialType = 'TOTP' | 'WEBAUTHN';

export interface TotpSetupResult {
  /** MfaCredential row id (used to revoke before verifying). */
  credentialId: string;
  /** Plain base32 secret for manual entry. Only returned during setup. */
  secret: string;
  /** `otpauth://totp/...` provisioning URI. */
  otpauthUrl: string;
  /** `data:image/png;base64,...` rendering of the QR code. */
  qrDataUrl: string;
}

export interface TotpVerifyResult {
  credentialId: string;
  enabled: true;
}

export interface BackupCodesResult {
  /** Plaintext codes — shown to the user exactly once. */
  codes: string[];
  remaining: number;
}

export interface CredentialView {
  id: string;
  type: MfaCredentialType;
  label: string | null;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface LoginUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  fullName: string;
}

export interface LoginTokens {
  accessToken: string;
  refreshToken: string;
  user: LoginUser;
}

export interface MfaChallengeRequired {
  requiresMfa: true;
  mfaToken: string;
  expiresIn: number;
  methods: MfaMethod[];
}

/** Discriminated result of `/auth/login`. */
export type LoginResult = LoginTokens | MfaChallengeRequired;

export function isMfaChallengeRequired(
  result: LoginResult,
): result is MfaChallengeRequired {
  return (result as MfaChallengeRequired).requiresMfa === true;
}

// ─────────────────────────────────────────────────────────────────────────
// Management endpoints (authenticated)
// ─────────────────────────────────────────────────────────────────────────

export const mfaApi = {
  /** GET /mfa/credentials — list the user's enrolled factors. */
  listCredentials() {
    return apiClient.get<CredentialView[]>('/mfa/credentials');
  },

  /** DELETE /mfa/credentials/:id — revoke a factor. */
  revokeCredential(id: string) {
    return apiClient.delete<{ revoked: true }>(`/mfa/credentials/${id}`);
  },

  // TOTP ------------------------------------------------------------------

  /** POST /mfa/totp/setup — returns secret + QR for an unverified factor. */
  setupTotp(label?: string) {
    return apiClient.post<TotpSetupResult>(
      '/mfa/totp/setup',
      label ? { label } : {},
    );
  },

  /** POST /mfa/totp/verify — activate the pending TOTP factor. */
  verifyTotp(code: string) {
    return apiClient.post<TotpVerifyResult>('/mfa/totp/verify', { code });
  },

  /** POST /mfa/totp/disable — requires current password + a fresh code. */
  disableTotp(password: string, code: string) {
    return apiClient.post<{ disabled: true }>('/mfa/totp/disable', {
      password,
      code,
    });
  },

  // Backup codes ----------------------------------------------------------

  /** POST /mfa/backup-codes/generate — (re)issue a batch of single-use codes. */
  generateBackupCodes() {
    return apiClient.post<BackupCodesResult>('/mfa/backup-codes/generate', {});
  },

  // WebAuthn --------------------------------------------------------------

  /** POST /mfa/webauthn/registration-options */
  webauthnRegistrationOptions(label?: string) {
    return apiClient.post<RegistrationOptionsJSON>(
      '/mfa/webauthn/registration-options',
      label ? { label } : {},
    );
  },

  /** POST /mfa/webauthn/registration-finish */
  webauthnRegistrationFinish(response: RegistrationResponseJSON, label?: string) {
    return apiClient.post<{ credentialId: string }>(
      '/mfa/webauthn/registration-finish',
      label ? { response, label } : { response },
    );
  },

  /** POST /mfa/webauthn/authentication-options (authenticated step-up). */
  webauthnAuthenticationOptions() {
    return apiClient.post<AuthenticationOptionsJSON>(
      '/mfa/webauthn/authentication-options',
      {},
    );
  },

  // Login challenge (public; authorised by mfaToken) ----------------------

  /**
   * POST /auth/mfa/challenge — complete the second factor with a TOTP or
   * backup code. The API sets HttpOnly auth cookies on the response;
   * nothing to persist client-side.
   */
  async completeChallengeWithCode(
    mfaToken: string,
    code: string,
  ): Promise<LoginTokens> {
    return apiClient.post<LoginTokens>(
      '/auth/mfa/challenge',
      { mfaToken, code },
      { public: true },
    );
  },

  /**
   * POST /auth/mfa/challenge — complete the second factor with a WebAuthn
   * assertion.
   */
  async completeChallengeWithWebAuthn(
    mfaToken: string,
    response: AuthenticationResponseJSON,
  ): Promise<LoginTokens> {
    return apiClient.post<LoginTokens>(
      '/auth/mfa/challenge',
      { mfaToken, webauthn: { response } },
      { public: true },
    );
  },
};
