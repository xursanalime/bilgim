import { Injectable } from '@nestjs/common';
import {
  Enrollment,
  EnrollmentRequest,
  EnrollmentStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

/**
 * EnrollmentRepository — Prisma-based CRUD for both Enrollment and
 * EnrollmentRequest tables.
 *
 * The `(groupId, studentId)` UNIQUE index on each table guarantees a single
 * row per (group, student) pair (Req 5.6). Approve / reject paths use
 * conditional `updateMany` so concurrent decisions on the same request
 * cannot stomp each other.
 */
@Injectable()
export class EnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // EnrollmentRequest
  // ------------------------------------------------------------------

  async findRequestById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EnrollmentRequest | null> {
    const client = tx ?? this.prisma;
    return client.enrollmentRequest.findUnique({ where: { id } });
  }

  /**
   * Find an existing request for a `(groupId, studentId)` pair, if any.
   * The `(groupId, studentId)` UNIQUE index guarantees at most one row.
   */
  async findRequestByGroupAndStudent(
    groupId: string,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EnrollmentRequest | null> {
    const client = tx ?? this.prisma;
    return client.enrollmentRequest.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
    });
  }

  /**
   * Create (or re-open) a direct join request in `PENDING_APPROVAL` status.
   *
   * Uses `upsert` against the `(groupId, studentId)` UNIQUE index so a
   * student who previously had a REJECTED/REVOKED request can re-apply: the
   * row is reset back to PENDING_APPROVAL and the decision metadata cleared.
   */
  async upsertPendingRequest(
    input: { groupId: string; studentId: string; message?: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<EnrollmentRequest> {
    const client = tx ?? this.prisma;
    return client.enrollmentRequest.upsert({
      where: {
        groupId_studentId: {
          groupId: input.groupId,
          studentId: input.studentId,
        },
      },
      create: {
        groupId: input.groupId,
        studentId: input.studentId,
        message: input.message ?? null,
        status: 'PENDING_APPROVAL',
      },
      update: {
        status: 'PENDING_APPROVAL',
        message: input.message ?? null,
        decidedAt: null,
        decidedById: null,
      },
    });
  }

  /** All enrollment requests submitted by a student (any status). */
  async listRequestsByStudent(
    studentId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<EnrollmentRequest[]> {
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.enrollmentRequest.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * Ensure a StudentProfile row exists for the given user. Enrollment and
   * EnrollmentRequest both FK to `StudentProfile.userId`, so this must run
   * before the first request is created.
   */
  async ensureStudentProfile(
    userId: string,
    primaryLocale = 'uz',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.studentProfile.upsert({
      where: { userId },
      create: { userId, primaryLocale },
      update: {},
    });
  }

  async findPendingRequestsForGroups(
    groupIds: string[],
    opts: { take?: number; skip?: number } = {},
  ): Promise<EnrollmentRequest[]> {
    if (groupIds.length === 0) return [];
    // Pagination cap (Task 24.2): a teacher's pending-request inbox is
    // usually small but a viral invite link can spike it. Default 100,
    // hard-cap at 100 so the inbox endpoint stays bounded.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.enrollmentRequest.findMany({
      where: {
        groupId: { in: groupIds },
        status: 'PENDING_APPROVAL',
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    });
  }

  /**
   * Atomically transition an EnrollmentRequest from `fromStatus` to
   * `toStatus` only if the row is currently in `fromStatus` (lost-update
   * guard). Returns `true` when the row was updated, `false` if the
   * precondition failed.
   */
  async transitionRequestStatus(
    requestId: string,
    fromStatus: EnrollmentStatus,
    toStatus: EnrollmentStatus,
    decidedById: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.enrollmentRequest.updateMany({
      where: { id: requestId, status: fromStatus },
      data: {
        status: toStatus,
        decidedAt: new Date(),
        decidedById,
      },
    });
    return result.count > 0;
  }

  // ------------------------------------------------------------------
  // Enrollment
  // ------------------------------------------------------------------

  async findEnrollment(
    groupId: string,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Enrollment | null> {
    const client = tx ?? this.prisma;
    return client.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
    });
  }

  /**
   * Idempotent upsert: if an Enrollment for `(groupId, studentId)` already
   * exists, return it; otherwise create one in `APPROVED` status.
   *
   * The unique index `(groupId, studentId)` (Req 5.6) means two concurrent
   * approve calls for the same student converge on a single row.
   */
  async upsertApprovedEnrollment(
    input: { groupId: string; studentId: string; invoiceId: string | null },
    tx?: Prisma.TransactionClient,
  ): Promise<Enrollment> {
    const client = tx ?? this.prisma;
    // Only include invoiceId in `update` when actually provided so that we
    // never overwrite an existing invoice link with `null`.
    const updateData: Prisma.EnrollmentUpdateInput = {};
    if (input.invoiceId) {
      updateData.invoiceId = input.invoiceId;
    }
    return client.enrollment.upsert({
      where: {
        groupId_studentId: {
          groupId: input.groupId,
          studentId: input.studentId,
        },
      },
      create: {
        groupId: input.groupId,
        studentId: input.studentId,
        invoiceId: input.invoiceId,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
      update: updateData,
    });
  }

  async listApprovedByStudent(
    studentId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<Enrollment[]> {
    // Pagination cap (Task 24.2): a student is unlikely to have >100
    // active enrollments, but the cap keeps the dashboard endpoint
    // bounded under all circumstances.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.enrollment.findMany({
      where: { studentId, status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
      take,
      skip,
    });
  }

  async findApprovedForGroups(
    groupIds: string[],
    opts: { take?: number; skip?: number } = {},
  ): Promise<Enrollment[]> {
    if (groupIds.length === 0) return [];
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.enrollment.findMany({
      where: {
        groupId: { in: groupIds },
        status: 'APPROVED',
      },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            course: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: { approvedAt: 'desc' },
      take,
      skip,
    });
  }
}
