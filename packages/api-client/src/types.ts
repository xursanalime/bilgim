/**
 * Cross-cutting types used by the API client. These are intentionally
 * narrow, mirroring only the request / response shapes the typed
 * endpoint wrappers in `./endpoints/*` expose. Anything more granular
 * (e.g. full DTO shapes) belongs in `@edubridge/shared-types`.
 *
 * We deliberately keep the role union local rather than importing the
 * `UserRole` enum from `@edubridge/shared-types` so this package has
 * zero workspace runtime deps. The two definitions are kept in sync
 * by code review (and validated structurally where they meet).
 */

export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

/**
 * Token pair returned by `/auth/login` and `/auth/refresh`.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Compact user blob the backend embeds in the login response. Use
 * `@edubridge/shared-types` `UserRole` so client and server stay
 * aligned on the role enum.
 */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

/**
 * Cursor / offset paginated list — matches the `meta` block emitted by
 * `apps/api/src/common/pipes/pagination.schema.ts`.
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Cursor (keyset) page — used by `>10k` row endpoints like
 * teacher / course discovery.
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Per-request options. The transport accepts any `RequestInit` field
 * plus the EduBridge-specific extras below. `body` is `unknown` so
 * callers can pass arbitrary JSON-serialisable payloads without
 * stringifying upfront.
 */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable body. The client calls `JSON.stringify` for you. */
  body?: unknown;
  /** Query string params. `undefined` values are dropped. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip the `Authorization` header (e.g. /auth/login, /auth/refresh). */
  public?: boolean;
  /** Adds the `Idempotency-Key` header — required for some POSTs. */
  idempotencyKey?: string;
  /** Allow callers to opt out of the auto-refresh-on-401 retry. */
  skipRefresh?: boolean;
  /** Override the per-request timeout (ms). 0 / undefined = no timeout. */
  timeoutMs?: number;
}
