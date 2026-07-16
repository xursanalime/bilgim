import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import { AdminProtectionController } from './protection-sessions.controller';
import {
  AdminProtectionSessionsService,
  maskEmail,
  maskName,
} from './protection-sessions.service';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000aa';
const VIEWER_ID = '11111111-1111-1111-1111-111111111111';
const ASSET_ID = '22222222-2222-2222-2222-222222222222';
const ENROLLMENT_ID = '33333333-3333-3333-3333-333333333333';
const SESSION_ID = '44444444-4444-4444-4444-444444444444';

/**
 * AdminProtectionSessionsService unit tests — content-protection-backend,
 * Task 4.2 (Req 6.3, 6.4).
 *
 * Coverage:
 *   - lookup by `viewerTag` resolves the recorded PlaybackSession back to
 *     the learner identity (masked email/name + enrollment + asset).
 *   - every lookup is written to the admin audit log (PII access).
 *   - an unknown marker returns an empty page (search) while an unknown
 *     id 404s (single-resource GET).
 *   - the anomaly-signal seam is a clearly-flagged dev no-op when no
 *     DRM_Provider is configured.
 *   - the controller is admin-only (@Roles('ADMIN') + JwtAuthGuard), so a
 *     non-admin caller is rejected by RBAC.
 */
