/**
 * Typed API client for Bilgim NestJS backend.
 * Handles authentication headers, token refresh, and error responses.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const API_PREFIX = '/api/v1';

// --- Types ---

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export class ApiClientError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

// --- Request Options ---

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip authentication header */
  public?: boolean;
  /** Custom idempotency key for mutating requests */
  idempotencyKey?: string;
}

// --- Helper Functions ---

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE_URL);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

// The access/refresh tokens live in HttpOnly cookies now — the browser
// attaches them automatically on same-site requests (`credentials:
// 'include'` below). Nothing here reads or forwards a token value.

let refreshPromise: Promise<boolean> | null = null;

/**
 * Ask the API to rotate the refresh token. Deduplicates concurrent calls
 * so parallel 401s don't each trigger their own refresh (which would trip
 * the backend's token-family reuse detection).
 */
async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      return res.ok;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// --- Core Request Function ---

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const { body, params, idempotencyKey, public: isPublic, ...fetchOptions } =
    options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Add idempotency key for mutating requests
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const url = buildUrl(path, params);

  const response = await fetch(url, {
    ...fetchOptions,
    method,
    headers,
    // HttpOnly access/refresh cookies ride along automatically; public
    // (unauthenticated) requests still send credentials harmlessly.
    credentials: 'include',
    body: body ? JSON.stringify(body) : null,
  });

  // Handle error responses (parse envelope first so we can inspect the code).
  if (!response.ok) {
    // 401 on an authenticated request: the access token was rejected. Try a
    // single refresh-and-retry before giving up, so a transparently-expired
    // token doesn't surface as an error or force a logout.
    if (response.status === 401 && !isPublic && !isRetry) {
      const refreshed = await refreshSession();
      if (refreshed) {
        return request<T>(method, path, options, true);
      }
      // Refresh failed → session is truly dead. Bounce to login, preserving
      // the locale prefix and the current path as callbackUrl so the user
      // lands back where they were after re-authenticating. A `reason` flag
      // lets the login screen show a clear "session expired" message
      // instead of a blank/broken state.
      if (typeof window !== 'undefined') {
        const { pathname, search } = window.location;
        const localeMatch = pathname.match(/^\/(uz|ru|en)(?:\/|$)/);
        const locale = localeMatch ? localeMatch[1] : '';
        const loginPath = locale ? `/${locale}/login` : '/login';
        const callbackUrl = encodeURIComponent(`${pathname}${search}`);
        const loginUrl = `${loginPath}?reason=session_expired&callbackUrl=${callbackUrl}`;
        // Avoid a redirect loop if we're already on the login screen.
        if (!pathname.endsWith('/login')) {
          window.location.href = loginUrl;
        }
      }
    }

    const errorBody = await response.json().catch(() => ({}));
    // Backend (`AllExceptionsFilter`) returns { error: { code, message, details, traceId } }
    // — unwrap the envelope so callers can read `code`/`message` from a flat shape.
    const envelope =
      errorBody && typeof errorBody === 'object' && 'error' in errorBody
        ? (errorBody as { error: Record<string, unknown> }).error
        : (errorBody as Record<string, unknown>);
    const message =
      (typeof envelope?.message === 'string' && envelope.message) ||
      `Request failed with status ${response.status}`;

    throw new ApiClientError(response.status, message, envelope);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// --- Public API ---

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, options);
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, { ...options, body });
  },

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, { ...options, body });
  },

  patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return request<T>('PATCH', path, { ...options, body });
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, options);
  },
};

export default apiClient;
