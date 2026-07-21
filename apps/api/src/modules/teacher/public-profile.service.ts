import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { UsersRepository } from '../auth/repositories/users.repository';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { UpdatePublicProfileDto } from './dto';

export interface PublicProfileStatus {
  isPublic: boolean;
  publicSlug: string | null;
  headline: string | null;
  fullName: string | null;
  discoverableCourseCount: number;
  profileUrlPath: string | null;
}

const MAX_SLUG_ATTEMPTS = 5;

/**
 * TeacherPublicProfileService — owns the "ochiq profil" toggle that lets a
 * teacher opt into the `/discovery/teachers` marketplace listing.
 *
 * `TeacherProfile.publicSlug` is otherwise never written anywhere in the
 * codebase, which is why the public discovery pages were permanently
 * empty — this service is the missing write path.
 */
@Injectable()
export class TeacherPublicProfileService {
  constructor(
    private readonly teacherProfileRepository: TeacherProfileRepository,
    private readonly usersRepository: UsersRepository,
    private readonly prisma: PrismaClient,
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
    } = {};

    if (dto.headline !== undefined) {
      data.headline = dto.headline || null;
    }

    if (dto.isPublic) {
      if (!profile.fullName) {
        const user = await this.usersRepository.findById(userId);
        data.fullName = user?.fullName ?? 'Ustoz';
      }
      if (!profile.publicSlug) {
        data.publicSlug = await this.generateUniqueSlug(
          data.fullName ?? profile.fullName ?? 'ustoz',
        );
      }
    } else {
      data.publicSlug = null;
    }

    await this.teacherProfileRepository.updatePublicProfile(userId, data);
    return this.getStatus(userId);
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