describe('AdminProtectionSessionsService', () => {
  let service: AdminProtectionSessionsService;
  let prisma: any;
  let auditService: jest.Mocked<AdminAuditService>;
  let configService: { get: jest.Mock };

  const baseSession = {
    id: SESSION_ID,
    assetId: ASSET_ID,
    lessonId: null,
    viewerUserId: VIEWER_ID,
    enrollmentId: ENROLLMENT_ID,
    viewerTag: 'j***@e***.com • sess-1',
    drmKeySystem: 'widevine',
    ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    issuedAt: new Date('2024-01-01T00:00:00Z'),
    expiresAt: new Date('2024-01-01T00:05:00Z'),
  };

  const baseUser = {
    id: VIEWER_ID,
    email: 'jane.doe@example.com',
    fullName: 'Jane Doe',
    role: 'STUDENT',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    prisma = {
      playbackSession: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      user: { findMany: jest.fn() },
      enrollment: { findMany: jest.fn() },
      mediaAsset: { findMany: jest.fn() },
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Default: no DRM_Provider configured → dev fallback.
    configService = { get: jest.fn().mockReturnValue(undefined) };

    service = new AdminProtectionSessionsService(
      prisma,
      auditService,
      configService as any,
    );
  });

  // ==================================================================
  // Masking helpers
  // ==================================================================

  describe('masking helpers', () => {
    it('masks email and name for display', () => {
      expect(maskEmail('jane.doe@example.com')).toBe('j***@e***.com');
      expect(maskName('Jane Doe')).toBe('J*** D***');
      expect(maskName('   ')).toBe('***');
      expect(maskEmail('broken')).toBe('***@***');
    });
  });

  // ==================================================================
  // Lookup by viewerTag (Req 6.4)
  // ==================================================================

  describe('lookupSessions', () => {
    it('maps a viewerTag back to the learner identity and audit-logs the access', async () => {
      prisma.playbackSession.findMany.mockResolvedValue([baseSession]);
      prisma.playbackSession.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([baseUser]);
      prisma.enrollment.findMany.mockResolvedValue([
        { id: ENROLLMENT_ID, groupId: 'g1', status: 'APPROVED' },
      ]);
      prisma.mediaAsset.findMany.mockResolvedValue([
        { id: ASSET_ID, kind: 'VIDEO', status: 'READY' },
      ]);

      const result = await service.lookupSessions(
        ADMIN_ID,
        { viewerTag: baseSession.viewerTag },
        { ip: '127.0.0.1' },
      );

      expect(prisma.playbackSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { viewerTag: baseSession.viewerTag },
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);

      const row = result.items[0]!;
      expect(row.learner).toEqual({
        userId: VIEWER_ID,
        maskedEmail: 'j***@e***.com',
        maskedName: 'J*** D***',
        role: 'STUDENT',
        status: 'ACTIVE',
      });
      expect(row.enrollment).toEqual({
        id: ENROLLMENT_ID,
        groupId: 'g1',
        status: 'APPROVED',
      });
      expect(row.asset).toEqual({
        id: ASSET_ID,
        kind: 'VIDEO',
        status: 'READY',
      });
      // raw PII never leaks into the projection
      expect(JSON.stringify(row)).not.toContain('jane.doe@example.com');

      // PII access is audited — marker + match count, never resolved PII.
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
        'PlaybackSession/lookup',
        expect.objectContaining({
          filter: { viewerTag: baseSession.viewerTag },
          matched: 1,
        }),
        { ip: '127.0.0.1' },
      );
      const auditPayload = JSON.stringify(auditService.log.mock.calls[0]);
      expect(auditPayload).not.toContain('jane.doe@example.com');
    });

    it('returns an empty page for an unknown marker and still audit-logs', async () => {
      prisma.playbackSession.findMany.mockResolvedValue([]);
      prisma.playbackSession.count.mockResolvedValue(0);

      const result = await service.lookupSessions(ADMIN_ID, {
        viewerTag: 'no-such-tag',
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      // batch joins are skipped when there are no sessions
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
        'PlaybackSession/lookup',
        expect.objectContaining({ matched: 0 }),
        { ip: null },
      );
    });

    it('leaves learner null when the referenced user no longer exists', async () => {
      prisma.playbackSession.findMany.mockResolvedValue([
        { ...baseSession, enrollmentId: null },
      ]);
      prisma.playbackSession.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.mediaAsset.findMany.mockResolvedValue([]);

      const result = await service.lookupSessions(ADMIN_ID, {
        viewerUserId: VIEWER_ID,
      });

      expect(result.items[0]!.learner).toBeNull();
      expect(result.items[0]!.enrollment).toBeNull();
      // no enrollmentId on the session → enrollment lookup skipped
      expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Lookup by session id (Req 6.4)
  // ==================================================================

  describe('getSessionById', () => {
    it('resolves a single session by id', async () => {
      prisma.playbackSession.findUnique.mockResolvedValue(baseSession);
      prisma.user.findMany.mockResolvedValue([baseUser]);
      prisma.enrollment.findMany.mockResolvedValue([
        { id: ENROLLMENT_ID, groupId: 'g1', status: 'APPROVED' },
      ]);
      prisma.mediaAsset.findMany.mockResolvedValue([
        { id: ASSET_ID, kind: 'VIDEO', status: 'READY' },
      ]);

      const row = await service.getSessionById(ADMIN_ID, SESSION_ID, {
        ip: '127.0.0.1',
      });

      expect(row.session.id).toBe(SESSION_ID);
      expect(row.learner?.userId).toBe(VIEWER_ID);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
        `PlaybackSession/${SESSION_ID}`,
        expect.objectContaining({ sessionId: SESSION_ID, matched: 1 }),
        { ip: '127.0.0.1' },
      );
    });

    it('throws 404 for an unknown id and still audit-logs the attempt', async () => {
      prisma.playbackSession.findUnique.mockResolvedValue(null);

      await expect(
        service.getSessionById(ADMIN_ID, SESSION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.PROTECTION_SESSION_LOOKUP,
        `PlaybackSession/${SESSION_ID}`,
        expect.objectContaining({ matched: 0 }),
        { ip: null },
      );
    });
  });

  // ==================================================================
  // Provider anomaly seam (Req 6.3)
  // ==================================================================

  describe('ingestAnomalySignals', () => {
    it('accepts-and-drops as a dev no-op when no DRM_Provider is configured', async () => {
      const result = await service.ingestAnomalySignals(
        ADMIN_ID,
        {
          signals: [
            { kind: 'CONCURRENCY', viewerTag: 'tag-1', observedConcurrency: 3 },
            { kind: 'GEO_VELOCITY', assetId: ASSET_ID },
          ],
          source: 'unit-test',
        },
        { ip: '10.0.0.9' },
      );

      expect(result).toEqual({ accepted: 2, ingested: 0, devNoop: true });
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.PROTECTION_ANOMALY_INGESTED,
        'ProtectionAnomalySignals/ingest',
        expect.objectContaining({
          accepted: 2,
          devNoop: true,
          source: 'unit-test',
        }),
        { ip: '10.0.0.9' },
      );
    });

    it('flags devNoop false when a real provider is configured', async () => {
      configService.get.mockReturnValue('vdocipher');

      const result = await service.ingestAnomalySignals(ADMIN_ID, {
        signals: [{ kind: 'OTHER', sessionId: SESSION_ID }],
      });

      expect(result.devNoop).toBe(false);
    });
  });
});

/**
 * Authorization wiring — the controller must be admin-only so a
 * non-admin caller is rejected by the RBAC layer (Req 6.4, security).
 */
describe('AdminProtectionController (authorization)', () => {
  const reflector = new Reflector();

  it('requires the ADMIN role on the controller', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, AdminProtectionController);
    expect(roles).toEqual(['ADMIN']);
  });

  it('is protected by JwtAuthGuard', () => {
    const guards =
      Reflect.getMetadata('__guards__', AdminProtectionController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });
});
