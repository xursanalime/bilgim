/**
 * Auth API client — wraps the NestJS /auth endpoints.
 * Uses the existing apiClient from lib/api-client.ts.
 */

import { apiClient, ApiClientError } from './api-client';

// ═══════════════════════════════════════════════════════════════
// Types (mirror the backend DTOs)
// ═══════════════════════════════════════════════════════════════

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  fullName: string;
  role: 'STUDENT' | 'TEACHER';
}

export interface RegisterResponse {
  userId: string;
  message: string;
  verificationRequired?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  // Tokens are NOT returned to the browser anymore — the BFF login endpoint
  // keeps them in httpOnly cookies. Only the non-secret profile comes back.
  user: {
    id: string;
    email: string;
    role: 'STUDENT' | 'TEACHER' | 'ADMIN';
    fullName: string;
  };
}

export interface VerifyEmailPayload {
  token: string;
}

export interface PasswordResetRequestPayload {
  email: string;
}

export interface PasswordResetConfirmPayload {
  token: string;
  newPassword: string;
}

export interface ResendVerificationPayload {
  email: string;
}

// ═══════════════════════════════════════════════════════════════
// API methods
// ═══════════════════════════════════════════════════════════════

export const authApi = {
  /** POST /auth/register */
  register(payload: RegisterPayload) {
    return apiClient.post<RegisterResponse>('/auth/register', payload, {
      public: true,
    });
  },

  /** POST /auth/verify-email */
  verifyEmail(payload: VerifyEmailPayload) {
    return apiClient.post<{ message: string }>('/auth/verify-email', payload, {
      public: true,
    });
  },

  /**
   * POST /auth/login — also stores tokens on success.
   * @param remember - "Eslab qolish" checkbox; false makes the httpOnly
   *   cookies session-scoped (cleared when the browser closes).
   */
  async login(payload: LoginPayload, remember = true): Promise<LoginResponse> {
    // Posts to the same-origin BFF login endpoint, which relays to the API
    // and stores the returned tokens in httpOnly cookies. Only `{ user }`
    // comes back — the tokens never enter this JS context.
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ ...payload, remember }),
    });
    const data = (await res.json().catch(() => ({}))) as
      | LoginResponse
      | { error?: { code?: string; message?: string } };

    if (!res.ok || !('user' in data) || !data.user) {
      const err = (data as { error?: { code?: string; message?: string } }).error;
      throw new ApiClientError(
        res.status,
        err?.message || 'Login failed',
        err ?? {},
      );
    }
    return data as LoginResponse;
  },

  /** POST /auth/password-reset/request */
  passwordResetRequest(payload: PasswordResetRequestPayload) {
    return apiClient.post<{ message: string }>(
      '/auth/password-reset/request',
      payload,
      { public: true },
    );
  },

  /** POST /auth/password-reset/confirm */
  passwordResetConfirm(payload: PasswordResetConfirmPayload) {
    return apiClient.post<{ message: string }>(
      '/auth/password-reset/confirm',
      payload,
      { public: true },
    );
  },

  /** POST /auth/resend-verification */
  resendVerification(payload: ResendVerificationPayload) {
    return apiClient.post<{ message: string }>(
      '/auth/resend-verification',
      payload,
      { public: true },
    );
  },
};
