import { Injectable, NotFoundException } from '@nestjs/common';

import { CacheService } from '../../infra/cache/cache.service';
import {
  DiscoveryCourseRow,
  DiscoveryRepository,
  DiscoveryTeacherRow,
} from './repositories/discovery.repository';

/** Default page size when the caller omits `pageSize`. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * Discovery list responses are cached 5 minutes — shifted up from the
 * earlier 30 s value as part of Task 24.2. The hot list endpoints
 * (/discovery/courses, /discovery/teachers) are read-mostly and a
 * marketing landing page can easily produce thousands of requests per
 * minute. Five minutes is short enough that newly-published courses
 * appear quickly while keeping Postgres load predictable.
 */
const LIST_CACHE_TTL_SECONDS = 300;

export interface DiscoveryListInput {
  q?: string | undefined;
  specialtyId?: string | undefined;
  level?: string | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  cursor?: string | undefined;
  pageSize?: number | undefined;
}

export interface DiscoveryTeacherListInput {
  q?: string | undefined;
  specialtyId?: string | undefined;
  cursor?: string | undefined;
  pageSize?: number | undefined;
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

export interface DiscoverySpecialtySummary {
  id: string;
  slug: string;
  nameUz: string;
  nameRu: string;
  nameEn: string;
}

export interface DiscoveryGroupSummary {
  id: string;
  name: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface CursorPage<T> {
  items: T[];
  /** Cursor for the *next* page; `null` when there are no more rows. */
  nextCursor: string | null;
}

/**
 * DiscoveryService — public, read-only search of teachers and courses
 * (Req 14.1 — 14.7).
 *
 * Responsibilities:
 *   - Apply the page-size default and forward filters to the repository.
 *   - Strip the `+1` overflow row used to detect "is there another page?".
 *   - Map row types → DTO-friendly summaries (Decimal → number, drop fields
 *     the public API does not expose).
 *   - Cache list responses in Redis 30 s by `(scope, query)` to absorb the
 *     spike from a marketing landing page (Req 14.7). Single-resource lookups
 *     are not cached — the row is small and Postgres handles it via PK.
 *
 * The service does *not* short-circuit visibility — that is a repository
 * concern (`isPublished=true`, `isDiscoverable=true`, `publicSlug != null`).
 * Keeping the rule in one place avoids drift between list and detail
 * endpoints.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly cache: CacheService,
  ) {}

  // ==================================================================
  // Courses
  // ==================================================================

  async listCourses(
    input: DiscoveryListInput,
  ): Promise<CursorPage<DiscoveryCourseSummary>> {
    const pageSize = this.normalizePageSize(input.pageSize);
    const cacheKey = this.buildCacheKey('courses', { ...input, pageSize });

    return this.cache.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
      const rows = await this.repository.searchCourses({
        ...(input.q !== undefined && { q: input.q }),
        ...(input.specialtyId !== undefined && {
          specialtyId: input.specialtyId,
        }),
        ...(input.level !== undefined && { level: input.level }),
        ...(input.priceMin !== undefined && { priceMin: input.priceMin }),
        ...(input.priceMax !== undefined && { priceMax: input.priceMax }),
        ...(input.cursor !== undefined && { cursor: input.cursor }),
        pageSize,
      });

      return this.toCursorPage(rows, pageSize, (r) => r.id, toCourseSummary);
    });
  }

  async getCourseById(id: string): Promise<DiscoveryCourseSummary> {
    const row = await this.repository.findPublicCourseById(id);
    if (!row) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${id} not found`,
      });
    }
    return toCourseSummary(row);
  }

  /**
   * Public list of joinable groups for a course (used by the course detail
   * page so a student can pick a group and submit a join request).
   */
  async listCourseGroups(
    courseId: string,
  ): Promise<DiscoveryGroupSummary[]> {
    // Ensure the course itself is public; 404 otherwise so we don't leak
    // the existence of hidden courses.
    await this.getCourseById(courseId);
    const groups = await this.repository.listPublicGroupsForCourse(courseId);
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      priceUzs: g.priceUzs,
      capacity: g.capacity,
      startsOn: g.startsOn ? g.startsOn.toISOString() : null,
      endsOn: g.endsOn ? g.endsOn.toISOString() : null,
    }));
  }

  // ==================================================================
  // Teachers
  // ==================================================================

  async listTeachers(
    input: DiscoveryTeacherListInput,
  ): Promise<CursorPage<DiscoveryTeacherSummary>> {
    const pageSize = this.normalizePageSize(input.pageSize);
    const cacheKey = this.buildCacheKey('teachers', { ...input, pageSize });

    return this.cache.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, async () => {
      const rows = await this.repository.searchTeachers({
        ...(input.q !== undefined && { q: input.q }),
        ...(input.specialtyId !== undefined && {
          specialtyId: input.specialtyId,
        }),
        ...(input.cursor !== undefined && { cursor: input.cursor }),
        pageSize,
      });

      return this.toCursorPage(
        rows,
        pageSize,
        (r) => r.userId,
        toTeacherSummary,
      );
    });
  }

  /**
   * Backs the Next.js middleware's subdomain redirect (Task 6): a request
   * to `{slug}.bilgim.uz` where `slug` isn't claimed by any TeacherProfile
   * gets bounced to the root domain. Cached briefly since it's called on
   * every subdomain page load.
   */
  async slugExists(slug: string): Promise<boolean> {
    const cacheKey = `discovery:teacher-slug-exists:${slug}`;
    return this.cache.getOrSet(cacheKey, LIST_CACHE_TTL_SECONDS, () =>
      this.repository.existsByPublicSlug(slug),
    );
  }

  // ==================================================================
  // System Settings (Public)
  // ==================================================================

  async getSystemSetting(key: string): Promise<any | null> {
    return this.repository.getSystemSetting(key);
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Cap the caller-supplied `pageSize` at 100 (Task 24.2 — pagination
   * audit). Uncapped pagination on a hot public endpoint is the canonical
   * way to ddos an underpowered Postgres replica.
   */
  private normalizePageSize(raw: number | undefined): number {
    if (!raw || !Number.isFinite(raw) || raw <= 0) return DEFAULT_PAGE_SIZE;
    return Math.min(Math.floor(raw), 100);
  }

  /**
   * Normalise a query object into a stable cache key. Keys are sorted so
   * that `?q=ielts&specialtyId=X` and `?specialtyId=X&q=ielts` collapse to
   * the same Redis entry.
   */
  private buildCacheKey(
    scope: 'courses' | 'teachers',
    params: Record<string, unknown>,
  ): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`);
    return `discovery:${scope}:${entries.join('&')}`;
  }

  /**
   * Trim the +1 overflow row off `rows` and produce a `CursorPage`.
   *
   * If the repository returned exactly `pageSize + 1` rows, we know there
   * is at least one more page and the cursor for it is the id of the
   * *last kept* row. Otherwise `nextCursor` is null.
   */
  private toCursorPage<TRow, TOut>(
    rows: TRow[],
    pageSize: number,
    pickId: (row: TRow) => string,
    toSummary: (row: TRow) => TOut,
  ): CursorPage<TOut> {
    const hasMore = rows.length > pageSize;
    const kept = hasMore ? rows.slice(0, pageSize) : rows;
    const lastRow = kept[kept.length - 1];
    const nextCursor = hasMore && lastRow !== undefined ? pickId(lastRow) : null;
    return {
      items: kept.map(toSummary),
      nextCursor,
    };
  }
}

// ====================================================================
// Row → summary mappers (module-level so they are easy to unit-test).
// ====================================================================

function toCourseSummary(row: DiscoveryCourseRow): DiscoveryCourseSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    level: row.level,
    coverUrl: row.coverUrl,
    fromPriceUzs: row.fromPriceUzs,
    teacher: {
      userId: row.teacher.userId,
      publicSlug: row.teacher.publicSlug,
      fullName: row.teacher.fullName,
      headline: row.teacher.headline,
      avatarUrl: row.teacher.coverUrl,
      rating:
        row.teacher.rating !== null ? Number(row.teacher.rating) : null,
      studentsCount: row.teacher.studentsCount,
      specialty: row.teacher.specialty,
    },
  };
}

function toTeacherSummary(row: DiscoveryTeacherRow): DiscoveryTeacherSummary {
  return {
    id: row.userId,
    slug: row.publicSlug,
    fullName: row.fullName,
    headline: row.headline,
    avatarUrl: row.coverUrl,
    themeColor: row.themeColor,
    rating: row.rating !== null ? Number(row.rating) : null,
    studentsCount: row.studentsCount,
    courseCount: row._count.courses,
    specialty: row.specialty,
  };
}
