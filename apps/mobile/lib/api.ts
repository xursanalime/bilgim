/**
 * Public API surface for the mobile app.
 *
 * This module is the canonical entry point referenced by task 22.1: it
 * re-exports the typed SDK (a thin wrapper over the shared
 * `@edubridge/api-client` package) along with the auth-flow helpers
 * and error envelope used across screens.
 *
 * All transport / refresh / token storage logic lives in
 * `@edubridge/api-client`. This file is the single import path so
 * callers can do:
 *
 *   import { apiClient, sdk } from '../../lib/api';
 *   const tokens = await sdk.auth.login({ email, password });
 *   const lessons = await sdk.lessons.listForGroup(groupId);
 */

export {
  ApiClientError,
  isJwtExpired,
  type ApiErrorEnvelope,
  type AuthTokens,
  type AuthUser,
  type CursorPage,
  type PaginatedResponse,
  type UserRole,
} from '@edubridge/api-client';

export { apiClient, sdk } from './api-client';

export {
  // Token storage constants
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  // JWT helpers
  decodeToken,
  isTokenExpired,
  type DecodedToken,
} from './auth';

export {
  // Typed auth endpoints (mirrors apps/web/lib/auth-api.ts)
  login,
  register,
  refresh,
  verifyEmail,
  me,
  isMfaChallenge,
  type AuthError,
  type AuthResult,
  type LoginRequest,
  type LoginResponse,
  type LoginOrMfaResponse,
  type MfaChallengeResponse,
  type RegisterRequest,
  type RegisterResponse,
  type MessageResponse,
} from './api/auth';

// Default export keeps ergonomic `import api from '../../lib/api'` usage.
import { apiClient } from './api-client';
export default apiClient;
