import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, TeacherProfile } from '@prisma/client';

export interface UpsertTeacherProfileInput {
  userId: string;
  specialtyId: string;
  fullName?: string | null;
}

/**
 * TeacherProfileRepository — Prisma-based CRUD for the TeacherProfile table.
 *
 * Owned by the teacher module: the `auth` module creates the User row, and the
 * teacher module creates / updates the corresponding TeacherProfile (1:1 with User).
 */
@Injectable()
export class TeacherProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<TeacherProfile | null> {
    const client = tx ?? this.prisma;
    return client.teacherProfile.findUnique({ where: { userId } });
  }

  /**
   * Create a new TeacherProfile or update the existing one with the given
   * specialtyId and onboarding completion timestamp.
   *
   * Used at the end of the onboarding quiz: we want this to be idempotent so
   * that a teacher who re-takes the quiz simply has their specialty re-assigned
   * (Requirement 2.5: a teacher has at most one specialty).
   */
  async upsertWithSpecialty(
    input: UpsertTeacherProfileInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TeacherProfile> {
    const client = tx ?? this.prisma;
    const now = new Date();

    return client.teacherProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        specialtyId: input.specialtyId,
        onboardingCompletedAt: now,
        fullName: input.fullName ?? null,
      },
      update: {
        specialtyId: input.specialtyId,
        onboardingCompletedAt: now,
      },
    });
  }

  /**
   * Patch the public-discovery fields (`publicSlug`, `headline`,
   * `fullName`) on an existing TeacherProfile. Used by the "ochiq profil"
   * settings toggle — `publicSlug: null` drops the teacher out of
   * `/discovery/teachers`, a non-null value publishes them.
   */
  async updatePublicProfile(
    userId: string,
    data: {
      publicSlug?: string | null;
      headline?: string | null;
      fullName?: string | null;
    },
  ): Promise<TeacherProfile> {
    return this.prisma.teacherProfile.update({
      where: { userId },
      data,
    });
  }
}
