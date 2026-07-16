import { Injectable } from '@nestjs/common';
import { CefrLevel, Prisma, PrismaClient, TeacherProfile } from '@prisma/client';

export interface UpsertTeacherProfileInput {
  userId: string;
  specialtyId: string;
  fullName?: string | null;
}

/**
 * English-teaching attributes collected during the refocused instructor
 * onboarding (english-only-platform-refocus, Req 10.3).
 */
export interface EnglishTeachingAttributes {
  /** Subset of CEFR levels (A1–C2) the instructor teaches. */
  taughtCefrLevels: CefrLevel[];
  /** `ExamTrack.slug` strings the instructor focuses on (e.g. ["ielts"]). */
  examTrackFocus: string[];
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
   * Persist the instructor's English-teaching attributes (taught CEFR levels
   * and exam-track focus) and stamp onboarding as complete
   * (english-only-platform-refocus, Req 10.3, 10.4).
   *
   * The profile is expected to already exist (the registration flow stamps the
   * default English specialty); we therefore `update` rather than `upsert`.
   * Scalar-list fields are replaced wholesale via `{ set: [...] }` so the call
   * is idempotent: re-submitting onboarding overwrites the previous values.
   */
  async updateEnglishTeachingAttributes(
    userId: string,
    input: EnglishTeachingAttributes,
    tx?: Prisma.TransactionClient,
  ): Promise<TeacherProfile> {
    const client = tx ?? this.prisma;
    return client.teacherProfile.update({
      where: { userId },
      data: {
        taughtCefrLevels: { set: input.taughtCefrLevels },
        examTrackFocus: { set: input.examTrackFocus },
        onboardingCompletedAt: new Date(),
      },
    });
  }
}
