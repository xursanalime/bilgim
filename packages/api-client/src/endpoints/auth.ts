/**
 * Typed wrappers for `POST /auth/*` routes.
 *
 * Every method is a thin `apiClient.{get,post}` call so consumers get
 * full TypeScript types for inputs and responses without a generated
 * OpenAPI surface. When the OpenAPI generator (Phase 9) lands these
 * shapes will be replaced with auto-generated ones — keep the public
 * surface stable so call sites don't move.
 *
 * Backend reference: `apps/api/src/modules/auth/auth.controller.ts`.
 */

import type { ApiClient } from '../client';
import { StorageKeys } from '../storage';
import type { AuthTokens, AuthUser } from '../types';

// ── Request / Response shapes ───────────────────────────────────

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER';
}

export interface RegisterResponse {
  userId: string;
  message: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse extends AuthTokens {
  user: AuthUser;
}

export interface MfaChallengeResponse {
  requiresMfa: true;
  mfaToken: string;
  expiresIn: number;
  methods: Array<'totp' | 'webauthn' | 'backup'>;
}

export type LoginOrMfaResponse = LoginResponse | MfaChallengeResponse;

export function isMfaChallenge(
  resp: LoginOrMfaResponse,
): resp is MfaChallengeResponse {
  return (resp as MfaChallengeResponse).requiresMfa === true;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirmRequest {
  token: string;
  newPassword: string;
}

export interface MessageResponse {
  message: string;
}

// ── Endpoint group ──────────────────────────────────────────────

export interface AuthEndpoints {
  /** `POST /auth/register` — public. Backend mails a verification link. */
  register(payload: RegisterRequest): Promise<RegisterResponse>;
  /**
   * `POST /auth/login` — public. Persists the returned tokens + user
   * into the configured storage adapter on success. Returns either
   * a token pair or an MFA challenge — call `isMfaChallenge` to
   * discriminate.
   */
  login(payload: LoginRequest): Promise<LoginOrMfaResponse>;
  /** `POST /auth/verify-email` — public. */
  verifyEmail(payload: VerifyEmailRequest): Promise<MessageResponse>;
  /** `POST /auth/resend-verification` — public. */
  resendVerification(
    payload: ResendVerificationRequest,
  ): Promise<MessageResponse>;
  /** `POST /auth/password-reset/request` — public. */
  passwordResetRequest(
    payload: PasswordResetRequest,
  ): Promise<MessageResponse>;
  /** `POST /auth/password-reset/confirm` — public. */
  passwordResetConfirm(
    payload: PasswordResetConfirmRequest,
  ): Promise<MessageResponse>;
  /**
   * `POST /auth/refresh` — exchange a refresh token for a new pair.
   * The transport already refreshes on 401 transparently; this helper
   * exists for flows that want to force a refresh up-front (e.g.
   * background sync). Persists the new pair on success.
   */
  refresh(refreshToken: string): Promise<AuthTokens>;
  /**
   * `POST /auth/logout` — revoke the current session server-side and
   * clear local tokens.
   */
  logout(): Promise<void>;
}

export function createAuthEndpoints(client: ApiClient): AuthEndpoints {
  return {
    register(payload) {
      return client.post<RegisterResponse>('/auth/register', payload, {
        public: true,
      });
    },

    async login(payload) {
      const result = await client.post<LoginOrMfaResponse>(
        '/auth/login',
        payload,
        { public: true },
      );
      if (!isMfaChallenge(result)) {
        await client.setTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        });
        await client
          .getStorage()
          .set(StorageKeys.USER, JSON.stringify(result.user));
      }
      return result;
    },

    verifyEmail(payload) {
      return client.post<MessageResponse>('/auth/verify-email', payload, {
        public: true,
      });
    },

    resendVerification(payload) {
      return client.post<MessageResponse>(
        '/auth/resend-verification',
        payload,
        { public: true },
      );
    },

    passwordResetRequest(payload) {
      return client.post<MessageResponse>(
        '/auth/password-reset/request',
        payload,
        { public: true },
      );
    },

    passwordResetConfirm(payload) {
      return client.post<MessageResponse>(
        '/auth/password-reset/confirm',
        payload,
        { public: true },
      );
    },

    async refresh(refreshToken) {
      const tokens = await client.post<AuthTokens>(
        '/auth/refresh',
        { refreshToken },
        { public: true, skipRefresh: true },
      );
      await client.setTokens(tokens);
      return tokens;
    },

    async logout() {
      // Best-effort — server-side revocation should not block client
      // logout. We always clear local tokens.
      try {
        await client.post<void>('/auth/logout', undefined);
      } catch {
        /* ignore — clear local state regardless */
      }
      await client.clearTokens();
    },
  };
}
