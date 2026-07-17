import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { HttpCache } from '../../common/interceptors/http-cache.interceptor';
import { CacheTtl } from '../../common/interceptors/response-cache.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  DiscoveryCourseSummary,
  DiscoveryGroupSummary,
  DiscoveryService,
  DiscoveryTeacherDetail,
  DiscoveryTeacherSummary,
  CursorPage,
} from './discovery.service';
import {
  ListDiscoveryCoursesDto,
  ListDiscoveryCoursesSchema,
  ListDiscoveryTeachersDto,
  ListDiscoveryTeachersSchema,
} from './dto';

/**
 * DiscoveryController — public, unauthenticated REST endpoints for the
 * marketing discovery surface (Req 14.1 — 14.7).
 *
 * Every route is `@Public()` so the global `JwtAuthGuard` skips it. The
 * controller is purposely thin: validation lives in the Zod DTOs and all
 * visibility filtering (isPublished/isDiscoverable/publicSlug) sits in the
 * repository.
 *
 * Endpoints intentionally diverge from the teacher-facing `/catalog/*`
 * routes — visitors must never reach unpublished or hidden rows even with
 * a known UUID.
 */
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  /**
   * GET /discovery/courses
   *
   * Filters: `q`, `specialtyId`, `level`, `priceMin`, `priceMax`,
   * `cursor`, `pageSize`. Returns published+discoverable courses with the
   * teacher summary embedded.
   *
   * HTTP-level caching: 60 s `max-age` with a 5 min
   * `stale-while-revalidate` window so a CDN can keep serving the last
   * good response while it refreshes the entry in the background
   * (Task 24.2).
   */
  @Public()
  @Get('courses')
  @HttpCode(HttpStatus.OK)
  @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
  @CacheTtl(60)
  async listCourses(
    @Query(new ZodValidationPipe(ListDiscoveryCoursesSchema))
    query: ListDiscoveryCoursesDto,
  ): Promise<CursorPage<DiscoveryCourseSummary>> {
    return this.discoveryService.listCourses(query);
  }

  /**
   * GET /discovery/courses/:id
   *
   * Returns a single course only when it is `isPublished=true AND
   * isDiscoverable=true`. Hidden rows return 404 to avoid leaking
   * existence to visitors.
   */
  @Public()
  @Get('courses/:id')
  @HttpCode(HttpStatus.OK)
  @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
  @CacheTtl(60)
  async getCourse(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DiscoveryCourseSummary> {
    return this.discoveryService.getCourseById(id);
  }

  /**
   * GET /discovery/courses/:id/groups
   *
   * Lists the joinable groups of a public course so a student can pick one
   * and submit a join request. Returns 404 when the course is hidden.
   */
  @Public()
  @Get('courses/:id/groups')
  @HttpCode(HttpStatus.OK)
  @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
  @CacheTtl(60)
  async getCourseGroups(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DiscoveryGroupSummary[]> {
    return this.discoveryService.listCourseGroups(id);
  }

  /**
   * GET /discovery/teachers
   *
   * Filters: `q` (full name / headline trigram), `specialtyId`, `cursor`,
   * `pageSize`. Excludes teachers whose `publicSlug` is null and those
   * with no public courses.
   */
  @Public()
  @Get('teachers')
  @HttpCode(HttpStatus.OK)
  @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
  @CacheTtl(60)
  async listTeachers(
    @Query(new ZodValidationPipe(ListDiscoveryTeachersSchema))
    query: ListDiscoveryTeachersDto,
  ): Promise<CursorPage<DiscoveryTeacherSummary>> {
    return this.discoveryService.listTeachers(query);
  }

  /**
   * GET /discovery/teachers/:slug
   *
   * A teacher's public profile ("their website") by `publicSlug`, with
   * their published+discoverable courses embedded. Backs both the
   * `bilgim.uz/teachers/:slug` page and (Phase 1 subdomain routing) a
   * teacher's own `<slug>.bilgim.uz` landing page — same data, same rule.
   * 404s when the slug doesn't exist or the profile has no public courses
   * yet, rather than leaking a half-set-up profile.
   */
  @Public()
  @Get('teachers/:slug')
  @HttpCode(HttpStatus.OK)
  @HttpCache({ maxAge: 60, staleWhileRevalidate: 300 })
  @CacheTtl(60)
  async getTeacherBySlug(
    @Param('slug') slug: string,
  ): Promise<DiscoveryTeacherDetail> {
    return this.discoveryService.getTeacherBySlug(slug);
  }

  /** GET /discovery/settings/:key — get public system setting. */
  @Public()
  @Get('settings/:key')
  @HttpCode(HttpStatus.OK)
  async getSetting(@Param('key') key: string) {
    return this.discoveryService.getSystemSetting(key);
  }
}
