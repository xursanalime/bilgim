import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

import { UsersRepository } from '../auth/repositories/users.repository';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { CreatePreviewTokenDto, UpdatePublicProfileDto } from './dto';
import {
  isValidSlugFormat,
  RESERVED_TEACHER_SLUGS,
} from './public-slug.constants';

export interface PublicProfileStatus {
  isPublic: boolean;
  publicSlug: string | null;
  headline: string | null;
  fullName: string | null;
  coverUrl: string | null;
  themeColor: string | null;
  discoverableCourseCount: number;
  profileUrlPath: string | null;
}

export type SlugAvailability =
  | { available: true }
  | { available: false; reason: 'invalid' | 'reserved' | 'taken' };

const PREVIEW_TOKEN_PURPOSE = 'teacher-profile-preview';
const PREVIEW_TOKEN_TTL = '10m';
const PREVIEW_TOKEN_TTL_SECONDS = 10 * 60;

interface PreviewTokenPayload {
  purpose: typeof PREVIEW_TOKEN_PURPOSE;
  teacherId: string;
  slug: string;
  headline?: string;
  coverUrl?: string;
  themeColor?: string;
}

export interface ResolvedPreview {
  teacherId: string;
  slug: string;
  headline?: string;
  coverUrl?: string;
  themeColor?: string;
}

export interface PreviewCourseSummary {
  id: string;
  title: string;
  description: string | null;
  level: string | null;
  coverUrl: string | null;
  fromPriceUzs: number | null;
}

export interface PreviewProfileResponse {
  teacher: {
    id: string;
    slug: string;
    fullName: string | null;
    headline: string | null;
    avatarUrl: string | null;
    themeColor: string | null;
    rating: number | null;
    studentsCount: number;
  };
  courses: PreviewCourseSummary[];
}

const MAX_SLUG_ATTEMPTS = 5;

/**
 * TeacherPublicProfileService — owns the "ochiq profil" / "Mening
 * maktabim" toggle that lets a teacher opt into the `/discovery/teachers`
 * marketplace listing AND publish their `{publicSlug}.bilgim.uz` subdomain
 * (the two go live together — there is no separate "publish subdomain"
 * step; saving with `isPublic: true` is enough, Task 6 UX flow).
 *
 * `TeacherProfile.publicSlug` was otherwise never written anywhere in the
 * codebase before this service existed, which is why the public discovery
 * pages were permanently empty — this is the only write path for it.
 */
