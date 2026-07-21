/**
 * Server-side API client for Server Components.
 *
 * Forwards the access token from the cookie as a Bearer header. Used for
 * SSR data fetching where the browser-only `apiClient` cannot be reused.
 *
 * Note: this never refreshes the token. If the access token has expired,
 * the API returns 401 and the caller should treat it like any other
 * upstream error — the middleware will redirect the user to `/login` on
 * the next navigation.
 */

import { getServerAccessToken } from './server-auth';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const API_PREFIX = '/api/v1';

interface ServerFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  /** Forward the user's Bearer token. Defaults to true. */
  authenticated?: boolean;
}

export class ServerApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

function buildUrl(
  path: string,
  params?: ServerFetchOptions['params'],
): string {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function serverFetch<T>(
  method: string,
  path: string,
  options: ServerFetchOptions = {},
): Promise<T> {
  const {
    body,
    params,
    authenticated = true,
    headers: extraHeaders,
    ...rest
  } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string> | undefined),
  };

  if (authenticated) {
    const token = getServerAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(path, params), {
    ...rest,
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    // Server Components: opt out of caching for live data by default. Pages
    // can pass `next: { revalidate: ... }` to override.
    cache: rest.cache ?? 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const envelope =
      errorBody && typeof errorBody === 'object' && 'error' in errorBody
        ? (errorBody as { error: Record<string, unknown> }).error
        : (errorBody as Record<string, unknown>);
    const message =
      (typeof envelope?.message === 'string' && envelope.message) ||
      `Request failed with status ${response.status}`;
    throw new ServerApiError(response.status, message, envelope);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const serverApi = {
  get<T>(path: string, options?: ServerFetchOptions) {
    return serverFetch<T>('GET', path, options);
  },
  post<T>(path: string, body?: unknown, options?: ServerFetchOptions) {
    return serverFetch<T>('POST', path, { ...options, body });
  },
  patch<T>(path: string, body?: unknown, options?: ServerFetchOptions) {
    return serverFetch<T>('PATCH', path, { ...options, body });
  },
  put<T>(path: string, body?: unknown, options?: ServerFetchOptions) {
    return serverFetch<T>('PUT', path, { ...options, body });
  },
  delete<T>(path: string, options?: ServerFetchOptions) {
    return serverFetch<T>('DELETE', path, options);
  },
};
