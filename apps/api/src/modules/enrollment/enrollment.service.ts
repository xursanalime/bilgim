import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Enrollment, InviteLink, Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupChatRepository } from '../group-chat/repositories/group-chat.repository';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreateEnrollmentRequestDto } from './dto/create-request.dto';
import { EnrollmentRepository } from './repositories/enrollment.repository';
import { InviteLinkRepository } from './repositories/invite-link.repository';

/** Default invite link TTL: 7 days. */
export const DEFAULT_INVITE_TTL_HOURS = 168;
/** Default uses limit: 100 students per link. */
export const DEFAULT_INVITE_USES_LIMIT = 100;
/** Random byte length for the invite token (24 bytes ≈ 32 base64url chars). */
const INVITE_TOKEN_BYTES = 24;
/** Number of token-collision retries before giving up. */
const TOKEN_RETRY_LIMIT = 5;

/**
 * Public-facing summary of a group rendered on the invite landing page.
 * Returned by `GET /enrollment/invite/:token`. Intentionally read-only: no
 * student PII, no internal IDs except the group id (the student needs it to
 * start the Payme checkout).
 */
export interface InviteResolution {
  groupId: string;
  groupName: string;
  courseTitle: string;
  teacherName: string;
  priceUzs: number;
  capacity: number | null;
  startsOn: Date | null;
  endsOn: Date | null;
}

/**
 * Public summary of a freshly created invite link. The teacher UI uses
 * `url` directly (clipboard) and `token` only for revocation calls.
 */
export interface CreatedInvite {
  id: string;
  token: string;
  url: string;
  groupId: string;
  expiresAt: Date | null;
  usesLimit: number | null;
  createdAt: Date;
}

/**
 * EnrollmentService — owns InviteLink, EnrollmentRequest and Enrollment
 * lifecycles (Req 5.1 – 5.7).
 *
 * Notes:
 *  - Approve and reject mutate state in a single Prisma transaction so the
 *    OutboxEvent commits atomically with the row change (Req 18.1).
 *  - The repository's optimistic precondition (`updateMany WHERE status=...`)
 *    means concurrent approve/reject of the same request becomes one winner
 *    and one `ENROLLMENT_REQUEST_INVALID_TRANSITION` error.
 */
