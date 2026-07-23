/**
 * Discovery API client — wraps the NestJS `/discovery/*` public endpoints
 * for the public teacher catalog (Task 25.5, Req 14.1–14.7).
 *
 * Endpoints:
 *   GET /discovery/teachers              → cursor-paginated teacher list
 *   GET /discovery/courses               → cursor-paginated course list
 *   GET /discovery/courses/:id           → public course detail
 *
 * Type shapes mirror the API contract in
 * `apps/api/src/modules/discovery/discovery.service.ts`.
 *
 * These endpoints are unauthenticated (`@Public()` on the API). The
 * helpers below opt out of the access token via `public: true` so we
 * never trigger a token refresh / login redirect on a marketing page.
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface DiscoverySpecialtySummary {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
}

export interface DiscoveryTeacherSummary {
  id: string;
  slug: string | null;
  fullName: string | null;
  headline: string | null;
  avatarUrl: string | null;
  themeColor: string | null;
  rating: number | null;
  studentsCount: number;
  courseCount: number;
  specialty: DiscoverySpecialtySummary | null;
}

export interface DiscoveryCourseSummary {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  coverUrl: string | null;
  fromPriceUzs: number | null;
  teacher: {
    userId: string;
    publicSlug: string | null;
    fullName: string | null;
    headline: string | null;
    avatarUrl: string | null;
    rating: number | null;
    studentsCount: number;
    specialty: DiscoverySpecialtySummary | null;
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DiscoveryGroupSummary {
  id: string;
  name: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

// ──────────────────────────────────────────────────────────────────────
// Query params (mirror the Zod DTOs in
// `apps/api/src/modules/discovery/dto/list-teachers.dto.ts` and
// `list-courses.dto.ts`).
// ──────────────────────────────────────────────────────────────────────

export interface ListTeachersParams {
  q?: string;
  specialtyId?: string;
  cursor?: string;
  pageSize?: number;
}

export interface ListCoursesParams {
  q?: string;
  specialtyId?: string;
  level?: string;
  priceMin?: number;
  priceMax?: number;
  cursor?: string;
  pageSize?: number;
}

// ──────────────────────────────────────────────────────────────────────
// API methods
// ──────────────────────────────────────────────────────────────────────

export const discoveryApi = {
  /** Public teacher catalog — no auth required. */
  listTeachers(params: ListTeachersParams = {}) {
    return apiClient.get<CursorPage<DiscoveryTeacherSummary>>(
      '/discovery/teachers',
      { params: toQueryRecord(params), public: true },
    );
  },

  /** Public course catalog — no auth required. */
  listCourses(params: ListCoursesParams = {}) {
    return apiClient.get<CursorPage<DiscoveryCourseSummary>>(
      '/discovery/courses',
      { params: toQueryRecord(params), public: true },
    );
  },

  /** Public course detail by id. */
  getCourse(id: string) {
    return apiClient.get<DiscoveryCourseSummary>(
      `/discovery/courses/${id}`,
      { public: true },
    );
  },

  /** Public joinable groups for a course. */
  getCourseGroups(id: string) {
    return apiClient.get<DiscoveryGroupSummary[]>(
      `/discovery/courses/${id}/groups`,
      { public: true },
    );
  },

  /** Public system setting by key. */
  getSetting<T = any>(key: string) {
    return apiClient.get<T>(
      `/discovery/settings/${key}`,
      { public: true },
    );
  },
};

/**
 * Flatten a typed query DTO into the loose record shape `apiClient`
 * accepts. We strip `undefined` keys here so callers don't have to.
 */
function toQueryRecord(
  input: Partial<ListTeachersParams & ListCoursesParams>,
): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') {
      out[key] = value as string | number | boolean;
    }
  }
  return out;
}
