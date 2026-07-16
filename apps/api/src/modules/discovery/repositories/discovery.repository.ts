import { Injectable } from '@nestjs/common';
import { CefrLevel, Prisma, PrismaClient } from '@prisma/client';

/**
 * Filters used by the public Discovery search endpoints (Req 14.1 — 14.4).
 *
 * Visibility invariants enforced inside the repository (not the controller):
 *   - Course rows: `isPublished = true` AND `isDiscoverable = true`.
 *   - Teacher rows: `publicSlug IS NOT NULL`, AND the teacher must own at
 *     least one published+discoverable course (otherwise the profile has
 *     nothing to show on the public page).
 *
 * All filters are optional. `cursor` is a `Course.id` / `TeacherProfile.userId`
 * from the previous page; pagination uses `(createdAt DESC, id DESC)` so the
 * cursor refers to the last row returned.
 */
export interface DiscoveryCourseFilters {
  q?: string;
  /** English level facet — one or more CEFR levels (Req 14.2). */
  cefrLevels?: CefrLevel[];
  /** Exam-track slug facet, e.g. "ielts" (Req 14.3). */
  examTrack?: string;
  /** Legacy free-text level string (retained). */
  level?: string;
  priceMin?: number;
  priceMax?: number;
  cursor?: string;
  pageSize: number;
}

export interface DiscoveryTeacherFilters {
  q?: string;
  /** English level facet — matches `TeacherProfile.taughtCefrLevels` (Req 14.2). */
  cefrLevels?: CefrLevel[];
  /** Exam-track slug — matches `TeacherProfile.examTrackFocus` (Req 14.3). */
  examTrack?: string;
  cursor?: string;
  pageSize: number;
}

export interface DiscoveryCourseRow {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  cefrLevel: CefrLevel | null;
  examTrack: string | null;
  coverUrl: string | null;
  fromPriceUzs: number | null;
  createdAt: Date;
  teacher: {
    userId: string;
    publicSlug: string | null;
    fullName: string | null;
    headline: string | null;
    coverUrl: string | null;
    rating: Prisma.Decimal | null;
    studentsCount: number;
    specialty: {
      id: string;
      slug: string;
      nameUz: string;
      nameRu: string;
      nameEn: string;
    } | null;
  };
}

export interface DiscoveryTeacherRow {
  userId: string;
  publicSlug: string | null;
  fullName: string | null;
  headline: string | null;
  coverUrl: string | null;
  rating: Prisma.Decimal | null;
  studentsCount: number;
  createdAt: Date;
  taughtCefrLevels: CefrLevel[];
  examTrackFocus: string[];
  specialty: {
    id: string;
    slug: string;
    nameUz: string;
    nameRu: string;
    nameEn: string;
  } | null;
  _count: { courses: number };
}

/**
 * DiscoveryRepository — read-only Prisma access for the public discovery
 * surface. No writes. All queries scoped by `isDiscoverable=true` /
 * `isPublished=true` flags so the controller cannot leak hidden rows.
 *
 * Search uses Postgres `ILIKE`, which is accelerated by the `pg_trgm` GIN
 * indexes added in the `*_extensions_indexes_triggers` migration:
 *   - `teacher_profile_fullname_trgm_idx` on `TeacherProfile.fullName`
 *   - `teacher_profile_headline_trgm_idx` on `TeacherProfile.headline`
 *   - `course_title_trgm_idx` on `Course.title`
 *
 * If a `q` of length < 2 slips through (DTO already enforces min 2), it is
 * silently ignored to avoid catastrophic plans on very short patterns.
 */
