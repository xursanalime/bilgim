/**
 * Server-side wrapper for the public Discovery endpoints.
 *
 * These pages render unauthenticated, so we cannot reuse `serverApi`
 * (which requires a cookie-bound access token). We talk to the NestJS
 * API directly with a short cache and surface the results via the
 * shared discovery types.
 *
 * Used by:
 *   - `/[locale]/discover`               → public teacher catalog
 *   - `/[locale]/teachers/[publicSlug]`  → individual teacher profile
 */

import type {
  CursorPage,
  DiscoveryCourseSummary,
  DiscoveryTeacherDetail,
  DiscoveryTeacherSummary,
  ListCoursesParams,
  ListTeachersParams,
} from './api/discovery';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const API_PREFIX = '/api/v1';

/** Cache discovery responses for a short window — the API caches in
 * Redis for 30s already; mirror that here so we don't hammer the API
 * during marketing traffic spikes. */
const REVALIDATE_SECONDS = 30;

export class ServerDiscoveryError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerDiscoveryError';
  }
}

function buildUrl(
  path: string,
  params?: Record<
    string,
    string | number | boolean | readonly string[] | undefined
  >,
): string {
  const url = new URL(`${API_PREFIX}${path}`, API_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      if (Array.isArray(value)) {
        // Repeated param (`?cefrLevel=A1&cefrLevel=B2`) — the NestJS DTO
        // normalises this back into a `CefrLevel[]` (Req 15.2).
        for (const entry of value) {
          if (entry !== undefined && entry !== '') {
            url.searchParams.append(key, String(entry));
          }
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function publicGet<T>(
  path: string,
  params?: Record<
    string,
    string | number | boolean | readonly string[] | undefined
  >,
): Promise<T> {
  const url = buildUrl(path, params);
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    next: { revalidate: REVALIDATE_SECONDS },
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
    throw new ServerDiscoveryError(response.status, message);
  }
  return (await response.json()) as T;
}

export const serverDiscovery = {
  listTeachers(params: ListTeachersParams = {}) {
    return publicGet<CursorPage<DiscoveryTeacherSummary>>(
      '/discovery/teachers',
      toQueryRecord(params),
    );
  },
  listCourses(params: ListCoursesParams = {}) {
    return publicGet<CursorPage<DiscoveryCourseSummary>>(
      '/discovery/courses',
      toQueryRecord(params),
    );
  },
  getCourse(id: string) {
    return publicGet<DiscoveryCourseSummary>(`/discovery/courses/${id}`);
  },
  getTeacherBySlug(slug: string) {
    return publicGet<DiscoveryTeacherDetail>(
      `/discovery/teachers/${encodeURIComponent(slug)}`,
    );
  },
};

/**
 * Strip `undefined` and empty-string entries so the URL builder doesn't
 * encode them. Arrays (e.g. `cefrLevel`) are passed through untouched so
 * {@link buildUrl} can emit them as repeated params.
 */
function toQueryRecord(
  input: Partial<ListTeachersParams & ListCoursesParams>,
): Record<string, string | number | boolean | readonly string[] | undefined> {
  const out: Record<
    string,
    string | number | boolean | readonly string[] | undefined
  > = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value as readonly string[];
    } else {
      out[key] = value as string | number | boolean;
    }
  }
  return out;
}
