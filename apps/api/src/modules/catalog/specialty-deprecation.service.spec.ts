import { CatalogService } from './catalog.service';

/**
 * Req 2.3 — `specialtyId` deprecation shim, service-side behavior (Task 6.3).
 *
 * The request DTOs (CreateCourse/CreateGroup) now accept an optional, legacy
 * `specialtyId`. This suite proves the value is IGNORED server-side: it is
 * never persisted on a Course and never overrides the seeding source for a
 * Group (which derives from the teacher's own profile specialty).
 *
 * This lives in its own spec (rather than catalog.service.spec.ts) so the
 * assertions run independently — the shared spec carries unrelated mock-shape
 * coupling to the evolving Course model.
 *
 * Mocks are intentionally typed loosely (`as any`) so the tests stay robust
 * against additive Course/Group schema changes from sibling tasks.
 */
const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const PROFILE_SPECIALTY_ID = '11111111-1111-1111-1111-111111111111';
const LEGACY_BODY_SPECIALTY_ID = '99999999-9999-9999-9999-999999999999';

describe('CatalogService — specialtyId deprecation shim (Req 2.3)', () => {
  let service: CatalogService;
  let courseRepository: any;
  let groupRepository: any;
  let groupModuleRepository: any;
  let lessonRepository: any;
  let teacherProfileRepository: any;
  let specialtyService: any;
  let billingService: any;
  let outboxService: any;
  let prisma: any;

  beforeEach(() => {
    courseRepository = { create: jest.fn() };
    groupRepository = { create: jest.fn() };
    groupModuleRepository = { seedForGroup: jest.fn() };
    lessonRepository = {};
    teacherProfileRepository = { findByUserId: jest.fn() };
    specialtyService = { listActiveModules: jest.fn() };
    billingService = {};
    outboxService = {};
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ email: 'teacher@example.com' }),
      },
      specialty: { findFirst: jest.fn().mockResolvedValue(null) },
      group: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn({})),
    };

    service = new CatalogService(
      prisma,
      courseRepository,
      groupRepository,
      groupModuleRepository,
      lessonRepository,
      teacherProfileRepository,
      specialtyService,
      billingService,
      outboxService,
    );
  });

  describe('createCourse', () => {
    beforeEach(() => {
      courseRepository.create.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
        title: 'IELTS Speaking',
      } as any);
    });

    it('accepts a deprecated specialtyId but never persists it (no Specialty write)', async () => {
      await service.createCourse(TEACHER_ID, {
        title: 'IELTS Speaking',
        specialtyId: LEGACY_BODY_SPECIALTY_ID,
      } as any);

      // The payload handed to the repository contains NO specialtyId.
      expect(courseRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ specialtyId: expect.anything() }),
      );
      expect(courseRepository.create).toHaveBeenCalledWith({
        teacherId: TEACHER_ID,
        title: 'IELTS Speaking',
        description: null,
        level: null,
        fromPriceUzs: null,
      });
    });

    it('succeeds when specialtyId is omitted (never required)', async () => {
      const result = await service.createCourse(TEACHER_ID, {
        title: 'IELTS Speaking',
      });

      expect(result.teacherId).toBe(TEACHER_ID);
      expect(courseRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ specialtyId: expect.anything() }),
      );
    });
  });

  describe('createGroup', () => {
    beforeEach(() => {
      courseRepository.findById = jest
        .fn()
        .mockResolvedValue({ id: COURSE_ID, teacherId: TEACHER_ID });
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: PROFILE_SPECIALTY_ID,
      });
      groupRepository.create.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        name: 'g',
        priceUzs: 0,
      });
      // The global English catalog seeds the eight Language_Module_Type
      // skills; echo them back the way the repository would.
      groupModuleRepository.seedForGroup.mockImplementation(
        async (input: any) =>
          input.modules.map((m: any) => ({
            groupId: GROUP_ID,
            moduleType: m.moduleType,
            isEnabled: m.defaultEnabled,
          })),
      );
    });

    it('ignores a client-supplied specialtyId and seeds from the global English catalog', async () => {
      const result = await service.createGroup(TEACHER_ID, COURSE_ID, {
        name: 'g',
        priceUzs: 0,
        specialtyId: LEGACY_BODY_SPECIALTY_ID,
      } as any);

      // The per-Specialty catalog is no longer consulted at all — neither
      // the profile specialty nor the (ignored) body-supplied one.
      expect(specialtyService.listActiveModules).not.toHaveBeenCalled();
      // The persisted Group row carries no specialtyId from the request body.
      expect(groupRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ specialtyId: expect.anything() }),
        expect.anything(),
      );
      // Exactly the eight global English skills are seeded.
      expect(result.modules).toHaveLength(8);
    });

    it('succeeds when specialtyId is omitted', async () => {
      const result = await service.createGroup(TEACHER_ID, COURSE_ID, {
        name: 'g',
        priceUzs: 0,
      });
      expect(result.modules).toHaveLength(8);
    });
  });
});
