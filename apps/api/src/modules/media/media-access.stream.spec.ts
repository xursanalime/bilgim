import { ForbiddenException } from '@nestjs/common';
import type { MediaAsset } from '@prisma/client';

import { MediaAccessService } from './media-access.service';

/**
 * Unit tests for MediaAccessService.resolveStreamAccess — Task 3.1
 * (content-protection-backend Req 4.1 – 4.4, Property 3).
 *
 * The method makes two server-side decisions:
 *   1. Entitlement gate (reuses assertCanRead) — non-entitled → 403.
 *   2. Download_Permission — attachment vs inline, derived purely from
 *      the owning group's `downloadAllowed`, never from client input.
 */
describe('MediaAccessService.resolveStreamAccess', () => {
  const OWNER = 'teacher-owner';
  const OTHER_TEACHER = 'teacher-other';
  const STUDENT = 'student-1';
  const ADMIN = 'admin-1';
  const GROUP_ID = 'group-1';
  const ASSET_ID = 'asset-1';

  let prisma: any;
  let service: MediaAccessService;

  const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
    ({
      id: ASSET_ID,
      ownerUserId: OWNER,
      kind: 'PDF',
      status: 'UPLOADED',
      bytes: BigInt(1024),
      contentType: 'application/pdf',
      originalKey: 'media/k.pdf',
      hlsManifestKey: null,
      thumbnailKey: null,
      durationMs: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as MediaAsset;

  const attachmentRef = (downloadAllowed: boolean, teacherId = OWNER) => ({
    lesson: {
      groupId: GROUP_ID,
      group: {
        downloadAllowed,
        course: { teacherId },
      },
    },
  });

  beforeEach(() => {
    prisma = {
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
      recording: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new MediaAccessService(prisma);
  });

  it('denies a non-entitled student with 403 (Req 4.1/4.4)', async () => {
    prisma.attachment.findMany.mockResolvedValue([attachmentRef(true)]);
    prisma.enrollment.findFirst.mockResolvedValue(null); // not enrolled

    await expect(
      service.resolveStreamAccess({ sub: STUDENT, role: 'STUDENT' }, asset()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the asset owner to download (downloadAllowed=true)', async () => {
    await expect(
      service.resolveStreamAccess({ sub: OWNER, role: 'TEACHER' }, asset()),
    ).resolves.toEqual({ downloadAllowed: true });
  });

  it('allows ADMIN to download (downloadAllowed=true)', async () => {
    await expect(
      service.resolveStreamAccess({ sub: ADMIN, role: 'ADMIN' }, asset()),
    ).resolves.toEqual({ downloadAllowed: true });
  });

  it('allows the owning teacher to download even if the group disables it', async () => {
    prisma.attachment.findMany.mockResolvedValue([
      attachmentRef(false, OTHER_TEACHER),
    ]);

    await expect(
      service.resolveStreamAccess(
        { sub: OTHER_TEACHER, role: 'TEACHER' },
        asset(),
      ),
    ).resolves.toEqual({ downloadAllowed: true });
  });

  it('returns downloadAllowed=false for an entitled student when the group disables downloads (Req 4.2)', async () => {
    prisma.attachment.findMany.mockResolvedValue([attachmentRef(false)]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' }); // entitled
    prisma.enrollment.findMany.mockResolvedValue([{ groupId: GROUP_ID }]);

    await expect(
      service.resolveStreamAccess({ sub: STUDENT, role: 'STUDENT' }, asset()),
    ).resolves.toEqual({ downloadAllowed: false });
  });

  it('returns downloadAllowed=true for an entitled student when the group enables downloads (Req 4.3)', async () => {
    prisma.attachment.findMany.mockResolvedValue([attachmentRef(true)]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.enrollment.findMany.mockResolvedValue([{ groupId: GROUP_ID }]);

    await expect(
      service.resolveStreamAccess({ sub: STUDENT, role: 'STUDENT' }, asset()),
    ).resolves.toEqual({ downloadAllowed: true });
  });

  it('ignores group downloadAllowed for groups the student is NOT enrolled in (Property 3)', async () => {
    // Asset referenced by two groups; the download-enabled one is one the
    // student is NOT enrolled in. The student must stay inline-only.
    prisma.attachment.findMany.mockResolvedValue([
      attachmentRef(false), // GROUP_ID — enrolled, downloads disabled
      {
        lesson: {
          groupId: 'group-2',
          group: { downloadAllowed: true, course: { teacherId: OWNER } },
        },
      },
    ]);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' }); // entitled via GROUP_ID
    prisma.enrollment.findMany.mockResolvedValue([{ groupId: GROUP_ID }]);

    await expect(
      service.resolveStreamAccess({ sub: STUDENT, role: 'STUDENT' }, asset()),
    ).resolves.toEqual({ downloadAllowed: false });
  });
});
