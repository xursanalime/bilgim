/**
 * Auth API typed wrappers — thin facade over `sdk.auth`.
 *
 * Returns a `{ ok, data | error }` envelope so screens can do a single
 * `if (result.ok)` check without remembering to catch ApiClientError.
 * The SDK already maps non-2xx responses to `ApiClientError`, so we
 * just need to translate that into the result shape.
 */

import { ApiClientError } from '@bilgim/api-client';

import { sdk } from '../api-client';
import { decodeToken, getAccessToken, getCachedUser } from '../auth';

// ── Shared role / user types ───────────────────────────────────────────

export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
}

// ── Result envelope ────────────────────────────────────────────────────

export interface AuthError {
  code: string;
  message: string;
}

export type AuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AuthError };

function toAuthError(err: unknown): AuthError {
  if (err instanceof ApiClientError) {
    return {
      code: err.code ?? `HTTP_${err.statusCode}`,
      message: err.message,
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

// ── Backend request / response shapes ──────────────────────────────────

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

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
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

export interface MessageResponse {
  message: string;
}

// ── Endpoints ──────────────────────────────────────────────────────────

/**
 * `POST /auth/register` — create a new account. Backend emails a
 * verification link before the account becomes active.
 */
export function register(
  dto: RegisterRequest,
): Promise<AuthResult<RegisterResponse>> {
  return call(() => sdk.auth.register(dto));
}

/**
 * `POST /auth/login` — exchange email + password for an access /
 * refresh token pair. May also return an MFA challenge — call
 * `isMfaChallenge(data)` to discriminate. The SDK persists tokens +
 * cached user blob on success.
 */
export function login(
  dto: LoginRequest,
): Promise<AuthResult<LoginOrMfaResponse>> {
  return call(() => sdk.auth.login(dto) as Promise<LoginOrMfaResponse>);
}

/**
 * `me()` — best-effort current user resolution.
 *
 *   1. Decode the access token from secure storage (returns role + sub).
 *   2. Hydrate `fullName` from the cached login response when present.
 *
 * Returns `null` when the user is signed out or the token is malformed.
 * The backend currently has no `GET /auth/me` route; once one lands
 * (Phase 22.2) this helper can call it directly without changing call
 * sites.
 */
export async function me(): Promise<AuthUser | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const decoded = decodeToken(token);
  if (!decoded) return null;

  let fullName = '';
  try {
    const cached = await getCachedUser();
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<AuthUser>;
      if (typeof parsed.fullName === 'string') fullName = parsed.fullName;
    }
  } catch {
    /* ignore — fullName remains empty */
  }

  return {
    id: decoded.sub,
    email: decoded.email,
    role: decoded.role,
    fullName,
  };
}

/**
 * `POST /auth/verify-email` — public route. Used by the
 * `app/(auth)/verify-email` deep-link target after the user opens the
 * email link on the phone.
 */
export function verifyEmail(
  token: string,
): Promise<AuthResult<MessageResponse>> {
  return call(() => sdk.auth.verifyEmail({ token }));
}

/**
 * `POST /auth/refresh` — rotate the refresh token.
 * The SDK refreshes transparently on 401, so callers rarely need this.
 */
export function refresh(
  refreshToken: string,
): Promise<AuthResult<{ accessToken: string; refreshToken: string }>> {
  return call(() => sdk.auth.refresh(refreshToken));
}
