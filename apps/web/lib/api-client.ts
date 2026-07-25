/**
 * Typed API client for Bilgim NestJS backend.
 * Handles authentication headers, token refresh, and error responses.
 */

import { clearTokens } from './auth';

// All authenticated browser→API traffic goes through the same-origin BFF
// proxy (`app/api/proxy/[...path]`), which reads the httpOnly access-token
// cookie server-side and attaches the Bearer header. The token is never in
// JS here, so there is nothing for an XSS payload to read. Requests are
// same-origin, so the browser sends the session cookies automatically.
const PROXY_PREFIX = '/api/proxy/api/v1';

function originBase(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

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
  const url = new URL(`${PROXY_PREFIX}${path}`, originBase());

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

// --- Core Request Function ---

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, params, idempotencyKey, public: isPublic, ...fetchOptions } =
    options;

  // `isPublic` no longer changes the outgoing headers — the BFF proxy
  // attaches the Bearer from the httpOnly cookie when one exists and omits
  // it otherwise, so public endpoints simply arrive without auth. We keep
  // the flag only to drive the 401 handling below.
  void isPublic;

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
    // Same-origin request → send the httpOnly session cookies so the proxy
    // can authenticate on our behalf.
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : null,
  });

  // Handle error responses (parse envelope first so we can inspect the code).
  if (!response.ok) {
    // A 401 here is already post-refresh: the BFF proxy transparently tries
    // to rotate the token with the httpOnly refresh cookie and only returns
    // 401 when that fails too — i.e. the session is genuinely dead. Clear the
    // readable profile cookie and bounce to login.
    if (response.status === 401 && !isPublic) {
      void clearTokens();
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
