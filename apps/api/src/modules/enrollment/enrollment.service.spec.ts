import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupChatRepository } from '../group-chat/repositories/group-chat.repository';
import {
  DEFAULT_INVITE_TTL_HOURS,
  DEFAULT_INVITE_USES_LIMIT,
  EnrollmentService,
} from './enrollment.service';
import { EnrollmentRepository } from './repositories/enrollment.repository';
import { InviteLinkRepository } from './repositories/invite-link.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = '00000000-0000-0000-0000-000000000099';
const GROUP_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

/**
 * EnrollmentService unit tests — Requirements 5.1 – 5.7.
 */
describe('EnrollmentService', () => {
  let service: EnrollmentService;
  let inviteLinkRepository: jest.Mocked<InviteLinkRepository>;
  let enrollmentRepository: jest.Mocked<EnrollmentRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let groupChatRepository: jest.Mocked<GroupChatRepository>;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    inviteLinkRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByToken: jest.fn(),
      listActiveByGroup: jest.fn(),
    } as any;

    enrollmentRepository = {
      findRequestById: jest.fn(),
      findPendingRequestsForGroups: jest.fn(),
      transitionRequestStatus: jest.fn(),
      findEnrollment: jest.fn(),
      upsertApprovedEnrollment: jest.fn(),
      listApprovedByStudent: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
    } as any;

    groupChatRepository = {
      upsertRoomForGroup: jest.fn().mockResolvedValue({ id: 'room-1', scopeRef: GROUP_ID, createdAt: new Date() }),
      upsertMember: jest.fn().mockResolvedValue({}),
    } as any;

    prisma = {
      group: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      enrollmentRequest: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) =>
        fn(prisma),
      ),
    };

    config = {
      get: jest.fn((key: string) =>
        key === 'APP_URL' ? 'https://app.example.com' : undefined,
      ),
    };

    service = new EnrollmentService(
      prisma,
      inviteLinkRepository,
      enrollmentRepository,
      outboxService,
      config,
      groupChatRepository,
    );
  });

  // ------------------------------------------------------------------
  // createInviteLink (Req 5.1)
  // ------------------------------------------------------------------

  describe('createInviteLink', () => {
    const groupRow = {
      id: GROUP_ID,
      name: 'Sefer guruhi',
      priceUzs: 200_000,
      capacity: 30,
      startsOn: null,
      endsOn: null,
      course: { teacherId: TEACHER_ID, title: 'IELTS' },
    };

    it('creates an invite with a base64url token, default TTL and uses limit', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      inviteLinkRepository.create.mockImplementation(async (input) => ({
        id: 'invite-1',
        groupId: input.groupId,
        token: input.token,
        createdById: input.createdById,
        expiresAt: input.expiresAt,
        usesLimit: input.usesLimit,
        usesCount: 0,
        isActive: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
      }));

      const before = Date.now();
      const result = await service.createInviteLink(TEACHER_ID, {
        groupId: GROUP_ID,
      });
      const after = Date.now();

      // Token must be URL-safe (base64url alphabet: A-Z a-z 0-9 _ -)
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.token.length).toBeGreaterThanOrEqual(30);

      // URL is APP_URL/i/<token> (no trailing slash duplication)
      expect(result.url).toBe(`https://app.example.com/i/${result.token}`);

      // Default TTL = 168h
      expect(result.expiresAt).not.toBeNull();
      const ts = result.expiresAt!.getTime();
      const expectedLow = before + DEFAULT_INVITE_TTL_HOURS * 3600 * 1000 - 500;
      const expectedHigh = after + DEFAULT_INVITE_TTL_HOURS * 3600 * 1000 + 500;
      expect(ts).toBeGreaterThanOrEqual(expectedLow);
      expect(ts).toBeLessThanOrEqual(expectedHigh);

      // Default uses limit = 100
      expect(result.usesLimit).toBe(DEFAULT_INVITE_USES_LIMIT);
    });

    it('honours custom expiresInHours and usesLimit', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      inviteLinkRepository.create.mockImplementation(async (input) => ({
        id: 'invite-1',
        groupId: input.groupId,
        token: input.token,
        createdById: input.createdById,
        expiresAt: input.expiresAt,
        usesLimit: input.usesLimit,
        usesCount: 0,
        isActive: true,
        createdAt: new Date(),
      }));

      const result = await service.createInviteLink(TEACHER_ID, {
        groupId: GROUP_ID,
        expiresInHours: 24,
        usesLimit: 5,
      });

      const ttlMs = result.expiresAt!.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(23 * 3600 * 1000);
      expect(ttlMs).toBeLessThan(25 * 3600 * 1000);
      expect(result.usesLimit).toBe(5);
    });

    it('passes null expiresAt and usesLimit through to the repository', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      inviteLinkRepository.create.mockResolvedValue({
        id: 'invite-1',
        groupId: GROUP_ID,
        token: 'tok',
        createdById: TEACHER_ID,
        expiresAt: null,
        usesLimit: null,
        usesCount: 0,
        isActive: true,
        createdAt: new Date(),
      } as any);

      await service.createInviteLink(TEACHER_ID, {
        groupId: GROUP_ID,
        expiresInHours: null,
        usesLimit: null,
      });

      expect(inviteLinkRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: null, usesLimit: null }),
      );
    });

    it('rejects cross-teacher group ownership with 403 NOT_OWNING_TEACHER', async () => {
      prisma.group.findUnique.mockResolvedValue({
        ...groupRow,
        course: { teacherId: OTHER_TEACHER_ID, title: 'IELTS' },
      });

      await expect(
        service.createInviteLink(TEACHER_ID, { groupId: GROUP_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(inviteLinkRepository.create).not.toHaveBeenCalled();
    });

    it('returns 404 GROUP_NOT_FOUND when the target group does not exist', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.createInviteLink(TEACHER_ID, { groupId: GROUP_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retries on a P2002 token collision then succeeds', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      inviteLinkRepository.create
        .mockRejectedValueOnce(p2002)
        .mockResolvedValueOnce({
          id: 'invite-1',
          groupId: GROUP_ID,
          token: 'unique-token',
          createdById: TEACHER_ID,
          expiresAt: null,
          usesLimit: null,
          usesCount: 0,
          isActive: true,
          createdAt: new Date(),
        } as any);

      const result = await service.createInviteLink(TEACHER_ID, {
        groupId: GROUP_ID,
      });
      expect(inviteLinkRepository.create).toHaveBeenCalledTimes(2);
      expect(result.token).toBe('unique-token');
    });

    it('gives up after the retry limit is exhausted and re-throws the last P2002', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      inviteLinkRepository.create.mockRejectedValue(p2002);

      await expect(
        service.createInviteLink(TEACHER_ID, { groupId: GROUP_ID }),
      ).rejects.toBe(p2002);
      // TOKEN_RETRY_LIMIT = 5 attempts
      expect(inviteLinkRepository.create).toHaveBeenCalledTimes(5);
    });

    it('does NOT retry on errors other than P2002 (immediate propagation)', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      const dbError = new Error('connection lost');
      inviteLinkRepository.create.mockRejectedValue(dbError);

      await expect(
        service.createInviteLink(TEACHER_ID, { groupId: GROUP_ID }),
      ).rejects.toBe(dbError);
      // No retry: only one attempt for non-P2002 errors.
      expect(inviteLinkRepository.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on a different Prisma error code (e.g. P2003)', async () => {
      prisma.group.findUnique.mockResolvedValue(groupRow);
      const fkError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key violation',
        { code: 'P2003', clientVersion: '5.0.0' },
      );
      inviteLinkRepository.create.mockRejectedValue(fkError);

      await expect(
        service.createInviteLink(TEACHER_ID, { groupId: GROUP_ID }),
      ).rejects.toBe(fkError);
      expect(inviteLinkRepository.create).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // resolveInvite (Req 5.2, 5.7)
  // ------------------------------------------------------------------

  describe('resolveInvite', () => {
    const usableInvite = {
      id: 'invite-1',
      token: 'abc',
      groupId: GROUP_ID,
      createdById: TEACHER_ID,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      usesLimit: 10,
      usesCount: 3,
      isActive: true,
      createdAt: new Date(),
    };

    const groupRow = {
      id: GROUP_ID,
      name: 'Sefer',
      priceUzs: 199_000,
      capacity: 50,
      startsOn: new Date('2024-02-01'),
      endsOn: new Date('2024-05-01'),
      course: {
        title: 'IELTS Speaking',
        teacher: {
          fullName: 'Sefer Aliyev',
          user: { fullName: 'Sefer User' },
        },
      },
    };

    it('returns a public group summary when the invite is usable (Req 5.2)', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue(usableInvite as any);
      prisma.group.findUnique.mockResolvedValue(groupRow);

      const result = await service.resolveInvite('abc');

      expect(result).toEqual({
        groupId: GROUP_ID,
        groupName: 'Sefer',
        courseTitle: 'IELTS Speaking',
        teacherName: 'Sefer Aliyev',
        priceUzs: 199_000,
        capacity: 50,
        startsOn: groupRow.startsOn,
        endsOn: groupRow.endsOn,
      });
    });

    it('falls back to user.fullName when teacher.fullName is null', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue(usableInvite as any);
      prisma.group.findUnique.mockResolvedValue({
        ...groupRow,
        course: {
          ...groupRow.course,
          teacher: { fullName: null, user: { fullName: 'Fallback Name' } },
        },
      });

      const result = await service.resolveInvite('abc');
      expect(result.teacherName).toBe('Fallback Name');
    });

    it('returns 404 INVITE_NOT_FOUND when token is unknown (Req 5.7)', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue(null);

      await expect(service.resolveInvite('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 when invite is inactive', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue({
        ...usableInvite,
        isActive: false,
      } as any);

      await expect(service.resolveInvite('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 when invite has expired', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue({
        ...usableInvite,
        expiresAt: new Date(Date.now() - 1000),
      } as any);

      await expect(service.resolveInvite('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns 404 when the uses limit is reached', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue({
        ...usableInvite,
        usesLimit: 5,
        usesCount: 5,
      } as any);

      await expect(service.resolveInvite('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('treats null expiresAt and null usesLimit as unbounded', async () => {
      inviteLinkRepository.findByToken.mockResolvedValue({
        ...usableInvite,
        expiresAt: null,
        usesLimit: null,
        usesCount: 9999,
      } as any);
      prisma.group.findUnique.mockResolvedValue(groupRow);

      await expect(service.resolveInvite('abc')).resolves.toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // approveRequest (Req 5.3, 5.4, 5.6)
  // ------------------------------------------------------------------

  describe('approveRequest', () => {
    const requestRow = {
      id: REQUEST_ID,
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'PENDING_APPROVAL' as const,
      invoiceId: 'invoice-1',
      group: { course: { teacherId: TEACHER_ID } },
    };

    it('approves: transitions request, creates Enrollment, emits outbox event', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue(requestRow);
      enrollmentRepository.transitionRequestStatus.mockResolvedValue(true);
      enrollmentRepository.upsertApprovedEnrollment.mockResolvedValue({
        id: 'enrollment-1',
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'APPROVED',
      } as any);

      const result = await service.approveRequest(TEACHER_ID, REQUEST_ID);

      expect(enrollmentRepository.transitionRequestStatus).toHaveBeenCalledWith(
        REQUEST_ID,
        'PENDING_APPROVAL',
        'APPROVED',
        TEACHER_ID,
        expect.anything(),
      );
      expect(enrollmentRepository.upsertApprovedEnrollment).toHaveBeenCalledWith(
        { groupId: GROUP_ID, studentId: STUDENT_ID, invoiceId: 'invoice-1' },
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'enrollment.approved',
          idempotencyKey: `enrollment.approved:${REQUEST_ID}`,
        }),
      );
      expect(result.enrollment.id).toBe('enrollment-1');
    });

    it('throws 403 NOT_OWNING_TEACHER for cross-teacher request', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue({
        ...requestRow,
        group: { course: { teacherId: OTHER_TEACHER_ID } },
      });

      await expect(
        service.approveRequest(TEACHER_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(enrollmentRepository.transitionRequestStatus).not.toHaveBeenCalled();
    });

    it('throws 404 ENROLLMENT_REQUEST_NOT_FOUND when missing', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.approveRequest(TEACHER_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 409 when the request is no longer pending', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue(requestRow);
      enrollmentRepository.transitionRequestStatus.mockResolvedValue(false);

      await expect(
        service.approveRequest(TEACHER_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(enrollmentRepository.upsertApprovedEnrollment).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('is idempotent at the data layer via upsert (Req 5.6)', async () => {
      // Even if approve runs twice (e.g. via queue retry) the upsert
      // returns the same row — this test asserts the service threads
      // through to upsertApprovedEnrollment and does not call create.
      prisma.enrollmentRequest.findUnique.mockResolvedValue(requestRow);
      enrollmentRepository.transitionRequestStatus.mockResolvedValue(true);
      enrollmentRepository.upsertApprovedEnrollment.mockResolvedValue({
        id: 'enrollment-existing',
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'APPROVED',
      } as any);

      const r = await service.approveRequest(TEACHER_ID, REQUEST_ID);
      expect(r.enrollment.id).toBe('enrollment-existing');
      // Also asserting we never call enrollment.create directly
      expect((enrollmentRepository as any).create).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // rejectRequest (Req 5.5)
  // ------------------------------------------------------------------

  describe('rejectRequest', () => {
    const requestRow = {
      id: REQUEST_ID,
      groupId: GROUP_ID,
      studentId: STUDENT_ID,
      status: 'PENDING_APPROVAL' as const,
      invoiceId: null,
      group: { course: { teacherId: TEACHER_ID } },
    };

    it('rejects: transitions request to REJECTED, emits outbox event, no Enrollment created', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue(requestRow);
      enrollmentRepository.transitionRequestStatus.mockResolvedValue(true);

      const result = await service.rejectRequest(TEACHER_ID, REQUEST_ID);

      expect(enrollmentRepository.transitionRequestStatus).toHaveBeenCalledWith(
        REQUEST_ID,
        'PENDING_APPROVAL',
        'REJECTED',
        TEACHER_ID,
        expect.anything(),
      );
      expect(
        enrollmentRepository.upsertApprovedEnrollment,
      ).not.toHaveBeenCalled();
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'enrollment.rejected',
          idempotencyKey: `enrollment.rejected:${REQUEST_ID}`,
        }),
      );
      expect(result.requestId).toBe(REQUEST_ID);
    });

    it('rejects 403 for cross-teacher request', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue({
        ...requestRow,
        group: { course: { teacherId: OTHER_TEACHER_ID } },
      });

      await expect(
        service.rejectRequest(TEACHER_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 409 when transition precondition fails', async () => {
      prisma.enrollmentRequest.findUnique.mockResolvedValue(requestRow);
      enrollmentRepository.transitionRequestStatus.mockResolvedValue(false);

      await expect(
        service.rejectRequest(TEACHER_ID, REQUEST_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // listPendingRequestsForTeacher
  // ------------------------------------------------------------------

  describe('listPendingRequestsForTeacher', () => {
    it('returns an empty list early when the teacher owns no groups', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      enrollmentRepository.findPendingRequestsForGroups.mockResolvedValue([]);

      const result = await service.listPendingRequestsForTeacher(TEACHER_ID);

      expect(result).toEqual([]);
      expect(
        enrollmentRepository.findPendingRequestsForGroups,
      ).toHaveBeenCalledWith([]);
    });

    it("scopes the query to the teacher's owned groups only", async () => {
      prisma.group.findMany.mockResolvedValue([
        { id: 'group-1' },
        { id: 'group-2' },
      ]);
      const pendingRows = [
        {
          id: 'req-1',
          groupId: 'group-1',
          studentId: STUDENT_ID,
          status: 'PENDING_APPROVAL',
        },
      ];
      enrollmentRepository.findPendingRequestsForGroups.mockResolvedValue(
        pendingRows as any,
      );

      const result = await service.listPendingRequestsForTeacher(TEACHER_ID);

      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: { course: { teacherId: TEACHER_ID } },
        select: { id: true },
      });
      expect(
        enrollmentRepository.findPendingRequestsForGroups,
      ).toHaveBeenCalledWith(['group-1', 'group-2']);
      expect(result).toBe(pendingRows);
    });
  });

  // ------------------------------------------------------------------
  // listEnrollmentsForStudent
  // ------------------------------------------------------------------

  describe('listEnrollmentsForStudent', () => {
    it("delegates to the repository's APPROVED-only finder", async () => {
      const rows = [
        { id: 'e1', studentId: STUDENT_ID, status: 'APPROVED' },
      ];
      enrollmentRepository.listApprovedByStudent.mockResolvedValue(rows as any);

      const result = await service.listEnrollmentsForStudent(STUDENT_ID);

      expect(enrollmentRepository.listApprovedByStudent).toHaveBeenCalledWith(
        STUDENT_ID,
      );
      expect(result).toBe(rows);
    });
  });
});