@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ==================================================================
  // Courses
  // ==================================================================

  /**
   * List published + discoverable courses, oldest cursor wins on ties.
   *
   * Returns *up to* `pageSize + 1` rows so the service can detect whether
   * there is another page (the +1 is stripped before returning).
   */
  async searchCourses(
    filters: DiscoveryCourseFilters,
  ): Promise<DiscoveryCourseRow[]> {
    const where: Prisma.CourseWhereInput = {
      isPublished: true,
      isDiscoverable: true,
    };

    if (filters.cefrLevels && filters.cefrLevels.length > 0) {
      where.cefrLevel = { in: filters.cefrLevels };
    }
    if (filters.examTrack) {
      where.examTrack = filters.examTrack;
    }
    if (filters.level) {
      where.level = filters.level;
    }
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      where.fromPriceUzs = {
        ...(filters.priceMin !== undefined && { gte: filters.priceMin }),
        ...(filters.priceMax !== undefined && { lte: filters.priceMax }),
      };
    }
    if (filters.q && filters.q.length >= 2) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.course.findMany({
      where,
      take: filters.pageSize + 1,
      ...(filters.cursor && {
        cursor: { id: filters.cursor },
        skip: 1,
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        cefrLevel: true,
        examTrack: true,
        coverUrl: true,
        fromPriceUzs: true,
        createdAt: true,
        teacher: {
          select: {
            userId: true,
            publicSlug: true,
            fullName: true,
            headline: true,
            coverUrl: true,
            rating: true,
            studentsCount: true,
            specialty: {
              select: {
                id: true,
                slug: true,
                nameUz: true,
                nameRu: true,
                nameEn: true,
              },
            },
          },
        },
      },
    });

    return rows;
  }

  async getSystemSetting(key: string): Promise<any | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting?.value || null;
  }

  /**
   * Single public course by id (Req 14.2, 14.3).
   * Returns `null` if the row is hidden (`isPublished=false` or
   * `isDiscoverable=false`) or does not exist — the caller decides how to
   * map that to a 404.
   */
  async findPublicCourseById(id: string): Promise<DiscoveryCourseRow | null> {
    return this.prisma.course.findFirst({
      where: { id, isPublished: true, isDiscoverable: true },
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        cefrLevel: true,
        examTrack: true,
        coverUrl: true,
        fromPriceUzs: true,
        createdAt: true,
        teacher: {
          select: {
            userId: true,
            publicSlug: true,
            fullName: true,
            headline: true,
            coverUrl: true,
            rating: true,
            studentsCount: true,
            specialty: {
              select: {
                id: true,
                slug: true,
                nameUz: true,
                nameRu: true,
                nameEn: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * List the joinable groups of a public course.
   *
   * A group is shown only when its parent course is published+discoverable
   * AND the group itself is `isDiscoverable=true`. Returns an empty array
   * when the course is hidden or missing — the caller maps that to a 404 if
   * needed.
   */
  async listPublicGroupsForCourse(courseId: string): Promise<
    Array<{
      id: string;
      name: string;
      priceUzs: number;
      capacity: number | null;
      startsOn: Date | null;
      endsOn: Date | null;
    }>
  > {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, isPublished: true, isDiscoverable: true },
      select: { id: true },
    });
    if (!course) return [];

    return this.prisma.group.findMany({
      where: { courseId, isDiscoverable: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        priceUzs: true,
        capacity: true,
        startsOn: true,
        endsOn: true,
      },
    });
  }

  // ==================================================================
  // Teachers
  // ==================================================================

  /**
   * List teachers visible on the public discovery surface (Req 14.1, 14.4).
   *
   * Visibility rules:
   *   - `publicSlug IS NOT NULL` — teacher has chosen to publish.
   *   - At least one course owned by the teacher is `isPublished=true AND
   *     isDiscoverable=true` — empty profiles are excluded so we don't
   *     send the visitor to a dead end.
   *
   * Cursor-based pagination keyed on `userId` for stability.
   */
  async searchTeachers(
    filters: DiscoveryTeacherFilters,
  ): Promise<DiscoveryTeacherRow[]> {
    const where: Prisma.TeacherProfileWhereInput = {
      publicSlug: { not: null },
      courses: {
        some: { isPublished: true, isDiscoverable: true },
      },
    };

    if (filters.cefrLevels && filters.cefrLevels.length > 0) {
      where.taughtCefrLevels = { hasSome: filters.cefrLevels };
    }
    if (filters.examTrack) {
      where.examTrackFocus = { has: filters.examTrack };
    }
    if (filters.q && filters.q.length >= 2) {
      where.OR = [
        { fullName: { contains: filters.q, mode: 'insensitive' } },
        { headline: { contains: filters.q, mode: 'insensitive' } },
        { publicSlug: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.teacherProfile.findMany({
      where,
      take: filters.pageSize + 1,
      ...(filters.cursor && {
        cursor: { userId: filters.cursor },
        skip: 1,
      }),
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      select: {
        userId: true,
        publicSlug: true,
        fullName: true,
        headline: true,
        coverUrl: true,
        rating: true,
        studentsCount: true,
        createdAt: true,
        taughtCefrLevels: true,
        examTrackFocus: true,
        specialty: {
          select: {
            id: true,
            slug: true,
            nameUz: true,
            nameRu: true,
            nameEn: true,
          },
        },
        _count: {
          select: {
            courses: {
              where: { isPublished: true, isDiscoverable: true },
            },
          },
        },
      },
    });
  }
}