@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly inviteLinkRepository: InviteLinkRepository,
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly outboxService: OutboxService,
    private readonly config: ConfigService,
    private readonly groupChatRepository: GroupChatRepository,
  ) {}

  // ------------------------------------------------------------------
  // Invite link creation (Req 5.1)
  // ------------------------------------------------------------------

  /**
   * Create an invite link for a group owned by `teacherId`.
   *
   * Cross-teacher enforcement: throws `ForbiddenException(NOT_OWNING_TEACHER)`
   * if the group's course is owned by a different teacher.
   */
  async createInviteLink(
    teacherId: string,
    dto: CreateInviteDto,
  ): Promise<CreatedInvite> {
    // Verify the teacher owns the group (via course).
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
      include: { course: true },
    });
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }
    if (group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only create invites for your own groups',
      });
    }

    const ttlHours =
      dto.expiresInHours === undefined
        ? DEFAULT_INVITE_TTL_HOURS
        : dto.expiresInHours;
    const expiresAt =
      ttlHours === null ? null : new Date(Date.now() + ttlHours * 3600 * 1000);

    const usesLimit =
      dto.usesLimit === undefined ? DEFAULT_INVITE_USES_LIMIT : dto.usesLimit;

    // Retry on the (extremely unlikely) token collision — UNIQUE on `token`
    // raises Prisma `P2002` which we re-roll up to TOKEN_RETRY_LIMIT times.
    let lastError: unknown;
    for (let attempt = 0; attempt < TOKEN_RETRY_LIMIT; attempt++) {
      const token = this.generateToken();
      try {
        const invite = await this.inviteLinkRepository.create({
          token,
          groupId: dto.groupId,
          createdById: teacherId,
          expiresAt,
          usesLimit,
        });
        return this.toCreatedInvite(invite);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          this.logger.warn(
            `Invite token collision (attempt ${attempt + 1}/${TOKEN_RETRY_LIMIT}); retrying`,
          );
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to allocate a unique invite token');
  }

  // ------------------------------------------------------------------
  // Invite resolution (Req 5.2, 5.7)
  // ------------------------------------------------------------------

  /**
   * Resolve a public invite token into a group landing-page summary.
   *
   * Returns 404 INVITE_NOT_FOUND if the token does not exist, is inactive,
   * has expired, or has reached its uses limit (Req 5.7). All four conditions
   * collapse into the same error so the API does not leak which condition
   * failed (preventing token enumeration).
   */
  async findGroupByCode(code: string): Promise<InviteResolution> {
    const group = await this.prisma.group.findUnique({
      where: { joinCode: code },
      include: {
        course: {
          include: {
            teacher: { include: { user: true } },
          },
        },
      },
    });

    if (!group || group.status !== 'OPEN') {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND_BY_CODE',
        message: 'Invalid group code or group is closed',
      });
    }

    return {
      groupId: group.id,
      groupName: group.name,
      courseTitle: group.course.title,
      teacherName:
        group.course.teacher.fullName ??
        group.course.teacher.user.fullName ??
        '',
      priceUzs: group.priceUzs,
      capacity: group.capacity,
      startsOn: group.startsOn,
      endsOn: group.endsOn,
    };
  }

  async resolveInvite(token: string): Promise<InviteResolution> {
    const invite = await this.inviteLinkRepository.findByToken(token);
    if (!invite || !this.isInviteUsable(invite)) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        message: 'Invite link not found, expired, or fully used',
      });
    }

    const group = await this.prisma.group.findUnique({
      where: { id: invite.groupId },
      include: {
        course: {
          include: {
            teacher: { include: { user: true } },
          },
        },
      },
    });
    if (!group) {
      // Defensive: should not happen because of FK constraints.
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        message: 'Invite link not found, expired, or fully used',
      });
    }

    return {
      groupId: group.id,
      groupName: group.name,
      courseTitle: group.course.title,
      teacherName:
        group.course.teacher.fullName ??
        group.course.teacher.user.fullName ??
        '',
      priceUzs: group.priceUzs,
      capacity: group.capacity,
      startsOn: group.startsOn,
      endsOn: group.endsOn,
    };
  }

  // ------------------------------------------------------------------
  // Approve / reject (Req 5.3, 5.4, 5.5)
  // ------------------------------------------------------------------

  /**
   * Approve a pending enrollment request.
   *
   * Atomic: in a single transaction we
   *  1. transition `EnrollmentRequest.status` PENDING_APPROVAL → APPROVED
   *     (with an updateMany precondition guarding against concurrent decisions),
   *  2. upsert an `Enrollment(status=APPROVED)` row for `(groupId, studentId)`
   *     — the unique constraint guarantees a single Enrollment per pair (Req 5.6),
   *  3. emit `enrollment.approved` to the outbox so the notification fan-out
   *     and other subscribers see it (Req 5.4).
   */
  async approveRequest(
    teacherId: string,
    requestId: string,
  ): Promise<{ enrollment: Enrollment; requestId: string }> {
    const request = await this.loadRequestForTeacher(teacherId, requestId);

    return this.prisma.$transaction(async (tx) => {
      const transitioned =
        await this.enrollmentRepository.transitionRequestStatus(
          request.id,
          'PENDING_APPROVAL',
          'APPROVED',
          teacherId,
          tx,
        );
      if (!transitioned) {
        // Another caller (or a previous retry) already moved the request out
        // of PENDING_APPROVAL. Surface a 409 so the UI can refresh.
        throw new ConflictException({
          code: 'ENROLLMENT_REQUEST_INVALID_TRANSITION',
          message: 'Request is no longer pending approval',
        });
      }

      const enrollment =
        await this.enrollmentRepository.upsertApprovedEnrollment(
          {
            groupId: request.groupId,
            studentId: request.studentId,
            invoiceId: request.invoiceId,
          },
          tx,
        );

      await this.outboxService.create(tx, {
        topic: 'enrollment.approved',
        payload: {
          enrollmentId: enrollment.id,
          enrollmentRequestId: request.id,
          groupId: request.groupId,
          studentId: request.studentId,
          teacherId,
          invoiceId: request.invoiceId ?? null,
        },
        idempotencyKey: `enrollment.approved:${request.id}`,
      });

      // Auto-add the newly approved student to the group's chat. Upsert
      // (not create) so a student re-approved after a manual chat removal
      // simply rejoins as a regular MEMBER rather than erroring on the
      // unique (groupId, userId) constraint.
      await this.groupChatRepository.upsertRoomForGroup(request.groupId, tx);
      await this.groupChatRepository.upsertMember(
        request.groupId,
        request.studentId,
        'MEMBER',
        tx,
      );

      this.logger.log(
        `Approved enrollment request ${request.id} (group=${request.groupId} student=${request.studentId}) → enrollment ${enrollment.id}`,
      );
      return { enrollment, requestId: request.id };
    });
  }

  /**
   * Reject a pending enrollment request.
   *
   * Atomic in the same way as approve: status flip + outbox event in one tx.
   * Does NOT create or touch any Enrollment row.
   */
  async rejectRequest(
    teacherId: string,
    requestId: string,
  ): Promise<{ requestId: string }> {
    const request = await this.loadRequestForTeacher(teacherId, requestId);

    await this.prisma.$transaction(async (tx) => {
      const transitioned =
        await this.enrollmentRepository.transitionRequestStatus(
          request.id,
          'PENDING_APPROVAL',
          'REJECTED',
          teacherId,
          tx,
        );
      if (!transitioned) {
        throw new ConflictException({
          code: 'ENROLLMENT_REQUEST_INVALID_TRANSITION',
          message: 'Request is no longer pending approval',
        });
      }

      await this.outboxService.create(tx, {
        topic: 'enrollment.rejected',
        payload: {
          enrollmentRequestId: request.id,
          groupId: request.groupId,
          studentId: request.studentId,
          teacherId,
        },
        idempotencyKey: `enrollment.rejected:${request.id}`,
      });
    });

    this.logger.log(
      `Rejected enrollment request ${request.id} (group=${request.groupId} student=${request.studentId})`,
    );
    return { requestId: request.id };
  }

  // ------------------------------------------------------------------
  // Direct join request (student-initiated, no upfront payment)
  // ------------------------------------------------------------------

  /**
   * Create a direct enrollment request for the calling student.
   *
   * Flow:
   *   1. Validate the group exists.
   *   2. Reject if the student already has an APPROVED enrollment for it.
   *   3. Ensure a StudentProfile exists (FK target for the request).
   *   4. Upsert a PENDING_APPROVAL request (idempotent / re-appliable).
   *   5. Emit `enrollment.requested` so the teacher is notified.
   *
   * No payment is required: the teacher decides via the requests inbox.
   */
  async createRequest(
    studentId: string,
    dto: CreateEnrollmentRequestDto,
  ): Promise<{ requestId: string; status: 'PENDING_APPROVAL' }> {
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
      include: { course: true },
    });
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    // Already approved? Nothing to do — surface a clear conflict.
    const existingEnrollment = await this.enrollmentRepository.findEnrollment(
      dto.groupId,
      studentId,
    );
    if (existingEnrollment && existingEnrollment.status === 'APPROVED') {
      throw new ConflictException({
        code: 'ALREADY_ENROLLED',
        message: 'You are already enrolled in this group',
      });
    }

    const request = await this.prisma.$transaction(async (tx) => {
      await this.enrollmentRepository.ensureStudentProfile(
        studentId,
        'uz',
        tx,
      );

      const created = await this.enrollmentRepository.upsertPendingRequest(
        {
          groupId: dto.groupId,
          studentId,
          message: dto.message ?? null,
        },
        tx,
      );

      await this.outboxService.create(tx, {
        topic: 'enrollment.requested',
        payload: {
          enrollmentRequestId: created.id,
          groupId: dto.groupId,
          studentId,
          teacherId: group.course.teacherId,
        },
        idempotencyKey: `enrollment.requested:${created.id}`,
      });

      return created;
    });

    this.logger.log(
      `Enrollment request created: student=${studentId} group=${dto.groupId} → request ${request.id}`,
    );

    return { requestId: request.id, status: 'PENDING_APPROVAL' };
  }

  /** All enrollment requests submitted by the calling student (any status). */
  async listRequestsForStudent(studentId: string) {
    return this.enrollmentRepository.listRequestsByStudent(studentId);
  }

  // ------------------------------------------------------------------
  // List queries
  // ------------------------------------------------------------------

  /**
   * Pending requests across all groups owned by `teacherId`. Used by the
   * teacher's "/requests" inbox.
   */
  async listPendingRequestsForTeacher(teacherId: string) {
    const groups = await this.prisma.group.findMany({
      where: { course: { teacherId } },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);
    return this.enrollmentRepository.findPendingRequestsForGroups(groupIds);
  }

  /**
   * List all approved students across all groups owned by `teacherId`.
   */
  async listStudentsForTeacher(teacherId: string) {
    const groups = await this.prisma.group.findMany({
      where: { course: { teacherId } },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);
    return this.enrollmentRepository.findApprovedForGroups(groupIds);
  }

  async listEnrollmentsForStudent(studentId: string) {
    return this.enrollmentRepository.listApprovedByStudent(studentId);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Load an EnrollmentRequest and assert it belongs to a group owned by
   * `teacherId`. Throws 404 / 403 with the canonical error codes.
   */
  private async loadRequestForTeacher(teacherId: string, requestId: string) {
    const request = await this.prisma.enrollmentRequest.findUnique({
      where: { id: requestId },
      include: { group: { include: { course: true } } },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'ENROLLMENT_REQUEST_NOT_FOUND',
        message: 'Enrollment request not found',
      });
    }
    if (request.group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only decide on requests for your own groups',
      });
    }
    return request;
  }

  /**
   * Pure predicate: is this invite still usable right now?
   *
   * Logic (Req 5.7):
   *  - row must exist and be `isActive`
   *  - if `expiresAt` is set, it must be in the future
   *  - if `usesLimit` is set, `usesCount` must be strictly less than it
   */
  private isInviteUsable(invite: InviteLink): boolean {
    if (!invite.isActive) return false;
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    if (invite.usesLimit !== null && invite.usesCount >= invite.usesLimit) {
      return false;
    }
    return true;
  }

  /** Generate a URL-safe token (base64url, no padding). */
  private generateToken(): string {
    return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
  }

  private toCreatedInvite(invite: InviteLink): CreatedInvite {
    const appUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    return {
      id: invite.id,
      token: invite.token,
      url: `${appUrl.replace(/\/$/, '')}/i/${invite.token}`,
      groupId: invite.groupId,
      expiresAt: invite.expiresAt,
      usesLimit: invite.usesLimit,
      createdAt: invite.createdAt,
    };
  }
}