@Injectable()
export class TeacherPublicProfileService {
  constructor(
    private readonly teacherProfileRepository: TeacherProfileRepository,
    private readonly usersRepository: UsersRepository,
    private readonly prisma: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  async getStatus(userId: string): Promise<PublicProfileStatus> {
    const profile = await this.teacherProfileRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: 'TEACHER_PROFILE_NOT_FOUND',
        message: 'Teacher profile not found.',
      });
    }
    const discoverableCourseCount = await this.prisma.course.count({
      where: { teacherId: userId, isPublished: true, isDiscoverable: true },
    });

    return {
      isPublic: profile.publicSlug !== null,
      publicSlug: profile.publicSlug,
      headline: profile.headline,
      fullName: profile.fullName,
      coverUrl: profile.coverUrl,
      themeColor: profile.themeColor,
      discoverableCourseCount,
      profileUrlPath: profile.publicSlug ? `/teachers/${profile.publicSlug}` : null,
    };
  }

  async setStatus(
    userId: string,
    dto: UpdatePublicProfileDto,
  ): Promise<PublicProfileStatus> {
    const profile = await this.teacherProfileRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: 'TEACHER_PROFILE_NOT_FOUND',
        message: 'Teacher profile not found.',
      });
    }

    const data: {
      publicSlug?: string | null;
      headline?: string | null;
      fullName?: string | null;
      coverUrl?: string | null;
      themeColor?: string | null;
    } = {};

    if (dto.headline !== undefined) {
      data.headline = dto.headline || null;
    }
    if (dto.coverUrl !== undefined) {
      data.coverUrl = dto.coverUrl || null;
    }
    if (dto.themeColor !== undefined) {
      data.themeColor = dto.themeColor;
    }

    if (dto.isPublic) {
      if (!profile.fullName) {
        const user = await this.usersRepository.findById(userId);
        data.fullName = user?.fullName ?? 'Ustoz';
      }
      if (dto.publicSlug) {
        // Teacher explicitly chose/changed their subdomain slug.
        await this.assertSlugClaimable(dto.publicSlug, userId);
        data.publicSlug = dto.publicSlug;
      } else if (!profile.publicSlug) {
        data.publicSlug = await this.generateUniqueSlug(
          data.fullName ?? profile.fullName ?? 'ustoz',
        );
      }
      // else: publishing stays on with no slug change requested.
    } else {
      data.publicSlug = null;
    }

    await this.teacherProfileRepository.updatePublicProfile(userId, data);
    return this.getStatus(userId);
  }

  /**
   * GET /teacher/profile/public-slug/check — debounced availability check
   * for the "Mening maktabim" slug input. A teacher's own current slug is
   * reported available (so re-submitting the unchanged value never errors).
   */
  async checkSlugAvailability(
    userId: string,
    rawSlug: string,
  ): Promise<SlugAvailability> {
    const slug = rawSlug.toLowerCase();
    if (!isValidSlugFormat(slug)) return { available: false, reason: 'invalid' };
    if (RESERVED_TEACHER_SLUGS.has(slug)) return { available: false, reason: 'reserved' };

    const ownerId = await this.teacherProfileRepository.findUserIdByPublicSlug(slug);
    if (ownerId && ownerId !== userId) return { available: false, reason: 'taken' };
    return { available: true };
  }

  /**
   * POST /teacher/profile/public-slug/preview-token
   *
   * Signs the *draft* slug/headline/coverUrl/themeColor the settings form
   * currently holds — none of it needs to be saved yet. The "Ko'rib
   * chiqish" button opens `{slug}.bilgim.uz/?preview=<token>` (or the
   * localhost-port equivalent in dev) with this token, and the middleware
   * lets that request through even when `publicSlug` isn't claimed yet.
   */
  async createPreviewToken(
    userId: string,
    dto: CreatePreviewTokenDto,
  ): Promise<{ previewToken: string; expiresInSeconds: number }> {
    if (!isValidSlugFormat(dto.slug)) {
      throw new BadRequestException({
        code: 'SLUG_INVALID',
        message:
          "Slug faqat lotin harflari, raqamlar va '-' dan iborat bo'lishi, 3-32 belgi bo'lishi kerak.",
      });
    }

    const payload: PreviewTokenPayload = {
      purpose: PREVIEW_TOKEN_PURPOSE,
      teacherId: userId,
      slug: dto.slug,
      ...(dto.headline !== undefined && { headline: dto.headline }),
      ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
      ...(dto.themeColor !== undefined && { themeColor: dto.themeColor }),
    };
    const previewToken = await this.jwtService.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn: PREVIEW_TOKEN_TTL,
    });
    return { previewToken, expiresInSeconds: PREVIEW_TOKEN_TTL_SECONDS };
  }

  /**
   * Resolves + validates a preview token. Used by the public
   * `GET /teacher-preview` endpoint that the subdomain preview page reads
   * from (Server Component → API, no browser cookies involved — the
   * signed token itself is the credential).
   */
  async resolvePreviewToken(token: string): Promise<ResolvedPreview> {
    let payload: PreviewTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<PreviewTokenPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new NotFoundException({
        code: 'PREVIEW_TOKEN_INVALID',
        message: 'Preview token invalid or expired.',
      });
    }
    if (payload.purpose !== PREVIEW_TOKEN_PURPOSE) {
      throw new NotFoundException({
        code: 'PREVIEW_TOKEN_INVALID',
        message: 'Preview token invalid or expired.',
      });
    }
    return {
      teacherId: payload.teacherId,
      slug: payload.slug,
      ...(payload.headline !== undefined && { headline: payload.headline }),
      ...(payload.coverUrl !== undefined && { coverUrl: payload.coverUrl }),
      ...(payload.themeColor !== undefined && { themeColor: payload.themeColor }),
    };
  }

  /**
   * GET /teacher-preview?token=… — the data the subdomain preview page
   * renders. Bypasses the `isPublished`/`isDiscoverable`/`publicSlug`
   * gates that `DiscoveryService` enforces for real visitors: possession
   * of a valid, unexpired token IS the authorization here, and the
   * teacher previewing their own draft may not be published yet at all.
   */
  async getPreviewProfile(token: string): Promise<PreviewProfileResponse> {
    const preview = await this.resolvePreviewToken(token);
    const profile = await this.teacherProfileRepository.findByUserId(preview.teacherId);
    if (!profile) {
      throw new NotFoundException({
        code: 'TEACHER_PROFILE_NOT_FOUND',
        message: 'Teacher profile not found.',
      });
    }

    const courses = await this.prisma.course.findMany({
      where: { teacherId: preview.teacherId, isPublished: true, isDiscoverable: true },
      select: {
        id: true,
        title: true,
        description: true,
        level: true,
        coverUrl: true,
        fromPriceUzs: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      teacher: {
        id: preview.teacherId,
        slug: preview.slug,
        fullName: profile.fullName,
        headline: preview.headline ?? profile.headline,
        // An empty-string draft coverUrl is the "O'chirish" (remove)
        // button's explicit "no cover" signal, distinct from `undefined`
        // (form never touched the cover, fall back to the saved value).
        avatarUrl: preview.coverUrl !== undefined ? preview.coverUrl || null : profile.coverUrl,
        themeColor: preview.themeColor ?? profile.themeColor,
        rating: profile.rating !== null ? Number(profile.rating) : null,
        studentsCount: profile.studentsCount,
      },
      courses,
    };
  }

  /** Throws a clear, user-facing error when `slug` can't be claimed by `userId`. */
  private async assertSlugClaimable(slug: string, userId: string): Promise<void> {
    if (!isValidSlugFormat(slug)) {
      throw new BadRequestException({
        code: 'SLUG_INVALID',
        message:
          "Slug faqat lotin harflari, raqamlar va '-' dan iborat bo'lishi, 3-32 belgi bo'lishi kerak.",
      });
    }
    if (RESERVED_TEACHER_SLUGS.has(slug)) {
      throw new ConflictException({
        code: 'SLUG_RESERVED',
        message: `"${slug}" tizim uchun band qilingan — boshqa nom tanlang.`,
      });
    }
    const ownerId = await this.teacherProfileRepository.findUserIdByPublicSlug(slug);
    if (ownerId && ownerId !== userId) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: `"${slug}" allaqachon band — boshqa nom tanlang.`,
      });
    }
  }

  /**
   * Slugify `seed`, then retry with a random suffix on unique-constraint
   * collisions (`publicSlug` has a DB-level unique index).
   */
  private async generateUniqueSlug(seed: string): Promise<string> {
    const base = slugify(seed) || 'ustoz';

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
      const existing = await this.prisma.teacherProfile.findUnique({
        where: { publicSlug: candidate },
        select: { userId: true },
      });
      if (!existing) return candidate;
    }
    // Extremely unlikely fallback: base + long random string.
    return `${base}-${randomSuffix()}${randomSuffix()}`;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ʻʼ'`]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
