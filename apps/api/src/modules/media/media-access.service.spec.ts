import { ForbiddenException } from '@nestjs/common';
import type { MediaAsset } from '@prisma/client';

import { MediaAccessService } from './media-access.service';

/**
 * Unit tests for MediaAccessService — Req 8.8 / 21.6.
 *
 * The rules the service enforces (mirrored on `LessonAccessGuard` for
 * consistency with Req 6.1 – 6.6):
 *
 *   1. Owner of the asset → allowed.
 *   2. ADMIN              → allowed (read-only audit).
 *   3. TEACHER who owns a lesson referencing the asset → allowed.
 *   4. STUDENT with APPROVED enrollment in a group whose lesson
 *      references the asset → allowed.
 *   5. Otherwise → 403 MEDIA_ACCESS_DENIED.
 *
 * The service queries both `Attachment` (lesson materials, Req 8.3) and
 * `Recording` (live-session recordings, Req 9.7) — both surfaces are
 * reached from the lesson player.
 */
describe('MediaAccessService', () => {
  const OWNER = 'teacher-owner';
  const OTHER_TEACHER = 'teacher-other';
  const STUDENT = 'student-1';
  const ADMIN = 'admin-1';
  const GROUP_ID = 'group-1';
  const ASSET_ID = 'asset-1';

  let prisma: any;
  let service: MediaAccessService;

  const assetByOwner = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
    ({
      id: ASSET_ID,
      ownerUserId: OWNER,
      kind: 'VIDEO',
      status: 'READY',
      bytes: BigInt(1024),
      contentType: 'video/mp4',
      originalKey: 'media/k',
      hlsManifestKey: null,
      thumbnailKey: null,
      durationMs: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as MediaAsset;

  beforeEach(() => {
    prisma = {
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
      recording: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null) },
      chatMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new MediaAccessService(prisma);
  });

  // -------------------------------------------------------------------
  // Owner fast-path (Req 8.8)
  // -------------------------------------------------------------------
  it('allows the asset owner without consulting attachment / enrollment tables', async () => {
    await expect(
      service.assertCanRead({ sub: OWNER, role: 'TEACHER' }, assetByOwner()),
    ).resolves.toBeUndefined();

    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
    expect(prisma.recording.findMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.findFirst).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // ADMIN read-only (Req 6.4 mirror)
  // -------------------------------------------------------------------
  it('allows ADMIN even when the asset has no lesson references (audit access)', async () => {
    await expect(
      service.assertCanRead({ sub: ADMIN, role: 'ADMIN' }, assetByOwner()),
    ).resolves.toBeUndefined();
    expect(prisma.attachment.findMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Teacher of a referencing lesson
  // -------------------------------------------------------------------
  it('allows TEACHER when they own a lesson that attaches the asset', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: OTHER_TEACHER } },
        },
      },
    ]);

    await expect(
      service.assertCanRead(
        { sub: OTHER_TEACHER, role: 'TEACHER' },
        assetByOwner(),
      ),
    ).resolves.toBeUndefined();
  });

  it('denies TEACHER who does not own any referencing lesson', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: 'teacher-z' } },
        },
      },
    ]);

    await expect(
      service.assertCanRead(
        { sub: OTHER_TEACHER, role: 'TEACHER' },
        assetByOwner(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // -------------------------------------------------------------------
  // Student with APPROVED enrollment
  // -------------------------------------------------------------------
  it('allows STUDENT with an APPROVED enrollment in a group whose lesson references the asset', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: OWNER } },
        },
      },
    ]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });

    await expect(
      service.assertCanRead({ sub: STUDENT, role: 'STUDENT' }, assetByOwner()),
    ).resolves.toBeUndefined();

    expect(prisma.enrollment.findFirst).toHaveBeenCalledWith({
      where: {
        studentId: STUDENT,
        status: 'APPROVED',
        groupId: { in: [GROUP_ID] },
      },
      select: { id: true },
    });
  });

  it('denies STUDENT when no approved enrollment matches a referencing group (Req 6.6 mirror)', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: OWNER } },
        },
      },
    ]);
    prisma.enrollment.findFirst.mockResolvedValue(null);

    await expect(
      service.assertCanRead({ sub: STUDENT, role: 'STUDENT' }, assetByOwner()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies STUDENT when the asset has no lesson references at all (orphan)', async () => {
    prisma.attachment.findMany.mockResolvedValue([]);
    prisma.recording.findMany.mockResolvedValue([]);

    await expect(
      service.assertCanRead({ sub: STUDENT, role: 'STUDENT' }, assetByOwner()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.enrollment.findFirst).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // Recording (live-session output) is accepted as a reference
  // -------------------------------------------------------------------
  it('treats Recording as a valid lesson reference (Req 9.7)', async () => {
    prisma.attachment.findMany.mockResolvedValue([]);
    prisma.recording.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: OWNER } },
        },
      },
    ]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });

    await expect(
      service.assertCanRead({ sub: STUDENT, role: 'STUDENT' }, assetByOwner()),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Defense in depth — unknown role
  // -------------------------------------------------------------------
  it('denies an unknown role even with a referencing lesson present', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: GROUP_ID,
          group: { course: { teacherId: OWNER } },
        },
      },
    ]);

    await expect(
      service.assertCanRead({ sub: 'x', role: 'GUEST' }, assetByOwner()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes the (groupId in [...]) filter for STUDENT covering all referencing groups (multiple lessons)', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      {
        lesson: {
          groupId: 'g-a',
          group: { course: { teacherId: OWNER } },
        },
      },
      {
        lesson: {
          groupId: 'g-b',
          group: { course: { teacherId: OWNER } },
        },
      },
    ]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e2' });

    await service.assertCanRead(
      { sub: STUDENT, role: 'STUDENT' },
      assetByOwner(),
    );

    const call = prisma.enrollment.findFirst.mock.calls[0][0];
    // Both groups must be considered; the dedupe set may reorder them.
    expect(call.where.groupId.in.sort()).toEqual(['g-a', 'g-b']);
  });
});
