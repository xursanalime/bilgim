/**
 * Discovery API client — wraps the NestJS `/discovery/*` public endpoints
 * for the public English-instructor catalog (Req 15.2, 15.3, 15.5).
 *
 * Endpoints:
 *   GET /discovery/teachers              → cursor-paginated teacher list
 *   GET /discovery/courses               → cursor-paginated course list
 *   GET /discovery/courses/:id           → public course detail
 *   GET /discovery/courses/:id/groups    → joinable groups (enroll flow)
 *
 * Type shapes mirror the API contract in
 * `apps/api/src/modules/discovery/discovery.service.ts`.
 *
 * English-only refocus (english-only-platform-refocus task 7.2): the
 * generic `specialtyId` facet is retired. Discovery now filters by
 * **CEFR level** (A1–C2) and **Exam_Track** slug (e.g. `ielts`). Course
 * summaries carry `cefrLevel`/`examTrack`; teacher summaries carry
 * `taughtCefrLevels`/`examTrackFocus`.
 *
 * These endpoints are unauthenticated (`@Public()` on the API). The
 * helpers below opt out of the access token via `public: true` so we
 * never trigger a token refresh / login redirect on a marketing page.
 */

import { apiClient } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// CEFR levels — the English proficiency facet (Req 15.2).
// Mirrors the Prisma `CefrLevel` enum and the API's `CEFR_LEVELS`.
// ──────────────────────────────────────────────────────────────────────

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Narrow an arbitrary string to a `CefrLevel`, or `null` when invalid. */
export function parseCefrLevel(value: string): CefrLevel | null {
  return (CEFR_LEVELS as readonly string[]).includes(value)
    ? (value as CefrLevel)
    : null;
}

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

/**
 * @deprecated English-only refocus retired the specialty facet. The field
 * is retained on summaries for backwards compatibility while the API still
 * emits it, but discovery filtering no longer uses it.
 */
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
  rating: number | null;
  studentsCount: number;
  courseCount: number;
  /** CEFR levels this instructor teaches (Req 15.2). */
  taughtCefrLevels: string[];
  /** Exam-track slugs this instructor focuses on, e.g. `["ielts"]` (Req 15.2). */
  examTrackFocus: string[];
  /** @deprecated retained for back-compat; see {@link DiscoverySpecialtySummary}. */
  specialty: DiscoverySpecialtySummary | null;
}

export interface DiscoveryCourseSummary {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  /** CEFR level of the course (A1–C2), or `null` (Req 15.2). */
  cefrLevel: string | null;
  /** Exam-track slug, e.g. `ielts`, or `null` (Req 15.2). */
  examTrack: string | null;
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
    /** @deprecated retained for back-compat. */
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
//
// `cefrLevel` is sent as a repeated query param (`?cefrLevel=A1&cefrLevel=B2`)
// which the API normalises into an array. `examTrack` is a single slug.
// ──────────────────────────────────────────────────────────────────────

export interface ListTeachersParams {
  q?: string;
  /** One or more CEFR levels to match against `taughtCefrLevels` (Req 15.2). */
  cefrLevel?: CefrLevel[];
  /** Exam-track slug to match against `examTrackFocus` (Req 15.2). */
  examTrack?: string;
  cursor?: string;
  pageSize?: number;
}

export interface ListCoursesParams {
  q?: string;
  /** One or more CEFR levels to match against `Course.cefrLevel` (Req 15.2). */
  cefrLevel?: CefrLevel[];
  /** Exam-track slug to match against `Course.examTrack` (Req 15.2). */
  examTrack?: string;
  /** Legacy free-text level string (retained, optional). */
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
      buildDiscoveryPath('/discovery/teachers', params),
      { public: true },
    );
  },

  /** Public course catalog — no auth required. */
  listCourses(params: ListCoursesParams = {}) {
    return apiClient.get<CursorPage<DiscoveryCourseSummary>>(
      buildDiscoveryPath('/discovery/courses', params),
      { public: true },
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
  getSetting<T = unknown>(key: string) {
    return apiClient.get<T>(
      `/discovery/settings/${key}`,
      { public: true },
    );
  },
};

/**
 * Append the discovery filter params to a path as a query string. Handles
 * the `cefrLevel` array by emitting a repeated param so the NestJS DTO
 * parses it back into a `CefrLevel[]`. `undefined`/empty values are
 * skipped. We build the query string here (rather than via `apiClient`'s
 * `params`) because the shared client only supports scalar params.
 */
function buildDiscoveryPath(
  base: string,
  params: Partial<ListTeachersParams & ListCoursesParams>,
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null && String(entry) !== '') {
          sp.append(key, String(entry));
        }
      }
    } else {
      sp.append(key, String(value));
    }
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
