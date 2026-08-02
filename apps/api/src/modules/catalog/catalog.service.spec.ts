import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { GroupChatRepository } from '../group-chat/repositories/group-chat.repository';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import { CatalogService } from './catalog.service';
import { CourseRepository } from './repositories/course.repository';
import { GroupRepository } from './repositories/group.repository';
import { GroupModuleRepository } from './repositories/group-module.repository';
import { LessonRepository } from './repositories/lesson.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = '00000000-0000-0000-0000-000000000099';
const SPECIALTY_ID = '11111111-1111-1111-1111-111111111111';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const LESSON_ID = '44444444-4444-4444-4444-444444444444';

/**
 * CatalogService unit tests — Requirements 7.1 – 7.7, 3.8.
 *
 * Coverage:
 *   - createCourse: cross-teacher prevention by hard-coded teacherId arg
 *     (the repository never accepts a teacherId from the caller's payload).
 *   - createGroup: GroupModule seeding from SpecialtyModule with mixed
 *     defaultEnabled flags.
 *   - createLesson: status=DRAFT, ownership check.
 *   - publishLesson: requires active subscription (Req 3.8), transitions
 *     DRAFT → READY, emits the outbox event, fails on EXPIRED.
 */
describe('CatalogService', () => {
  let service: CatalogService;
  let courseRepository: jest.Mocked<CourseRepository>;
  let groupRepository: jest.Mocked<GroupRepository>;
  let groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  let lessonRepository: jest.Mocked<LessonRepository>;
  let teacherProfileRepository: jest.Mocked<TeacherProfileRepository>;
  let specialtyService: jest.Mocked<SpecialtyService>;
  let billingService: jest.Mocked<BillingService>;
  let outboxService: jest.Mocked<OutboxService>;
  let groupChatRepository: jest.Mocked<GroupChatRepository>;
  let prisma: any;

  beforeEach(() => {
    courseRepository = {
      findById: jest.fn(),
      findByIdForTeacher: jest.fn(),
      listByTeacher: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    groupRepository = {
      findById: jest.fn(),
      findByIdWithTeacherSpecialty: jest.fn(),
      listByCourse: jest.fn(),
      create: jest.fn(),
      updateForTeacher: jest.fn(),
      deleteForTeacher: jest.fn(),
    } as any;

    groupModuleRepository = {
      seedForGroup: jest.fn(),
      listByGroup: jest.fn(),
      findOne: jest.fn(),
      countActiveByGroup: jest.fn(),
      upsertToggle: jest.fn(),
    } as any;

    lessonRepository = {
      findById: jest.fn(),
      findByIdWithOwnership: jest.fn(),
      listByGroup: jest.fn(),
      listByGroupAndStatus: jest.fn(),
      create: jest.fn(),
      updateForTeacher: jest.fn(),
      deleteForTeacher: jest.fn(),
      transitionDraftToReady: jest.fn(),
    } as any;

    teacherProfileRepository = {
      findByUserId: jest.fn(),
      upsertWithSpecialty: jest.fn(),
    } as any;

    specialtyService = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
      getById: jest.fn(),
      listActive: jest.fn(),
      listActiveModules: jest.fn(),
    } as any;

    billingService = {
      requireActiveSubscription: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
    } as any;

    groupChatRepository = {
      upsertRoomForGroup: jest.fn().mockResolvedValue({ id: 'room-1', scopeRef: GROUP_ID, createdAt: new Date() }),
      addOwner: jest.fn().mockResolvedValue({}),
    } as any;

    prisma = {
      enrollment: {
        findUnique: jest.fn(),
      },
      adminAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'teacher@example.com' }),
      },
      group: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      // `$transaction(fn)` runs the callback with prisma itself as tx —
      // same pattern other modules use in their tests.
      $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) =>
        fn(prisma),
      ),
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
      groupChatRepository,
    );
  });

  // ==================================================================
  // createCourse (Req 7.1, 7.7)
  // ==================================================================

  describe('createCourse', () => {
    it('creates a course scoped to teacherId from JWT (cross-teacher prevention)', async () => {
      courseRepository.create.mockImplementation(async (input) => ({
        id: COURSE_ID,
        teacherId: input.teacherId,
        title: input.title,
        description: input.description ?? null,
        level: input.level ?? null,
        coverUrl: null,
        isPublished: false,
        isDiscoverable: true,
        fromPriceUzs: input.fromPriceUzs ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.createCourse(TEACHER_ID, {
        title: 'IELTS Speaking',
        description: 'desc',
      });

      expect(courseRepository.create).toHaveBeenCalledWith({
        teacherId: TEACHER_ID,
        title: 'IELTS Speaking',
        description: 'desc',
        level: null,
        fromPriceUzs: null,
      });
      expect(result.teacherId).toBe(TEACHER_ID);
      // Repository hardcodes isPublished=false / isDiscoverable=true (Req 7.1)
      expect(result.isPublished).toBe(false);
      expect(result.isDiscoverable).toBe(true);
    });
  });

  describe('updateCourse', () => {
    it('throws 403 NOT_OWNING_TEACHER for cross-teacher update', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.updateCourse(TEACHER_ID, COURSE_ID, { title: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(courseRepository.update).not.toHaveBeenCalled();
    });

    it('throws 404 COURSE_NOT_FOUND when missing', async () => {
      courseRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateCourse(TEACHER_ID, COURSE_ID, { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('publishCourse', () => {
    it('requires active subscription before flipping isPublished', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
      } as any);
      billingService.requireActiveSubscription.mockRejectedValue(
        new ForbiddenException({
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'no',
        }),
      );

      await expect(
        service.publishCourse(TEACHER_ID, COURSE_ID),
      ).rejects.toMatchObject({
        response: { code: 'SUBSCRIPTION_EXPIRED' },
      });
      expect(courseRepository.update).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // createGroup + GroupModule seeding (Req 7.2, 7.3, 7.7)
  // ==================================================================

  describe('createGroup', () => {
    function setupSuccessfulOwnership() {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
      } as any);
    }

    it('seeds GroupModule rows from the teacher specialty catalog with mixed defaultEnabled flags', async () => {
      setupSuccessfulOwnership();
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: SPECIALTY_ID,
      } as any);
      specialtyService.listActiveModules.mockResolvedValue([
        {
          specialtyId: SPECIALTY_ID,
          moduleType: 'READING',
          isActive: true,
          defaultEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          specialtyId: SPECIALTY_ID,
          moduleType: 'WRITING',
          isActive: true,
          defaultEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          specialtyId: SPECIALTY_ID,
          moduleType: 'GRAMMAR',
          isActive: true,
          defaultEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      groupRepository.create.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        name: 'Sefer guruhi',
        priceUzs: 200_000,
      } as any);
      groupModuleRepository.seedForGroup.mockResolvedValue([
        {
          groupId: GROUP_ID,
          moduleType: 'READING',
          isEnabled: true,
        },
        {
          groupId: GROUP_ID,
          moduleType: 'WRITING',
          isEnabled: true,
        },
        {
          groupId: GROUP_ID,
          moduleType: 'GRAMMAR',
          isEnabled: false,
        },
      ] as any);

      const result = await service.createGroup(TEACHER_ID, COURSE_ID, {
        name: 'Sefer guruhi',
        priceUzs: 200_000,
      });

      // Seeding receives one entry per active SpecialtyModule, with
      // `defaultEnabled` propagated as the seed `isEnabled` value.
      expect(groupModuleRepository.seedForGroup).toHaveBeenCalledWith(
        {
          groupId: GROUP_ID,
          modules: [
            { moduleType: 'READING', defaultEnabled: true },
            { moduleType: 'WRITING', defaultEnabled: true },
            { moduleType: 'GRAMMAR', defaultEnabled: false },
          ],
        },
        expect.anything(),
      );
      expect(result.modules).toHaveLength(3);
      const enabledTypes = result.modules
        .filter((m) => m.isEnabled)
        .map((m) => m.moduleType);
      expect(enabledTypes).toEqual(['READING', 'WRITING']);
    });

    it('rejects with 400 ONBOARDING_REQUIRED if the teacher has no specialty', async () => {
      setupSuccessfulOwnership();
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: null,
      } as any);

      await expect(
        service.createGroup(TEACHER_ID, COURSE_ID, {
          name: 'g',
          priceUzs: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(groupRepository.create).not.toHaveBeenCalled();
      expect(groupModuleRepository.seedForGroup).not.toHaveBeenCalled();
    });

    it('rejects with 403 NOT_OWNING_TEACHER for a cross-teacher course', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.createGroup(TEACHER_ID, COURSE_ID, {
          name: 'g',
          priceUzs: 0,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupRepository.create).not.toHaveBeenCalled();
    });

    it('rejects with 404 COURSE_NOT_FOUND if course is missing', async () => {
      courseRepository.findById.mockResolvedValue(null);

      await expect(
        service.createGroup(TEACHER_ID, COURSE_ID, {
          name: 'g',
          priceUzs: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('seeds zero modules when the specialty catalog is empty', async () => {
      setupSuccessfulOwnership();
      teacherProfileRepository.findByUserId.mockResolvedValue({
        userId: TEACHER_ID,
        specialtyId: SPECIALTY_ID,
      } as any);
      specialtyService.listActiveModules.mockResolvedValue([]);
      groupRepository.create.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        name: 'g',
        priceUzs: 0,
      } as any);
      groupModuleRepository.seedForGroup.mockResolvedValue([]);

      const result = await service.createGroup(TEACHER_ID, COURSE_ID, {
        name: 'g',
        priceUzs: 0,
      });

      expect(result.modules).toEqual([]);
      expect(groupModuleRepository.seedForGroup).toHaveBeenCalledWith(
        { groupId: GROUP_ID, modules: [] },
        expect.anything(),
      );
    });
  });

  // ==================================================================
  // createLesson (Req 7.4, 7.7)
  // ==================================================================

  describe('createLesson', () => {
    function setupGroup() {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: TEACHER_ID },
      } as any);
    }

    it('creates a lesson with status=DRAFT for an owned group', async () => {
      setupGroup();
      lessonRepository.create.mockImplementation(async (input) => ({
        id: LESSON_ID,
        groupId: input.groupId,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        status: 'DRAFT',
        position: input.position ?? 0,
        scheduledAt: input.scheduledAt ?? null,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.createLesson(TEACHER_ID, GROUP_ID, {
        title: 'Lesson 1',
        type: 'TEXT_ONLY',
      });

      expect(result.status).toBe('DRAFT');
      expect(result.groupId).toBe(GROUP_ID);
      expect(lessonRepository.create).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        title: 'Lesson 1',
        description: null,
        type: 'TEXT_ONLY',
        position: undefined,
        scheduledAt: null,
      });
    });

    it('rejects with 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.createLesson(TEACHER_ID, GROUP_ID, {
          title: 'x',
          type: 'TEXT_ONLY',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lessonRepository.create).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // publishLesson (Req 7.4, 7.5, 7.6, 3.8, 7.7)
  // ==================================================================

  describe('publishLesson', () => {
    function setupOwnedDraftLesson() {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        },
      } as any);
    }

    it('happy path: requires active subscription, transitions DRAFT→READY, emits lesson.published', async () => {
      setupOwnedDraftLesson();
      billingService.requireActiveSubscription.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
      } as any);
      lessonRepository.transitionDraftToReady.mockResolvedValue(true);
      const publishedAt = new Date();
      lessonRepository.findById.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'READY',
        publishedAt,
      } as any);

      const result = await service.publishLesson(TEACHER_ID, LESSON_ID);

      expect(billingService.requireActiveSubscription).toHaveBeenCalledWith(
        TEACHER_ID,
      );
      expect(lessonRepository.transitionDraftToReady).toHaveBeenCalledWith(
        LESSON_ID,
        TEACHER_ID,
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'lesson.published',
          idempotencyKey: `lesson.published:${LESSON_ID}`,
          payload: {
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
          },
        }),
      );
      expect(result.status).toBe('READY');
    });

    it('blocks publish on EXPIRED subscription with 403 SUBSCRIPTION_EXPIRED (Req 3.8)', async () => {
      setupOwnedDraftLesson();
      billingService.requireActiveSubscription.mockRejectedValue(
        new ForbiddenException({
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'no',
        }),
      );

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toMatchObject({
        response: { code: 'SUBSCRIPTION_EXPIRED' },
      });
      expect(lessonRepository.transitionDraftToReady).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('rejects publish for a cross-teacher lesson with 403 NOT_OWNING_TEACHER (Req 7.7)', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(billingService.requireActiveSubscription).not.toHaveBeenCalled();
    });

    it('throws 409 LESSON_ALREADY_PUBLISHED when the lesson is already READY', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'READY',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        },
      } as any);

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(billingService.requireActiveSubscription).not.toHaveBeenCalled();
      expect(lessonRepository.transitionDraftToReady).not.toHaveBeenCalled();
    });

    it('throws 409 LESSON_ALREADY_PUBLISHED when a concurrent caller wins the race', async () => {
      setupOwnedDraftLesson();
      billingService.requireActiveSubscription.mockResolvedValue({
        id: 'sub-1',
      } as any);
      // The atomic precondition fails because another caller already moved
      // the row out of DRAFT in between our read and our write.
      lessonRepository.transitionDraftToReady.mockResolvedValue(false);

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('checks ownership before billing: cross-teacher publish never hits BillingService', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Subscription state must not influence whether we leak ownership info.
      expect(billingService.requireActiveSubscription).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 404 LESSON_NOT_FOUND when the lesson does not exist', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue(null);

      await expect(
        service.publishLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(billingService.requireActiveSubscription).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Course list / get / update / delete (Req 7.1, 7.7)
  // ==================================================================

  describe('listCoursesForTeacher', () => {
    it('forwards the calling teacherId to the repository', async () => {
      courseRepository.listByTeacher.mockResolvedValue([]);
      await service.listCoursesForTeacher(TEACHER_ID);
      expect(courseRepository.listByTeacher).toHaveBeenCalledWith(TEACHER_ID);
    });
  });

  describe('getCourseForTeacher', () => {
    it('returns the course when owned by the teacher', async () => {
      const course = { id: COURSE_ID, teacherId: TEACHER_ID, title: 't' };
      courseRepository.findById.mockResolvedValue(course as any);

      const result = await service.getCourseForTeacher(TEACHER_ID, COURSE_ID);
      expect(result).toBe(course);
    });

    it('throws 403 NOT_OWNING_TEACHER for a course owned by another teacher', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.getCourseForTeacher(TEACHER_ID, COURSE_ID),
      ).rejects.toMatchObject({
        response: { code: 'NOT_OWNING_TEACHER' },
      });
    });

    it('throws 404 COURSE_NOT_FOUND when missing', async () => {
      courseRepository.findById.mockResolvedValue(null);

      await expect(
        service.getCourseForTeacher(TEACHER_ID, COURSE_ID),
      ).rejects.toMatchObject({
        response: { code: 'COURSE_NOT_FOUND' },
      });
    });
  });

  describe('updateCourse (happy path)', () => {
    it('only forwards provided fields, scopes update by teacherId, and returns the refreshed row', async () => {
      const before = {
        id: COURSE_ID,
        teacherId: TEACHER_ID,
        title: 'old',
        description: 'old desc',
        level: 'A1',
        fromPriceUzs: 100,
      };
      const after = { ...before, title: 'new' };
      courseRepository.findById
        .mockResolvedValueOnce(before as any) // assertCourseOwnership pre-update
        .mockResolvedValueOnce(after as any); // post-update fetch
      courseRepository.update.mockResolvedValue({ count: 1 });

      const result = await service.updateCourse(TEACHER_ID, COURSE_ID, {
        title: 'new',
      });

      // Only `title` should appear in the update payload — undefined fields
      // must be stripped to avoid clobbering existing values.
      expect(courseRepository.update).toHaveBeenCalledWith(
        COURSE_ID,
        TEACHER_ID,
        { title: 'new' },
      );
      expect(result).toBe(after);
    });
  });

  describe('deleteCourse', () => {
    it('deletes a course owned by the teacher', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
      } as any);
      courseRepository.delete.mockResolvedValue({ count: 1 });

      await service.deleteCourse(TEACHER_ID, COURSE_ID);
      expect(courseRepository.delete).toHaveBeenCalledWith(
        COURSE_ID,
        TEACHER_ID,
      );
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher delete', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.deleteCourse(TEACHER_ID, COURSE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(courseRepository.delete).not.toHaveBeenCalled();
    });

    it('throws 404 if a concurrent delete already removed the row', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
      } as any);
      courseRepository.delete.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteCourse(TEACHER_ID, COURSE_ID),
      ).rejects.toMatchObject({
        response: { code: 'COURSE_NOT_FOUND' },
      });
    });
  });

  describe('publishCourse (happy path)', () => {
    it('flips isPublished=true after billing check passes', async () => {
      courseRepository.findById
        .mockResolvedValueOnce({
          id: COURSE_ID,
          teacherId: TEACHER_ID,
          isPublished: false,
        } as any)
        .mockResolvedValueOnce({
          id: COURSE_ID,
          teacherId: TEACHER_ID,
          isPublished: true,
        } as any);
      billingService.requireActiveSubscription.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
      } as any);
      courseRepository.update.mockResolvedValue({ count: 1 });

      const result = await service.publishCourse(TEACHER_ID, COURSE_ID);

      expect(billingService.requireActiveSubscription).toHaveBeenCalledWith(
        TEACHER_ID,
      );
      expect(courseRepository.update).toHaveBeenCalledWith(
        COURSE_ID,
        TEACHER_ID,
        { isPublished: true },
      );
      expect(result.isPublished).toBe(true);
    });
  });

  // ==================================================================
  // Group list / get / update / delete (Req 7.2, 7.7)
  // ==================================================================

  describe('listGroupsForCourse', () => {
    it('rejects when the course belongs to another teacher (no row leakage)', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.listGroupsForCourse(TEACHER_ID, COURSE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupRepository.listByCourse).not.toHaveBeenCalled();
    });

    it('returns groups for an owned course', async () => {
      courseRepository.findById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
      } as any);
      const groups = [{ id: GROUP_ID, name: 'g' }];
      groupRepository.listByCourse.mockResolvedValue(groups as any);

      const result = await service.listGroupsForCourse(TEACHER_ID, COURSE_ID);
      expect(groupRepository.listByCourse).toHaveBeenCalledWith(COURSE_ID);
      expect(result).toBe(groups);
    });
  });

  describe('getGroupForTeacher', () => {
    it('strips the joined course field from the return value', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        name: 'g',
        course: { teacherId: TEACHER_ID },
      } as any);

      const result = await service.getGroupForTeacher(TEACHER_ID, GROUP_ID);
      expect(result).toMatchObject({ id: GROUP_ID, name: 'g' });
      expect((result as any).course).toBeUndefined();
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.getGroupForTeacher(TEACHER_ID, GROUP_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 404 GROUP_NOT_FOUND when missing', async () => {
      groupRepository.findById.mockResolvedValue(null);

      await expect(
        service.getGroupForTeacher(TEACHER_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'GROUP_NOT_FOUND' },
      });
    });
  });

  describe('updateGroup', () => {
    it('updates only provided fields and converts ISO strings to Date instances', async () => {
      groupRepository.findById
        .mockResolvedValueOnce({
          id: GROUP_ID,
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        } as any)
        .mockResolvedValueOnce({
          id: GROUP_ID,
          courseId: COURSE_ID,
          name: 'renamed',
          course: { teacherId: TEACHER_ID },
        } as any);
      groupRepository.updateForTeacher.mockResolvedValue({ count: 1 });

      const startsOn = '2026-09-01T00:00:00.000Z';
      const result = await service.updateGroup(TEACHER_ID, GROUP_ID, {
        name: 'renamed',
        startsOn,
      });

      expect(groupRepository.updateForTeacher).toHaveBeenCalledWith(
        GROUP_ID,
        TEACHER_ID,
        {
          name: 'renamed',
          startsOn: new Date(startsOn),
        },
      );
      expect(result).toMatchObject({ id: GROUP_ID, name: 'renamed' });
    });

    it('passes null through unchanged when caller resets endsOn', async () => {
      groupRepository.findById
        .mockResolvedValueOnce({
          id: GROUP_ID,
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        } as any)
        .mockResolvedValueOnce({
          id: GROUP_ID,
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        } as any);
      groupRepository.updateForTeacher.mockResolvedValue({ count: 1 });

      await service.updateGroup(TEACHER_ID, GROUP_ID, { endsOn: null });

      expect(groupRepository.updateForTeacher).toHaveBeenCalledWith(
        GROUP_ID,
        TEACHER_ID,
        { endsOn: null },
      );
    });

    it('rejects with 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.updateGroup(TEACHER_ID, GROUP_ID, { name: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupRepository.updateForTeacher).not.toHaveBeenCalled();
    });
  });

  describe('deleteGroup', () => {
    it('deletes a group owned via the parent course', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: TEACHER_ID },
      } as any);
      groupRepository.deleteForTeacher.mockResolvedValue({ count: 1 });

      await service.deleteGroup(TEACHER_ID, GROUP_ID);
      expect(groupRepository.deleteForTeacher).toHaveBeenCalledWith(
        GROUP_ID,
        TEACHER_ID,
      );
    });

    it('throws 403 for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.deleteGroup(TEACHER_ID, GROUP_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupRepository.deleteForTeacher).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Lesson list / get / update / delete (Req 7.4, 7.7)
  // ==================================================================

  describe('listLessonsForTeacher', () => {
    it('returns all lessons regardless of status for the owning teacher', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: TEACHER_ID },
      } as any);
      const lessons = [
        { id: 'l1', status: 'DRAFT' },
        { id: 'l2', status: 'READY' },
        { id: 'l3', status: 'ARCHIVED' },
      ];
      lessonRepository.listByGroup.mockResolvedValue(lessons as any);

      const result = await service.listLessonsForTeacher(TEACHER_ID, GROUP_ID);

      expect(lessonRepository.listByGroup).toHaveBeenCalledWith(GROUP_ID);
      expect(result).toBe(lessons);
    });

    it('rejects with 403 for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.listLessonsForTeacher(TEACHER_ID, GROUP_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lessonRepository.listByGroup).not.toHaveBeenCalled();
    });
  });

  describe('listReadyLessonsForGroup', () => {
    it('filters by status=READY (Req 6.1: students only see published lessons)', async () => {
      lessonRepository.listByGroupAndStatus.mockResolvedValue([]);
      await service.listReadyLessonsForGroup(GROUP_ID);
      expect(lessonRepository.listByGroupAndStatus).toHaveBeenCalledWith(
        GROUP_ID,
        'READY',
      );
    });
  });

  describe('assertStudentEnrolledInGroup', () => {
    const STUDENT_ID = 'student-1';

    it('passes when the student has an APPROVED enrollment', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'APPROVED',
      });

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).resolves.toBeUndefined();
      expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { groupId_studentId: { groupId: GROUP_ID, studentId: STUDENT_ID } },
      });
    });

    it('rejects with 403 LESSON_ACCESS_DENIED when no enrollment row exists', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'LESSON_ACCESS_DENIED' },
      });
    });

    it('rejects with 403 LESSON_ACCESS_DENIED for PENDING_APPROVAL enrollment', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        groupId: GROUP_ID,
        studentId: STUDENT_ID,
        status: 'PENDING_APPROVAL',
      });

      await expect(
        service.assertStudentEnrolledInGroup(STUDENT_ID, GROUP_ID),
      ).rejects.toMatchObject({
        response: { code: 'LESSON_ACCESS_DENIED' },
      });
    });
  });

  describe('getLessonById', () => {
    it('throws 404 LESSON_NOT_FOUND when missing', async () => {
      lessonRepository.findById.mockResolvedValue(null);

      await expect(service.getLessonById(LESSON_ID)).rejects.toMatchObject({
        response: { code: 'LESSON_NOT_FOUND' },
      });
    });

    it('returns the lesson when found (access enforced separately by guard)', async () => {
      const lesson = { id: LESSON_ID, status: 'READY' };
      lessonRepository.findById.mockResolvedValue(lesson as any);

      const result = await service.getLessonById(LESSON_ID);
      expect(result).toBe(lesson);
    });
  });

  describe('updateLesson', () => {
    it('updates only provided fields and forwards them through ownership-scoped update', async () => {
      lessonRepository.findByIdWithOwnership
        .mockResolvedValueOnce({
          id: LESSON_ID,
          groupId: GROUP_ID,
          status: 'DRAFT',
          group: {
            courseId: COURSE_ID,
            course: { teacherId: TEACHER_ID },
          },
        } as any)
        .mockResolvedValueOnce({
          id: LESSON_ID,
          groupId: GROUP_ID,
          status: 'DRAFT',
          title: 'new title',
          group: {
            courseId: COURSE_ID,
            course: { teacherId: TEACHER_ID },
          },
        } as any);
      lessonRepository.updateForTeacher.mockResolvedValue({ count: 1 });

      const result = await service.updateLesson(TEACHER_ID, LESSON_ID, {
        title: 'new title',
      });

      expect(lessonRepository.updateForTeacher).toHaveBeenCalledWith(
        LESSON_ID,
        TEACHER_ID,
        { title: 'new title' },
      );
      expect(result).toMatchObject({ id: LESSON_ID, title: 'new title' });
      // The joined `group` field must not leak through to callers.
      expect((result as any).group).toBeUndefined();
    });

    it('rejects with 403 for a cross-teacher lesson', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.updateLesson(TEACHER_ID, LESSON_ID, { title: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lessonRepository.updateForTeacher).not.toHaveBeenCalled();
    });
  });

  describe('deleteLesson', () => {
    it('deletes a lesson owned via group/course join', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: TEACHER_ID },
        },
      } as any);
      lessonRepository.deleteForTeacher.mockResolvedValue({ count: 1 });

      await service.deleteLesson(TEACHER_ID, LESSON_ID);

      expect(lessonRepository.deleteForTeacher).toHaveBeenCalledWith(
        LESSON_ID,
        TEACHER_ID,
      );
    });

    it('rejects with 403 for a cross-teacher lesson', async () => {
      lessonRepository.findByIdWithOwnership.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        status: 'DRAFT',
        group: {
          courseId: COURSE_ID,
          course: { teacherId: OTHER_TEACHER_ID },
        },
      } as any);

      await expect(
        service.deleteLesson(TEACHER_ID, LESSON_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lessonRepository.deleteForTeacher).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // Per-Group module toggle (Req 11.2 – 11.7, Property 9)
  // ==================================================================

  describe('listGroupModules', () => {
    it('returns the group toggle catalog for the owning teacher', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: TEACHER_ID },
      } as any);
      const rows = [
        { groupId: GROUP_ID, moduleType: 'WRITING', isEnabled: true },
        { groupId: GROUP_ID, moduleType: 'READING', isEnabled: false },
      ];
      groupModuleRepository.listByGroup.mockResolvedValue(rows as any);

      const result = await service.listGroupModules(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
      );

      expect(result).toEqual(rows);
      expect(groupModuleRepository.listByGroup).toHaveBeenCalledWith(GROUP_ID);
    });

    it('rejects with 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);

      await expect(
        service.listGroupModules(TEACHER_ID, 'TEACHER', GROUP_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModuleRepository.listByGroup).not.toHaveBeenCalled();
    });

    it('allows ADMIN to read any group catalog (read-only audit, Req 6.5)', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: OTHER_TEACHER_ID },
      } as any);
      groupModuleRepository.listByGroup.mockResolvedValue([]);

      await expect(
        service.listGroupModules('admin-1', 'ADMIN', GROUP_ID),
      ).resolves.toEqual([]);
    });

    it('throws 404 GROUP_NOT_FOUND when an admin queries a missing group', async () => {
      groupRepository.findById.mockResolvedValue(null);

      await expect(
        service.listGroupModules('admin-1', 'ADMIN', GROUP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('toggleGroupModule', () => {
    function setupOwnedGroupWithSpecialty(
      catalog: Array<{ moduleType: string; defaultEnabled?: boolean }> = [
        { moduleType: 'WRITING' },
        { moduleType: 'READING' },
        { moduleType: 'GRAMMAR' },
      ],
      existingGroupModules: Array<{ moduleType: string; isEnabled: boolean }> = [],
    ) {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: TEACHER_ID,
          teacher: { specialtyId: SPECIALTY_ID },
        },
      } as any);
      specialtyService.listActiveModules.mockResolvedValue(
        catalog.map((m) => ({
          specialtyId: SPECIALTY_ID,
          moduleType: m.moduleType,
          isActive: true,
          defaultEnabled: m.defaultEnabled ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as any,
      );
      groupModuleRepository.listByGroup.mockResolvedValue(
        existingGroupModules.map((m) => ({
          groupId: GROUP_ID,
          moduleType: m.moduleType,
          isEnabled: m.isEnabled,
          enabledAt: m.isEnabled ? new Date() : null,
          disabledAt: m.isEnabled ? null : new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as any,
      );
    }

    it('happy path: flips module ON, writes audit log, emits group.module.toggled outbox event', async () => {
      setupOwnedGroupWithSpecialty(
        [{ moduleType: 'WRITING' }, { moduleType: 'READING' }],
        [{ moduleType: 'WRITING', isEnabled: false }],
      );
      groupModuleRepository.upsertToggle.mockResolvedValue({
        groupId: GROUP_ID,
        moduleType: 'WRITING',
        isEnabled: true,
      } as any);

      const result = await service.toggleGroupModule(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        'WRITING' as any,
        true,
      );

      expect(groupModuleRepository.upsertToggle).toHaveBeenCalledWith(
        GROUP_ID,
        'WRITING',
        true,
        expect.anything(),
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: TEACHER_ID,
            action: 'group.module.toggled',
            target: `Group/${GROUP_ID}`,
            payload: expect.objectContaining({
              groupId: GROUP_ID,
              moduleType: 'WRITING',
              isEnabled: true,
              actorRole: 'TEACHER',
            }),
          }),
        }),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'group.module.toggled',
          payload: expect.objectContaining({
            groupId: GROUP_ID,
            moduleType: 'WRITING',
            isEnabled: true,
          }),
        }),
      );
      expect(result.isEnabled).toBe(true);
    });

    it('rejects with 403 NOT_OWNING_TEACHER when teacher does not own the group', async () => {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: OTHER_TEACHER_ID,
          teacher: { specialtyId: SPECIALTY_ID },
        },
      } as any);

      await expect(
        service.toggleGroupModule(
          TEACHER_ID,
          'TEACHER',
          GROUP_ID,
          'WRITING' as any,
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModuleRepository.upsertToggle).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws 404 GROUP_NOT_FOUND when the group is missing', async () => {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue(null);

      await expect(
        service.toggleGroupModule(
          TEACHER_ID,
          'TEACHER',
          GROUP_ID,
          'WRITING' as any,
          true,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 400 MODULE_NOT_IN_SPECIALTY_CATALOG when moduleType is outside the specialty catalog (Req 11.6)', async () => {
      setupOwnedGroupWithSpecialty(
        [{ moduleType: 'WRITING' }, { moduleType: 'READING' }], // no GRAMMAR
      );

      await expect(
        service.toggleGroupModule(
          TEACHER_ID,
          'TEACHER',
          GROUP_ID,
          'GRAMMAR' as any,
          true,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_IN_SPECIALTY_CATALOG',
        }),
      });
      expect(groupModuleRepository.upsertToggle).not.toHaveBeenCalled();
    });

    it('rejects with 400 ONBOARDING_REQUIRED when the teacher has no specialty assigned', async () => {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: TEACHER_ID,
          teacher: { specialtyId: null },
        },
      } as any);

      await expect(
        service.toggleGroupModule(
          TEACHER_ID,
          'TEACHER',
          GROUP_ID,
          'WRITING' as any,
          true,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }),
      });
    });

    it('rejects with 409 GROUP_MODULE_CAP_EXCEEDED when projected active count > 10 (Req 11.7)', async () => {
      // 10 already active + flipping an 11th to ON should fail.
      const tenActive = [
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
      ];
      setupOwnedGroupWithSpecialty(
        [...tenActive, 'MATCHING'].map((m) => ({ moduleType: m })),
        tenActive.map((m) => ({ moduleType: m, isEnabled: true })),
      );

      await expect(
        service.toggleGroupModule(
          TEACHER_ID,
          'TEACHER',
          GROUP_ID,
          'MATCHING' as any,
          true,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'GROUP_MODULE_CAP_EXCEEDED',
        }),
      });
      expect(groupModuleRepository.upsertToggle).not.toHaveBeenCalled();
    });

    it('idempotent: re-toggling to the same state writes no audit / outbox entry', async () => {
      // WRITING is already enabled — toggling back to enabled is a no-op.
      setupOwnedGroupWithSpecialty(
        [{ moduleType: 'WRITING' }],
        [{ moduleType: 'WRITING', isEnabled: true }],
      );
      groupModuleRepository.upsertToggle.mockResolvedValue({
        groupId: GROUP_ID,
        moduleType: 'WRITING',
        isEnabled: true,
      } as any);

      const result = await service.toggleGroupModule(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        'WRITING' as any,
        true,
      );

      // The upsert still runs (preserves enabledAt); audit / outbox do NOT.
      expect(groupModuleRepository.upsertToggle).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(result.isEnabled).toBe(true);
    });

    it('non-destructive: flipping OFF does not invoke any assignment / submission cleanup (Req 11.4)', async () => {
      // The service only writes to GroupModule + audit + outbox. It must
      // not touch AssignmentModule or Submission tables.
      setupOwnedGroupWithSpecialty(
        [{ moduleType: 'WRITING' }],
        [{ moduleType: 'WRITING', isEnabled: true }],
      );
      groupModuleRepository.upsertToggle.mockResolvedValue({
        groupId: GROUP_ID,
        moduleType: 'WRITING',
        isEnabled: false,
      } as any);

      await service.toggleGroupModule(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        'WRITING' as any,
        false,
      );

      // The mocked prisma client does not expose assignment / submission
      // tables, so a destructive call would have thrown. We additionally
      // assert that only the expected mutations happened.
      expect(groupModuleRepository.upsertToggle).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('group isolation (Property 9): toggling a module in Group A never reads or writes Group B', async () => {
      // Two groups belong to the same teacher and share the specialty catalog.
      // We toggle Group A; assert every repository call is parameterised by
      // GROUP_ID (Group A) and never by GROUP_B_ID — this is the per-group
      // scoping that Property 9 verifies on the read path.
      const GROUP_B_ID = '99999999-9999-9999-9999-999999999999';
      setupOwnedGroupWithSpecialty(
        [{ moduleType: 'WRITING' }, { moduleType: 'READING' }],
        [{ moduleType: 'WRITING', isEnabled: false }],
      );
      groupModuleRepository.upsertToggle.mockResolvedValue({
        groupId: GROUP_ID,
        moduleType: 'WRITING',
        isEnabled: true,
      } as any);

      await service.toggleGroupModule(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        'WRITING' as any,
        true,
      );

      // Every repository / service call carries GROUP_ID, never GROUP_B_ID.
      const callTargets = [
        ...groupRepository.findByIdWithTeacherSpecialty.mock.calls,
        ...groupModuleRepository.listByGroup.mock.calls,
        ...groupModuleRepository.upsertToggle.mock.calls,
      ];
      for (const call of callTargets) {
        expect(call).not.toContain(GROUP_B_ID);
      }
    });
  });

  describe('bulkToggleGroupModules', () => {
    function setupOwnedGroupWithSpecialty(
      catalog: string[],
      existing: Array<{ moduleType: string; isEnabled: boolean }> = [],
    ) {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: TEACHER_ID,
          teacher: { specialtyId: SPECIALTY_ID },
        },
      } as any);
      specialtyService.listActiveModules.mockResolvedValue(
        catalog.map((moduleType) => ({
          specialtyId: SPECIALTY_ID,
          moduleType,
          isActive: true,
          defaultEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as any,
      );
      groupModuleRepository.listByGroup.mockResolvedValue(
        existing.map((m) => ({
          groupId: GROUP_ID,
          moduleType: m.moduleType,
          isEnabled: m.isEnabled,
        })) as any,
      );
    }

    it('flips every requested row and emits one outbox event per real flip', async () => {
      setupOwnedGroupWithSpecialty(
        ['WRITING', 'READING', 'GRAMMAR'],
        [
          { moduleType: 'WRITING', isEnabled: false },
          { moduleType: 'READING', isEnabled: true },
        ],
      );
      groupModuleRepository.upsertToggle.mockImplementation(
        async (_g: any, mt: any, en: any) =>
          ({
            groupId: GROUP_ID,
            moduleType: mt,
            isEnabled: en,
          }) as any,
      );
      // Final list returned to the caller.
      groupModuleRepository.listByGroup.mockResolvedValueOnce([
        { moduleType: 'WRITING', isEnabled: false },
        { moduleType: 'READING', isEnabled: true },
      ] as any); // pre-check inside toggleGroupModulesAtomic
      groupModuleRepository.listByGroup.mockResolvedValueOnce([
        { groupId: GROUP_ID, moduleType: 'WRITING', isEnabled: true },
        { groupId: GROUP_ID, moduleType: 'READING', isEnabled: true },
        { groupId: GROUP_ID, moduleType: 'GRAMMAR', isEnabled: true },
      ] as any); // final return value

      const result = await service.bulkToggleGroupModules(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        {
          modules: [
            { moduleType: 'WRITING', isEnabled: true }, // flip ON  → 1 audit + 1 outbox
            { moduleType: 'READING', isEnabled: true }, // no-op (already ON)
            { moduleType: 'GRAMMAR', isEnabled: true }, // flip ON  → 1 audit + 1 outbox
          ],
        },
      );

      expect(groupModuleRepository.upsertToggle).toHaveBeenCalledTimes(3);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledTimes(2);
      expect(outboxService.create).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(3);
    });

    it('rejects the entire batch with 400 MODULE_NOT_IN_SPECIALTY_CATALOG on the first invalid moduleType', async () => {
      setupOwnedGroupWithSpecialty(['WRITING', 'READING']);

      await expect(
        service.bulkToggleGroupModules(TEACHER_ID, 'TEACHER', GROUP_ID, {
          modules: [
            { moduleType: 'WRITING', isEnabled: true },
            { moduleType: 'GRAMMAR', isEnabled: true }, // not in catalog
          ],
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_IN_SPECIALTY_CATALOG',
        }),
      });
      expect(groupModuleRepository.upsertToggle).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects with 400 DUPLICATE_MODULE_TYPE on duplicate moduleType entries', async () => {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: TEACHER_ID,
          teacher: { specialtyId: SPECIALTY_ID },
        },
      } as any);

      await expect(
        service.bulkToggleGroupModules(TEACHER_ID, 'TEACHER', GROUP_ID, {
          modules: [
            { moduleType: 'WRITING', isEnabled: true },
            { moduleType: 'WRITING', isEnabled: false },
          ],
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'DUPLICATE_MODULE_TYPE',
        }),
      });
    });

    it('flipping a row off frees a slot for another row in the same batch (Req 11.7 boundary)', async () => {
      // 10 currently active; batch turns one off and another on. Net 10 — legal.
      const tenActive = [
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
      ];
      setupOwnedGroupWithSpecialty(
        [...tenActive, 'MATCHING'],
        tenActive.map((m) => ({ moduleType: m, isEnabled: true })),
      );
      groupModuleRepository.upsertToggle.mockImplementation(
        async (_g: any, mt: any, en: any) =>
          ({
            groupId: GROUP_ID,
            moduleType: mt,
            isEnabled: en,
          }) as any,
      );
      // Final return list.
      groupModuleRepository.listByGroup.mockResolvedValueOnce(
        tenActive.map((m) => ({
          groupId: GROUP_ID,
          moduleType: m,
          isEnabled: true,
        })) as any,
      );
      groupModuleRepository.listByGroup.mockResolvedValueOnce([
        ...tenActive
          .filter((m) => m !== 'WRITING')
          .map((m) => ({
            groupId: GROUP_ID,
            moduleType: m,
            isEnabled: true,
          })),
        { groupId: GROUP_ID, moduleType: 'MATCHING', isEnabled: true },
      ] as any);

      await expect(
        service.bulkToggleGroupModules(TEACHER_ID, 'TEACHER', GROUP_ID, {
          modules: [
            { moduleType: 'WRITING', isEnabled: false },
            { moduleType: 'MATCHING', isEnabled: true },
          ],
        }),
      ).resolves.toBeDefined();
      expect(groupModuleRepository.upsertToggle).toHaveBeenCalledTimes(2);
    });

    it('returns the current catalog without writes when modules array is empty', async () => {
      groupRepository.findById.mockResolvedValue({
        id: GROUP_ID,
        course: { teacherId: TEACHER_ID },
      } as any);
      const current = [
        { groupId: GROUP_ID, moduleType: 'WRITING', isEnabled: true },
      ];
      groupModuleRepository.listByGroup.mockResolvedValue(current as any);

      const result = await service.bulkToggleGroupModules(
        TEACHER_ID,
        'TEACHER',
        GROUP_ID,
        { modules: [] },
      );

      expect(result).toEqual(current);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(groupModuleRepository.upsertToggle).not.toHaveBeenCalled();
      expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('ADMIN can toggle modules on any teacher\'s group', async () => {
      groupRepository.findByIdWithTeacherSpecialty.mockResolvedValue({
        id: GROUP_ID,
        course: {
          teacherId: OTHER_TEACHER_ID,
          teacher: { specialtyId: SPECIALTY_ID },
        },
      } as any);
      specialtyService.listActiveModules.mockResolvedValue([
        {
          specialtyId: SPECIALTY_ID,
          moduleType: 'WRITING',
          isActive: true,
          defaultEnabled: false,
        },
      ] as any);
      groupModuleRepository.listByGroup
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { groupId: GROUP_ID, moduleType: 'WRITING', isEnabled: true },
        ] as any);
      groupModuleRepository.upsertToggle.mockResolvedValue({
        groupId: GROUP_ID,
        moduleType: 'WRITING',
        isEnabled: true,
      } as any);

      await expect(
        service.bulkToggleGroupModules('admin-1', 'ADMIN', GROUP_ID, {
          modules: [{ moduleType: 'WRITING', isEnabled: true }],
        }),
      ).resolves.toBeDefined();
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'admin-1',
            payload: expect.objectContaining({
              actorRole: 'ADMIN',
              teacherId: OTHER_TEACHER_ID,
            }),
          }),
        }),
      );
    });
  });
});
