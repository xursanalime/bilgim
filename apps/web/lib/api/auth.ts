/**
 * Auth API integration — thin wrapper around `apiClient` for the
 * NestJS `/auth/*` endpoints.
 *
 * Every helper returns a discriminated result of the form
 *   { ok: true; data: T } | { ok: false; error: { code; message } }
 * so that form components don't have to wrap each call in try/catch.
 *
 * Endpoints are public (no Authorization header) — `apiClient` skips the
 * auth header when `public: true` is passed.
 */

import { apiClient, ApiClientError } from '../api-client';

// ── Result type ─────────────────────────────────────────────────────────

export interface AuthError {
  code: string;
  message: string;
}

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };

// ── Backend response types ─────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
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

export interface LoginUser {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  fullName: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: LoginUser;
}

export interface MessageResponse {
  message: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function toAuthError(err: unknown): AuthError {
  if (err instanceof ApiClientError) {
    // Backend envelope: { error: { code, message, details, traceId } }
    const details = err.details as
      | { error?: { code?: string; message?: string }; code?: string; message?: string }
      | undefined;
    const inner = details?.error;
    return {
      code: inner?.code ?? details?.code ?? `HTTP_${err.statusCode}`,
      message: inner?.message ?? details?.message ?? err.message,
    };
  }
  if (err instanceof Error) {
    return { code: 'NETWORK_ERROR', message: err.message };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: 'Kutilmagan xato yuz berdi',
  };
}

async function call<T>(fn: () => Promise<T>): Promise<AuthResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toAuthError(err) };
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function register(
  dto: RegisterRequest,
): Promise<AuthResult<RegisterResponse>> {
  return call(() =>
    apiClient.post<RegisterResponse>('/auth/register', dto, { public: true }),
  );
}

export function verifyEmail(
  token: string,
): Promise<AuthResult<MessageResponse>> {
  return call(() =>
    apiClient.post<MessageResponse>(
      '/auth/verify-email',
      { token },
      { public: true },
    ),
  );
}

export function login(
  email: string,
  password: string,
): Promise<AuthResult<LoginResponse>> {
  return call(() =>
    apiClient.post<LoginResponse>(
      '/auth/login',
      { email, password },
      { public: true },
    ),
  );
}

export function requestPasswordReset(
  email: string,
): Promise<AuthResult<MessageResponse>> {
  return call(() =>
    apiClient.post<MessageResponse>(
      '/auth/password-reset/request',
      { email },
      { public: true },
    ),
  );
}

export function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<AuthResult<MessageResponse>> {
  return call(() =>
    apiClient.post<MessageResponse>(
      '/auth/password-reset/confirm',
      { token, newPassword },
      { public: true },
    ),
  );
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult<MessageResponse>> {
  return call(() =>
    apiClient.post<MessageResponse>('/auth/change-password', {
      currentPassword,
      newPassword,
    }),
  );
}
