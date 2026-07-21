/**
 * Typed API client for EduBridge NestJS backend.
 * Handles authentication headers, token refresh, and error responses.
 */

import {
  getAccessToken,
  refreshAccessToken,
  clearTokens,
} from './auth';

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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = getAccessToken();
  // Note: we intentionally do NOT proactively refresh here. The refresh
  // token is rotated server-side on every use, so refreshing from multiple
  // places (middleware + client) with the same token trips the backend's
  // token-family reuse detection and nukes the session. Instead we send
  // whatever access token we have and let the 401 handler refresh-and-retry
  // exactly once when the server actually rejects it.
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
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

  // Add auth headers unless explicitly public
  if (!isPublic) {
    const authHeaders = await getAuthHeaders();
    Object.assign(headers, authHeaders);
  }

  // Add idempotency key for mutating requests
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const url = buildUrl(path, params);

  const response = await fetch(url, {
    ...fetchOptions,
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  // Handle error responses (parse envelope first so we can inspect the code).
  if (!response.ok) {
    // 401 on an authenticated request: the access token was rejected. Try a
    // single refresh-and-retry before giving up, so a transparently-expired
    // token doesn't surface as an error or force a logout.
    if (response.status === 401 && !isPublic && !isRetry) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return request<T>(method, path, options, true);
      }
      // Refresh failed → session is truly dead. Clear and bounce to login.
      clearTokens();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
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
