import { ConflictException, NotFoundException } from '@nestjs/common';
import { HomeworkModuleType, Prisma, SpecialtyModule } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import {
  HomeworkService,
  SPECIALTY_MODULE_ACTIVE_CAP,
} from './homework.service';
import { SpecialtyModuleRepository } from './repositories/specialty-module.repository';

const SPECIALTY_ID = '00000000-0000-0000-0000-000000000010';
const TEACHER_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';

function buildSpecialtyModuleRow(
  overrides: Partial<SpecialtyModule>,
): SpecialtyModule {
  return {
    specialtyId: SPECIALTY_ID,
    moduleType: 'WRITING',
    isActive: true,
    defaultEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SpecialtyModule;
}

/**
 * HomeworkService unit tests — Task 17.1, Requirements 11.1 and 11.7.
 *
 * Focus:
 *   - Cap pre-check: exactly 10 active rows is allowed; an 11th flips into
 *     a 409 SPECIALTY_MODULE_CAP_EXCEEDED before any DB write.
 *   - Concurrency safety: a DB trigger violation (raw RAISE EXCEPTION
 *     surfacing through Prisma) is mapped to the same 409.
 *   - Sparse upsert semantics: rows not listed are left alone, the cap
 *     pre-check accounts for both flips ON and flips OFF.
 *   - Listing branches: admin full mapping, teacher-by-onboarding,
 *     admin-by-specialty.
 */
describe('HomeworkService', () => {
  let service: HomeworkService;
  let prisma: any;
  let specialtyModuleRepository: jest.Mocked<SpecialtyModuleRepository>;
  let specialtyService: jest.Mocked<SpecialtyService>;
  let teacherProfileRepository: jest.Mocked<TeacherProfileRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let txClient: any;

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };

    specialtyModuleRepository = {
      listBySpecialty: jest.fn(),
      listActiveBySpecialty: jest.fn(),
      countActiveBySpecialty: jest.fn(),
      findOne: jest.fn(),
      upsert: jest.fn(),
    } as any;

    specialtyService = {
      getById: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      listActive: jest.fn(),
      listActiveModules: jest.fn(),
    } as any;

    teacherProfileRepository = {
      findByUserId: jest.fn(),
      upsert: jest.fn(),
      markOnboardingComplete: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;

    service = new HomeworkService(
      prisma,
      specialtyModuleRepository,
      specialtyService,
      teacherProfileRepository,
      outboxService,
    );
  });

  // ==================================================================
  // listSpecialtyModulesForAdmin
  // ==================================================================

  describe('listSpecialtyModulesForAdmin', () => {
    it('returns the full row list ordered by moduleType', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const rows = [
        buildSpecialtyModuleRow({ moduleType: 'READING', isActive: true }),
        buildSpecialtyModuleRow({ moduleType: 'WRITING', isActive: false }),
      ];
      specialtyModuleRepository.listBySpecialty.mockResolvedValue(rows);

      const result =
        await service.listSpecialtyModulesForAdmin(SPECIALTY_ID);

      expect(specialtyService.getById).toHaveBeenCalledWith(SPECIALTY_ID);
      expect(result).toEqual(rows);
    });

    it('lets the SpecialtyService 404 propagate when the specialty is missing', async () => {
      specialtyService.getById.mockRejectedValue(
        new NotFoundException({
          code: 'SPECIALTY_NOT_FOUND',
          message: 'gone',
        }),
      );

      await expect(
        service.listSpecialtyModulesForAdmin(SPECIALTY_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        specialtyModuleRepository.listBySpecialty,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // bulkUpsertSpecialtyModules — cap enforcement (Req 11.1, 11.7)
  // ==================================================================

  describe('bulkUpsertSpecialtyModules', () => {
    it('upserts each input row when projected active count <= cap', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      // Empty start state → flipping 3 modules to active stays well under cap.
      specialtyModuleRepository.listBySpecialty
        .mockResolvedValueOnce([]) // pre-check inside tx
        .mockResolvedValueOnce(
          (
            ['WRITING', 'READING', 'GRAMMAR'] as HomeworkModuleType[]
          ).map((moduleType) =>
            buildSpecialtyModuleRow({ moduleType, isActive: true }),
          ),
        ); // post-write read
      specialtyModuleRepository.upsert.mockImplementation(
        async (input) =>
          buildSpecialtyModuleRow({
            moduleType: input.moduleType,
            isActive: input.isActive,
            defaultEnabled: input.defaultEnabled ?? false,
          }),
      );

      const result = await service.bulkUpsertSpecialtyModules(
        SPECIALTY_ID,
        {
          modules: [
            { moduleType: 'WRITING', isActive: true, defaultEnabled: true },
            { moduleType: 'READING', isActive: true },
            { moduleType: 'GRAMMAR', isActive: true, defaultEnabled: false },
          ],
        },
        ADMIN_ID,
      );

      expect(specialtyModuleRepository.upsert).toHaveBeenCalledTimes(3);
      expect(specialtyModuleRepository.upsert).toHaveBeenNthCalledWith(
        1,
        {
          specialtyId: SPECIALTY_ID,
          moduleType: 'WRITING',
          isActive: true,
          defaultEnabled: true,
        },
        txClient,
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({
          topic: 'specialty.modules.updated',
          payload: expect.objectContaining({
            specialtyId: SPECIALTY_ID,
            actorUserId: ADMIN_ID,
          }),
        }),
      );
      expect(result).toHaveLength(3);
    });

    it('allows exactly 10 active rows (boundary)', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      // Start with 9 active rows; the upsert flips a 10th into ON.
      const initialActive = (
        [
          'WRITING',
          'READING',
          'LISTENING',
          'GRAMMAR',
          'SPELLING',
          'VOCABULARY',
          'SPEAKING',
          'PRONUNCIATION',
          'MULTIPLE_CHOICE',
        ] as HomeworkModuleType[]
      ).map((m) => buildSpecialtyModuleRow({ moduleType: m, isActive: true }));
      specialtyModuleRepository.listBySpecialty
        .mockResolvedValueOnce(initialActive)
        .mockResolvedValueOnce([
          ...initialActive,
          buildSpecialtyModuleRow({ moduleType: 'GAP_FILL', isActive: true }),
        ]);
      specialtyModuleRepository.upsert.mockResolvedValue(
        buildSpecialtyModuleRow({ moduleType: 'GAP_FILL', isActive: true }),
      );

      const result = await service.bulkUpsertSpecialtyModules(
        SPECIALTY_ID,
        { modules: [{ moduleType: 'GAP_FILL', isActive: true }] },
        ADMIN_ID,
      );

      expect(result).toHaveLength(SPECIALTY_MODULE_ACTIVE_CAP);
      expect(specialtyModuleRepository.upsert).toHaveBeenCalledTimes(1);
    });

    it('throws SPECIALTY_MODULE_CAP_EXCEEDED before any upsert when projected > 10', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const initialActive = (
        [
          'WRITING',
          'READING',
          'LISTENING',
          'GRAMMAR',
          'SPELLING',
          'VOCABULARY',
          'SPEAKING',
          'PRONUNCIATION',
          'MULTIPLE_CHOICE',
          'GAP_FILL',
        ] as HomeworkModuleType[]
      ).map((m) => buildSpecialtyModuleRow({ moduleType: m, isActive: true }));
      specialtyModuleRepository.listBySpecialty.mockResolvedValueOnce(
        initialActive,
      );

      await expect(
        service.bulkUpsertSpecialtyModules(
          SPECIALTY_ID,
          { modules: [{ moduleType: 'MATCHING', isActive: true }] },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SPECIALTY_MODULE_CAP_EXCEEDED',
        }),
      });
      expect(specialtyModuleRepository.upsert).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('counts existing active rows correctly when the same row is being kept active', async () => {
      // Edge case: input lists a row that is already active. The pre-check
      // must NOT double-count it as a new flip-on.
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const initialActive = (
        [
          'WRITING',
          'READING',
          'LISTENING',
          'GRAMMAR',
          'SPELLING',
          'VOCABULARY',
          'SPEAKING',
          'PRONUNCIATION',
          'MULTIPLE_CHOICE',
          'GAP_FILL',
        ] as HomeworkModuleType[]
      ).map((m) => buildSpecialtyModuleRow({ moduleType: m, isActive: true }));
      specialtyModuleRepository.listBySpecialty
        .mockResolvedValueOnce(initialActive)
        .mockResolvedValueOnce(initialActive);
      specialtyModuleRepository.upsert.mockResolvedValue(initialActive[0]!);

      const result = await service.bulkUpsertSpecialtyModules(
        SPECIALTY_ID,
        {
          modules: [
            // Already active — no count change, must succeed at the cap.
            { moduleType: 'WRITING', isActive: true, defaultEnabled: true },
          ],
        },
        ADMIN_ID,
      );

      expect(result).toEqual(initialActive);
      expect(specialtyModuleRepository.upsert).toHaveBeenCalledTimes(1);
    });

    it('flipping a row off frees a slot for another row in the same batch', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const initialActive = (
        [
          'WRITING',
          'READING',
          'LISTENING',
          'GRAMMAR',
          'SPELLING',
          'VOCABULARY',
          'SPEAKING',
          'PRONUNCIATION',
          'MULTIPLE_CHOICE',
          'GAP_FILL',
        ] as HomeworkModuleType[]
      ).map((m) => buildSpecialtyModuleRow({ moduleType: m, isActive: true }));
      specialtyModuleRepository.listBySpecialty
        .mockResolvedValueOnce(initialActive)
        .mockResolvedValueOnce(initialActive);
      specialtyModuleRepository.upsert.mockResolvedValue(initialActive[0]!);

      // Flip WRITING off (frees a slot) and add MATCHING on. Net active = 10.
      await expect(
        service.bulkUpsertSpecialtyModules(
          SPECIALTY_ID,
          {
            modules: [
              { moduleType: 'WRITING', isActive: false },
              { moduleType: 'MATCHING', isActive: true },
            ],
          },
          ADMIN_ID,
        ),
      ).resolves.toBeDefined();

      expect(specialtyModuleRepository.upsert).toHaveBeenCalledTimes(2);
    });

    it('maps a DB trigger RAISE to a 409 SPECIALTY_MODULE_CAP_EXCEEDED', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      // Service-level check thinks projected = 10 (legal), but a concurrent
      // admin write between the count and the upsert pushes the trigger
      // total to 11. Simulate by making the upsert throw the trigger error.
      const initialActive = (
        [
          'WRITING',
          'READING',
          'LISTENING',
          'GRAMMAR',
          'SPELLING',
          'VOCABULARY',
          'SPEAKING',
          'PRONUNCIATION',
          'MULTIPLE_CHOICE',
        ] as HomeworkModuleType[]
      ).map((m) => buildSpecialtyModuleRow({ moduleType: m, isActive: true }));
      specialtyModuleRepository.listBySpecialty.mockResolvedValueOnce(
        initialActive,
      );

      const triggerError = new Prisma.PrismaClientUnknownRequestError(
        'specialty_module_cap_exceeded: max 10 active modules per specialty',
        { clientVersion: 'test' },
      );
      specialtyModuleRepository.upsert.mockRejectedValue(triggerError);

      await expect(
        service.bulkUpsertSpecialtyModules(
          SPECIALTY_ID,
          { modules: [{ moduleType: 'GAP_FILL', isActive: true }] },
          ADMIN_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SPECIALTY_MODULE_CAP_EXCEEDED',
        }),
      });
    });

    it('returns the current catalog without any upsert when modules array is empty', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const current = [
        buildSpecialtyModuleRow({ moduleType: 'WRITING', isActive: true }),
      ];
      specialtyModuleRepository.listBySpecialty.mockResolvedValue(current);

      const result = await service.bulkUpsertSpecialtyModules(
        SPECIALTY_ID,
        { modules: [] },
        ADMIN_ID,
      );

      expect(result).toEqual(current);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(specialtyModuleRepository.upsert).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // listActiveModulesForTeacher
  // ==================================================================

  describe('listActiveModulesForTeacher', () => {
    it('returns the active catalog for the teacher specialty', async () => {
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: SPECIALTY_ID,
      } as any);
      const rows = [
        buildSpecialtyModuleRow({ moduleType: 'WRITING', isActive: true }),
      ];
      specialtyModuleRepository.listActiveBySpecialty.mockResolvedValue(rows);

      const result = await service.listActiveModulesForTeacher(TEACHER_ID);

      expect(
        specialtyModuleRepository.listActiveBySpecialty,
      ).toHaveBeenCalledWith(SPECIALTY_ID);
      expect(result).toEqual(rows);
    });

    it('throws ONBOARDING_REQUIRED when the teacher has no profile', async () => {
      teacherProfileRepository.findByUserId.mockResolvedValue(null);

      await expect(
        service.listActiveModulesForTeacher(TEACHER_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }),
      });
    });

    it('throws ONBOARDING_REQUIRED when the teacher has no specialty assigned', async () => {
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: null,
      } as any);

      await expect(
        service.listActiveModulesForTeacher(TEACHER_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }),
      });
      expect(
        specialtyModuleRepository.listActiveBySpecialty,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // listActiveModulesBySpecialty (admin-only branch)
  // ==================================================================

  describe('listActiveModulesBySpecialty', () => {
    it('returns the active catalog for an explicit specialtyId', async () => {
      specialtyService.getById.mockResolvedValue({ id: SPECIALTY_ID } as any);
      const rows = [
        buildSpecialtyModuleRow({ moduleType: 'READING', isActive: true }),
      ];
      specialtyModuleRepository.listActiveBySpecialty.mockResolvedValue(rows);

      const result =
        await service.listActiveModulesBySpecialty(SPECIALTY_ID);

      expect(specialtyService.getById).toHaveBeenCalledWith(SPECIALTY_ID);
      expect(result).toEqual(rows);
    });
  });
});
