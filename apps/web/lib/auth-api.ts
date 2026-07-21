/**
 * Auth API client — wraps the NestJS /auth endpoints.
 * Uses the existing apiClient from lib/api-client.ts.
 */

import { apiClient } from './api-client';
import { setTokens } from './auth';

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
  accessToken: string;
  refreshToken: string;
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

  /** POST /auth/login — also stores tokens on success */
  async login(payload: LoginPayload): Promise<LoginResponse> {
    const result = await apiClient.post<LoginResponse>('/auth/login', payload, {
      public: true,
    });
    setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
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
