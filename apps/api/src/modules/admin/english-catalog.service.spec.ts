import { ConflictException, NotFoundException } from '@nestjs/common';

import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import {
  AdminEnglishCatalogService,
  MODULE_CATALOG_SETTING_KEY,
} from './english-catalog.service';

const ADMIN_ID = '00000000-0000-0000-0000-0000000000aa';
const TRACK_ID = '11111111-1111-1111-1111-111111111111';

/**
 * AdminEnglishCatalogService unit tests — English-Only Platform Refocus,
 * Task 7.1 (Req 17.1 – 17.4).
 *
 * Coverage:
 *   - Exam_Track CRUD: list ordering, create (+ slug-clash 409),
 *     activate / deactivate, audit row per change.
 *   - Global 8-skill catalog: list defaults to all-enabled, disable adds
 *     to the persisted set, enable removes it, and disabling NEVER reads
 *     or writes Submission / Assignment / GroupModule rows (Req 17.3).
 *   - Every mutation writes exactly one audit-log entry (Req 17.4).
 */
describe('AdminEnglishCatalogService', () => {
  let service: AdminEnglishCatalogService;
  let prisma: any;
  let auditService: jest.Mocked<AdminAuditService>;

  // A $transaction mock that runs the callback with the same prisma stub
  // so audit writes inside the txn are observable on the same mocks.
  const runTransaction = (cb: any) => cb(prisma);

  beforeEach(() => {
    prisma = {
      examTrack: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      systemSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      // Models that MUST NOT be touched when disabling a skill — present
      // on the stub so we can assert they are never called (Req 17.3).
      submission: {
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      assignment: {
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      assignmentModule: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      groupModule: {
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(runTransaction),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new AdminEnglishCatalogService(prisma, auditService);
  });

  // ==================================================================
  // Exam_Track CRUD (Req 17.1)
  // ==================================================================

  describe('listExamTracks', () => {
    it('returns tracks ordered active-first then by slug', async () => {
      prisma.examTrack.findMany.mockResolvedValue([]);

      await service.listExamTracks();

      expect(prisma.examTrack.findMany).toHaveBeenCalledWith({
        orderBy: [{ isActive: 'desc' }, { slug: 'asc' }],
      });
    });
  });

  describe('createExamTrack', () => {
    it('creates the track and writes a single audit row', async () => {
      prisma.examTrack.findUnique.mockResolvedValue(null);
      prisma.examTrack.create.mockResolvedValue({
        id: TRACK_ID,
        slug: 'ielts',
        name: 'IELTS',
        isActive: true,
      });

      const result = await service.createExamTrack(
        ADMIN_ID,
        { slug: 'ielts', name: 'IELTS' },
        { ip: '127.0.0.1' },
      );

      expect(prisma.examTrack.create).toHaveBeenCalledWith({
        data: { slug: 'ielts', name: 'IELTS' },
      });
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.EXAM_TRACK_CREATED,
        `ExamTrack/${TRACK_ID}`,
        expect.objectContaining({ examTrackId: TRACK_ID, slug: 'ielts' }),
        { ip: '127.0.0.1' },
        prisma,
      );
      expect(result.slug).toBe('ielts');
    });

    it('rejects a duplicate slug with 409 and writes no audit row', async () => {
      prisma.examTrack.findUnique.mockResolvedValue({ id: TRACK_ID });

      await expect(
        service.createExamTrack(ADMIN_ID, { slug: 'ielts', name: 'IELTS' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.examTrack.create).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('updateExamTrack', () => {
    it('records EXAM_TRACK_DEACTIVATED when toggling isActive false', async () => {
      prisma.examTrack.findUnique.mockResolvedValue({
        id: TRACK_ID,
        slug: 'ielts',
        name: 'IELTS',
        isActive: true,
      });
      prisma.examTrack.update.mockResolvedValue({
        id: TRACK_ID,
        slug: 'ielts',
        name: 'IELTS',
        isActive: false,
      });

      await service.updateExamTrack(ADMIN_ID, TRACK_ID, { isActive: false });

      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.EXAM_TRACK_DEACTIVATED,
        `ExamTrack/${TRACK_ID}`,
        expect.objectContaining({
          examTrackId: TRACK_ID,
          changes: expect.objectContaining({
            isActive: { from: true, to: false },
          }),
        }),
        { ip: null },
        prisma,
      );
    });

    it('records EXAM_TRACK_ACTIVATED when toggling isActive true', async () => {
      prisma.examTrack.findUnique.mockResolvedValue({
        id: TRACK_ID,
        slug: 'ielts',
        name: 'IELTS',
        isActive: false,
      });
      prisma.examTrack.update.mockResolvedValue({
        id: TRACK_ID,
        slug: 'ielts',
        name: 'IELTS',
        isActive: true,
      });

      await service.updateExamTrack(ADMIN_ID, TRACK_ID, { isActive: true });

      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.EXAM_TRACK_ACTIVATED,
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        prisma,
      );
    });

    it('throws 404 when the track does not exist', async () => {
      prisma.examTrack.findUnique.mockResolvedValue(null);

      await expect(
        service.updateExamTrack(ADMIN_ID, TRACK_ID, { isActive: false }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.examTrack.update).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Global 8-skill catalog (Req 17.2, 17.3)
  // ==================================================================

  describe('listModuleCatalog', () => {
    it('defaults to all eight skills enabled when no setting is persisted', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.listModuleCatalog();

      expect(result).toHaveLength(8);
      expect(result.every((e) => e.enabled)).toBe(true);
    });

    it('reflects persisted disabled skills', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { disabled: ['SPEAKING'] },
      });

      const result = await service.listModuleCatalog();

      const speaking = result.find((e) => e.moduleType === 'SPEAKING');
      const writing = result.find((e) => e.moduleType === 'WRITING');
      expect(speaking?.enabled).toBe(false);
      expect(writing?.enabled).toBe(true);
    });
  });

  describe('setModuleEnabled', () => {
    it('disabling a skill persists it to the setting and writes one audit row', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue(null);

      const result = await service.setModuleEnabled(
        ADMIN_ID,
        'SPEAKING' as any,
        false,
        { ip: '10.0.0.1' },
      );

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: MODULE_CATALOG_SETTING_KEY },
          create: expect.objectContaining({
            key: MODULE_CATALOG_SETTING_KEY,
            value: { disabled: ['SPEAKING'] },
          }),
          update: { value: { disabled: ['SPEAKING'] } },
        }),
      );
      expect(auditService.log).toHaveBeenCalledTimes(1);
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.MODULE_CATALOG_DISABLED,
        'EnglishModuleCatalog/SPEAKING',
        expect.objectContaining({ moduleType: 'SPEAKING', enabled: false }),
        { ip: '10.0.0.1' },
        prisma,
      );
      expect(result).toEqual({ moduleType: 'SPEAKING', enabled: false });
    });

    it('disabling a skill NEVER touches Submission/Assignment/GroupModule rows (Req 17.3)', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { disabled: [] },
      });

      await service.setModuleEnabled(ADMIN_ID, 'WRITING' as any, false);

      // Non-destructive: no historical work is read or mutated.
      for (const model of [
        prisma.submission,
        prisma.assignment,
        prisma.assignmentModule,
        prisma.groupModule,
      ]) {
        for (const fn of Object.values(model)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    });

    it('enabling a previously-disabled skill removes it from the set', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({
        value: { disabled: ['SPEAKING', 'WRITING'] },
      });

      await service.setModuleEnabled(ADMIN_ID, 'SPEAKING' as any, true);

      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { value: { disabled: ['WRITING'] } },
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        ADMIN_ID,
        AUDIT_ACTIONS.MODULE_CATALOG_ENABLED,
        'EnglishModuleCatalog/SPEAKING',
        expect.objectContaining({ enabled: true }),
        { ip: null },
        prisma,
      );
    });

    it('rejects a Legacy_Module_Type with MODULE_TYPE_NOT_SUPPORTED', async () => {
      await expect(
        service.setModuleEnabled(ADMIN_ID, 'MULTIPLE_CHOICE' as any, false),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
