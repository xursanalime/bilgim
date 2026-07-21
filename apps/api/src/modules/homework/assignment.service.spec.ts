import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Assignment,
  AssignmentModule,
  GroupModule,
  HomeworkModuleType,
} from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupModuleRepository } from '../catalog/repositories/group-module.repository';
import { AssignmentService } from './assignment.service';
import { AssignmentRepository } from './repositories/assignment.repository';
import {
  HomeworkModuleRuntimeRegistry,
  WritingRuntime,
} from './runtimes';

const TEACHER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_TEACHER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const LESSON_ID = '33333333-3333-3333-3333-333333333333';
const GROUP_ID = '44444444-4444-4444-4444-444444444444';
const ASSIGNMENT_ID = '55555555-5555-5555-5555-555555555555';

function buildAssignmentRow(
  overrides: Partial<Assignment & { modules: AssignmentModule[] }> = {},
): Assignment & { modules: AssignmentModule[] } {
  return {
    id: ASSIGNMENT_ID,
    lessonId: LESSON_ID,
    title: 'Week 1 homework',
    description: null,
    dueAt: null,
    totalPoints: 100,
    isPublished: false,
    createdAt: new Date(),
    modules: [
      {
        id: 'm1',
        assignmentId: ASSIGNMENT_ID,
        type: 'WRITING' as HomeworkModuleType,
        order: 0,
        configJson: {},
        weight: 100,
      } as AssignmentModule,
    ],
    ...overrides,
  } as Assignment & { modules: AssignmentModule[] };
}

function buildOwnership(
  overrides: Partial<{
    isPublished: boolean;
    teacherId: string;
    modules: AssignmentModule[];
  }> = {},
): any {
  return {
    ...buildAssignmentRow({
      isPublished: overrides.isPublished ?? false,
      ...(overrides.modules ? { modules: overrides.modules } : {}),
    }),
    lesson: {
      id: LESSON_ID,
      groupId: GROUP_ID,
      group: {
        id: GROUP_ID,
        courseId: 'course-1',
        course: { teacherId: overrides.teacherId ?? TEACHER_ID },
      },
    },
  };
}

function buildGroupModule(
  type: HomeworkModuleType,
  isEnabled: boolean,
): GroupModule {
  return {
    groupId: GROUP_ID,
    moduleType: type,
    isEnabled,
    enabledAt: isEnabled ? new Date() : null,
    disabledAt: isEnabled ? null : new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Unit tests for AssignmentService — Task 17.3, Requirements 11.5, 11.8.
 *
 * Coverage:
 *   - createForLesson: happy path, lesson missing, ownership, module
 *     enablement check, ADMIN override.
 *   - update: scalar-only, modules-only, both, ownership, module
 *     re-validation when modules are provided.
 *   - delete: blocked when published, blocked when submissions exist.
 *   - publish: outbox emission, ownership, idempotent re-publish raises 409.
 */
describe('AssignmentService', () => {
  let service: AssignmentService;
  let prisma: any;
  let assignmentRepository: jest.Mocked<AssignmentRepository>;
  let groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let txClient: any;

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };

    assignmentRepository = {
      findById: jest.fn(),
      findByIdWithOwnership: jest.fn(),
      findLessonOwnership: jest.fn(),
      listByLesson: jest.fn(),
      countSubmissions: jest.fn(),
      createWithModules: jest.fn(),
      updateScalars: jest.fn(),
      replaceModules: jest.fn(),
      transitionToPublished: jest.fn(),
      deleteById: jest.fn(),
    } as any;

    groupModuleRepository = {
      seedForGroup: jest.fn(),
      listByGroup: jest.fn(),
      findOne: jest.fn(),
    } as any;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;

    // Default to a registry with no runtimes — most existing tests
    // pass opaque configJson values that would not pass the WritingRuntime
    // schema. Tests that exercise the runtime path register one
    // explicitly via `runtimeRegistry.register(...)` (or use the new
    // "real WritingRuntime" test below).
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    // Strip the default WritingRuntime registration so existing tests
    // can pass their loose `configJson: {}` payloads without re-shaping
    // every fixture.
    (runtimeRegistry as any).runtimes.clear();

    service = new AssignmentService(
      prisma,
      assignmentRepository,
      groupModuleRepository,
      outboxService,
      runtimeRegistry,
    );
  });

  // ==================================================================
  // createForLesson
  // ==================================================================

  describe('createForLesson', () => {
    function setupOwnership(teacherId: string = TEACHER_ID): void {
      assignmentRepository.findLessonOwnership.mockResolvedValue({
        groupId: GROUP_ID,
        teacherId,
      });
    }

    function setupGroupModules(
      enabled: HomeworkModuleType[],
      disabled: HomeworkModuleType[] = [],
    ): void {
      groupModuleRepository.listByGroup.mockResolvedValue([
        ...enabled.map((t) => buildGroupModule(t, true)),
        ...disabled.map((t) => buildGroupModule(t, false)),
      ]);
    }

    it('creates an assignment with modules when all module types are enabled for the group', async () => {
      setupOwnership();
      setupGroupModules(['WRITING', 'READING']);
      const created = buildAssignmentRow();
      assignmentRepository.createWithModules.mockResolvedValue(created);

      const result = await service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW 1',
          modules: [
            { type: 'WRITING', order: 0, configJson: { prompt: 'p' }, weight: 60 },
            { type: 'READING', order: 1, configJson: { passage: 'p' }, weight: 40 },
          ],
        },
      );

      expect(result).toEqual(created);
      expect(assignmentRepository.createWithModules).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId: LESSON_ID,
          title: 'HW 1',
          isPublished: false,
          modules: [
            expect.objectContaining({ type: 'WRITING', weight: 60 }),
            expect.objectContaining({ type: 'READING', weight: 40 }),
          ],
        }),
        txClient,
      );
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws LESSON_NOT_FOUND when the lesson is missing', async () => {
      assignmentRepository.findLessonOwnership.mockResolvedValue(null);

      await expect(
        service.createForLesson(
          { userId: TEACHER_ID, role: 'TEACHER' },
          LESSON_ID,
          {
            title: 'HW 1',
            modules: [{ type: 'WRITING', order: 0, configJson: {}, weight: 100 }],
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
    });

    it('throws NOT_OWNING_TEACHER when the lesson belongs to another teacher', async () => {
      setupOwnership(OTHER_TEACHER_ID);

      await expect(
        service.createForLesson(
          { userId: TEACHER_ID, role: 'TEACHER' },
          LESSON_ID,
          {
            title: 'HW 1',
            modules: [{ type: 'WRITING', order: 0, configJson: {}, weight: 100 }],
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(groupModuleRepository.listByGroup).not.toHaveBeenCalled();
    });

    it('lets ADMIN bypass the teacher ownership check', async () => {
      setupOwnership(OTHER_TEACHER_ID);
      setupGroupModules(['WRITING']);
      assignmentRepository.createWithModules.mockResolvedValue(
        buildAssignmentRow(),
      );

      await expect(
        service.createForLesson(
          { userId: ADMIN_ID, role: 'ADMIN' },
          LESSON_ID,
          {
            title: 'HW 1',
            modules: [{ type: 'WRITING', order: 0, configJson: {}, weight: 100 }],
          },
        ),
      ).resolves.toBeDefined();
    });

    it('throws MODULE_NOT_ENABLED_FOR_GROUP when a module is disabled in GroupModule', async () => {
      setupOwnership();
      setupGroupModules(['WRITING'], ['READING']);

      await expect(
        service.createForLesson(
          { userId: TEACHER_ID, role: 'TEACHER' },
          LESSON_ID,
          {
            title: 'HW 1',
            modules: [
              { type: 'WRITING', order: 0, configJson: {}, weight: 100 },
              { type: 'READING', order: 1, configJson: {}, weight: 100 },
            ],
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_ENABLED_FOR_GROUP',
        }),
      });
      expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
    });

    it('throws MODULE_NOT_ENABLED_FOR_GROUP when a module type has no GroupModule row at all', async () => {
      setupOwnership();
      // GROUP only has WRITING enabled; the request asks for VOCABULARY
      // which is absent from the GroupModule table entirely.
      setupGroupModules(['WRITING']);

      await expect(
        service.createForLesson(
          { userId: TEACHER_ID, role: 'TEACHER' },
          LESSON_ID,
          {
            title: 'HW 1',
            modules: [
              { type: 'VOCABULARY', order: 0, configJson: {}, weight: 100 },
            ],
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_ENABLED_FOR_GROUP',
          details: expect.objectContaining({
            modules: expect.arrayContaining(['VOCABULARY']),
          }),
        }),
      });
    });
  });

  // ==================================================================
  // update
  // ==================================================================

  describe('update', () => {
    it('updates scalar fields without touching modules', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership(),
      );
      const updated = buildAssignmentRow({ title: 'Updated' });
      assignmentRepository.updateScalars.mockResolvedValue(updated);

      const result = await service.update(
        { userId: TEACHER_ID, role: 'TEACHER' },
        ASSIGNMENT_ID,
        { title: 'Updated' },
      );

      expect(result).toEqual(updated);
      expect(groupModuleRepository.listByGroup).not.toHaveBeenCalled();
      expect(assignmentRepository.replaceModules).not.toHaveBeenCalled();
    });

    it('replaces modules and re-validates against GroupModule when modules are provided', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership(),
      );
      groupModuleRepository.listByGroup.mockResolvedValue([
        buildGroupModule('WRITING', true),
        buildGroupModule('READING', true),
      ]);
      const newModules = [
        {
          id: 'mn1',
          assignmentId: ASSIGNMENT_ID,
          type: 'READING' as HomeworkModuleType,
          order: 0,
          configJson: {},
          weight: 100,
        } as AssignmentModule,
      ];
      assignmentRepository.replaceModules.mockResolvedValue(newModules);

      const result = await service.update(
        { userId: TEACHER_ID, role: 'TEACHER' },
        ASSIGNMENT_ID,
        {
          modules: [
            { type: 'READING', order: 0, configJson: { passage: 'x' }, weight: 100 },
          ],
        },
      );

      expect(assignmentRepository.replaceModules).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        [
          expect.objectContaining({ type: 'READING', order: 0, weight: 100 }),
        ],
        txClient,
      );
      expect(result.modules).toEqual(newModules);
    });

    it('rejects with MODULE_NOT_ENABLED_FOR_GROUP on update when a new module is disabled', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership(),
      );
      groupModuleRepository.listByGroup.mockResolvedValue([
        buildGroupModule('WRITING', true),
        buildGroupModule('LISTENING', false),
      ]);

      await expect(
        service.update(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
          {
            modules: [
              { type: 'LISTENING', order: 0, configJson: {}, weight: 100 },
            ],
          },
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_ENABLED_FOR_GROUP',
        }),
      });
      expect(assignmentRepository.replaceModules).not.toHaveBeenCalled();
    });

    it('returns 404 when the assignment does not exist', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(null);

      await expect(
        service.update(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
          { title: 'x' },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 403 when caller is not the owning teacher', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ teacherId: OTHER_TEACHER_ID }),
      );

      await expect(
        service.update(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
          { title: 'x' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ==================================================================
  // delete
  // ==================================================================

  describe('delete', () => {
    it('deletes a draft assignment that has no submissions', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: false }),
      );
      assignmentRepository.countSubmissions.mockResolvedValue(0);
      assignmentRepository.deleteById.mockResolvedValue({ count: 1 });

      await expect(
        service.delete(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses to delete a published assignment', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: true }),
      );

      await expect(
        service.delete(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ASSIGNMENT_PUBLISHED',
        }),
      });
      expect(assignmentRepository.deleteById).not.toHaveBeenCalled();
    });

    it('refuses to delete when submissions exist', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: false }),
      );
      assignmentRepository.countSubmissions.mockResolvedValue(3);

      await expect(
        service.delete(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ASSIGNMENT_HAS_SUBMISSIONS',
        }),
      });
      expect(assignmentRepository.deleteById).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // publish
  // ==================================================================

  describe('publish', () => {
    it('flips isPublished and emits a homework.assigned outbox event', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: false }),
      );
      groupModuleRepository.listByGroup.mockResolvedValue([
        buildGroupModule('WRITING', true),
      ]);
      assignmentRepository.transitionToPublished.mockResolvedValue(true);
      const refreshed = buildAssignmentRow({ isPublished: true });
      assignmentRepository.findById.mockResolvedValue(refreshed);

      const result = await service.publish(
        { userId: TEACHER_ID, role: 'TEACHER' },
        ASSIGNMENT_ID,
      );

      expect(result).toEqual(refreshed);
      expect(outboxService.create).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({
          topic: 'homework.assigned',
          idempotencyKey: `homework.assigned:${ASSIGNMENT_ID}`,
          payload: expect.objectContaining({
            assignmentId: ASSIGNMENT_ID,
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
          }),
        }),
      );
    });

    it('refuses to publish twice (already published)', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: true }),
      );

      await expect(
        service.publish(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ASSIGNMENT_ALREADY_PUBLISHED',
        }),
      });
      expect(assignmentRepository.transitionToPublished).not.toHaveBeenCalled();
    });

    it('re-validates GroupModule on publish — disabling a module after draft create blocks publish', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: false }),
      );
      // The draft used WRITING, but the teacher has since toggled it OFF.
      groupModuleRepository.listByGroup.mockResolvedValue([
        buildGroupModule('WRITING', false),
      ]);

      await expect(
        service.publish(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'MODULE_NOT_ENABLED_FOR_GROUP',
        }),
      });
      expect(assignmentRepository.transitionToPublished).not.toHaveBeenCalled();
    });

    it('returns 409 when transitionToPublished reports zero rows updated (race)', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership({ isPublished: false }),
      );
      groupModuleRepository.listByGroup.mockResolvedValue([
        buildGroupModule('WRITING', true),
      ]);
      assignmentRepository.transitionToPublished.mockResolvedValue(false);

      await expect(
        service.publish(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('throws ASSIGNMENT_NOT_FOUND when the row is missing', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(null);

      await expect(
        service.publish(
          { userId: TEACHER_ID, role: 'TEACHER' },
          ASSIGNMENT_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // getById / listForLesson
  // ==================================================================

  describe('reads', () => {
    it('getById returns the assignment without the lesson join', async () => {
      assignmentRepository.findByIdWithOwnership.mockResolvedValue(
        buildOwnership(),
      );

      const result = await service.getById(
        { userId: TEACHER_ID, role: 'TEACHER' },
        ASSIGNMENT_ID,
      );

      expect(result).toMatchObject({ id: ASSIGNMENT_ID, lessonId: LESSON_ID });
      expect((result as any).lesson).toBeUndefined();
    });

    it('listForLesson authorizes via lesson ownership', async () => {
      assignmentRepository.findLessonOwnership.mockResolvedValue({
        groupId: GROUP_ID,
        teacherId: TEACHER_ID,
      });
      assignmentRepository.listByLesson.mockResolvedValue([buildAssignmentRow()]);

      const result = await service.listForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
      );

      expect(result).toHaveLength(1);
    });

    it('listForLesson 404s when lesson does not exist', async () => {
      assignmentRepository.findLessonOwnership.mockResolvedValue(null);

      await expect(
        service.listForLesson(
          { userId: TEACHER_ID, role: 'TEACHER' },
          LESSON_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

// ====================================================================
// Runtime registry integration (Task 18.3)
// ====================================================================

describe('AssignmentService — runtime registry integration (Task 18.3)', () => {
  let service: AssignmentService;
  let prisma: any;
  let assignmentRepository: jest.Mocked<AssignmentRepository>;
  let groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let txClient: any;

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };
    assignmentRepository = {
      findById: jest.fn(),
      findByIdWithOwnership: jest.fn(),
      findLessonOwnership: jest.fn(),
      listByLesson: jest.fn(),
      countSubmissions: jest.fn(),
      createWithModules: jest.fn(),
      updateScalars: jest.fn(),
      replaceModules: jest.fn(),
      transitionToPublished: jest.fn(),
      deleteById: jest.fn(),
    } as any;
    groupModuleRepository = {
      seedForGroup: jest.fn(),
      listByGroup: jest.fn(),
      findOne: jest.fn(),
    } as any;
    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;
    // Use the real registry — WritingRuntime is registered out of the
    // box, exactly as production wiring does it.
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    service = new AssignmentService(
      prisma,
      assignmentRepository,
      groupModuleRepository,
      outboxService,
      runtimeRegistry,
    );
  });

  function buildOwnershipRow(): any {
    return {
      id: ASSIGNMENT_ID,
      lessonId: LESSON_ID,
      title: 't',
      description: null,
      dueAt: null,
      totalPoints: 100,
      isPublished: false,
      createdAt: new Date(),
      modules: [],
      lesson: {
        id: LESSON_ID,
        groupId: GROUP_ID,
        group: {
          id: GROUP_ID,
          courseId: 'c',
          course: { teacherId: TEACHER_ID },
        },
      },
    };
  }

  it('persists a WRITING module when configJson passes the WritingRuntime schema', async () => {
    assignmentRepository.findLessonOwnership.mockResolvedValue({
      groupId: GROUP_ID,
      teacherId: TEACHER_ID,
    });
    groupModuleRepository.listByGroup.mockResolvedValue([
      {
        groupId: GROUP_ID,
        moduleType: 'WRITING' as HomeworkModuleType,
        isEnabled: true,
        enabledAt: new Date(),
        disabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    assignmentRepository.createWithModules.mockResolvedValue(
      buildOwnershipRow() as any,
    );

    await service.createForLesson(
      { userId: TEACHER_ID, role: 'TEACHER' },
      LESSON_ID,
      {
        title: 'HW',
        modules: [
          {
            type: 'WRITING',
            order: 0,
            configJson: {
              prompt: 'Write 200 words on tourism in Uzbekistan',
              minWords: 100,
              maxWords: 300,
              rubric: { criteria: [{ name: 'Grammar', weight: 50 }] },
            },
            weight: 100,
          },
        ],
      },
    );

    expect(assignmentRepository.createWithModules).toHaveBeenCalledWith(
      expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({
            type: 'WRITING',
            configJson: expect.objectContaining({
              prompt: expect.any(String),
            }),
          }),
        ]),
      }),
      txClient,
    );
  });

  it('rejects a WRITING module with invalid config through 400 INVALID_MODULE_CONFIG', async () => {
    assignmentRepository.findLessonOwnership.mockResolvedValue({
      groupId: GROUP_ID,
      teacherId: TEACHER_ID,
    });
    groupModuleRepository.listByGroup.mockResolvedValue([
      {
        groupId: GROUP_ID,
        moduleType: 'WRITING' as HomeworkModuleType,
        isEnabled: true,
        enabledAt: new Date(),
        disabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW',
          modules: [
            {
              type: 'WRITING',
              order: 0,
              configJson: { minWords: 100 }, // missing required prompt
              weight: 100,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_MODULE_CONFIG',
        details: expect.objectContaining({
          index: 0,
          type: 'WRITING',
        }),
      }),
    });
    expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
  });
});

// ====================================================================
// Reading runtime integration (Task 18.4)
// ====================================================================

describe('AssignmentService — Reading runtime integration (Task 18.4)', () => {
  let service: AssignmentService;
  let prisma: any;
  let assignmentRepository: jest.Mocked<AssignmentRepository>;
  let groupModuleRepository: jest.Mocked<GroupModuleRepository>;
  let outboxService: jest.Mocked<OutboxService>;
  let runtimeRegistry: HomeworkModuleRuntimeRegistry;
  let txClient: any;

  beforeEach(() => {
    txClient = {};
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txClient),
      ),
    };
    assignmentRepository = {
      findById: jest.fn(),
      findByIdWithOwnership: jest.fn(),
      findLessonOwnership: jest.fn(),
      listByLesson: jest.fn(),
      countSubmissions: jest.fn(),
      createWithModules: jest.fn(),
      updateScalars: jest.fn(),
      replaceModules: jest.fn(),
      transitionToPublished: jest.fn(),
      deleteById: jest.fn(),
    } as any;
    groupModuleRepository = {
      seedForGroup: jest.fn(),
      listByGroup: jest.fn(),
      findOne: jest.fn(),
    } as any;
    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
      createMany: jest.fn(),
    } as any;
    // Use the real registry — ReadingRuntime is registered alongside
    // WritingRuntime out of the box.
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    service = new AssignmentService(
      prisma,
      assignmentRepository,
      groupModuleRepository,
      outboxService,
      runtimeRegistry,
    );
  });

  function buildOwnershipRow(): any {
    return {
      id: ASSIGNMENT_ID,
      lessonId: LESSON_ID,
      title: 't',
      description: null,
      dueAt: null,
      totalPoints: 100,
      isPublished: false,
      createdAt: new Date(),
      modules: [],
      lesson: {
        id: LESSON_ID,
        groupId: GROUP_ID,
        group: {
          id: GROUP_ID,
          courseId: 'c',
          course: { teacherId: TEACHER_ID },
        },
      },
    };
  }

  function setupReadingEnabled(): void {
    assignmentRepository.findLessonOwnership.mockResolvedValue({
      groupId: GROUP_ID,
      teacherId: TEACHER_ID,
    });
    groupModuleRepository.listByGroup.mockResolvedValue([
      {
        groupId: GROUP_ID,
        moduleType: 'READING' as HomeworkModuleType,
        isEnabled: true,
        enabledAt: new Date(),
        disabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  }

  it('persists a READING module when configJson passes the ReadingRuntime schema', async () => {
    setupReadingEnabled();
    assignmentRepository.createWithModules.mockResolvedValue(
      buildOwnershipRow() as any,
    );

    await service.createForLesson(
      { userId: TEACHER_ID, role: 'TEACHER' },
      LESSON_ID,
      {
        title: 'Reading HW',
        modules: [
          {
            type: 'READING',
            order: 0,
            configJson: {
              passage: 'A short passage about Tashkent.',
              questions: [
                {
                  id: 'q1',
                  prompt: 'Where is the passage about?',
                  kind: 'mcq',
                  choices: ['Tashkent', 'Samarkand'],
                  answer: 'Tashkent',
                },
                {
                  id: 'q2',
                  prompt: 'Summarise the passage.',
                  kind: 'short',
                  answer: 'A description of Tashkent.',
                },
              ],
            },
            weight: 100,
          },
        ],
      },
    );

    expect(assignmentRepository.createWithModules).toHaveBeenCalledWith(
      expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({
            type: 'READING',
            configJson: expect.objectContaining({
              passage: expect.any(String),
              questions: expect.any(Array),
            }),
          }),
        ]),
      }),
      txClient,
    );
  });

  it('rejects a READING module missing the passage with 400 INVALID_MODULE_CONFIG', async () => {
    setupReadingEnabled();

    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'Reading HW',
          modules: [
            {
              type: 'READING',
              order: 0,
              configJson: {
                // passage missing
                questions: [
                  { id: 'q1', prompt: 'p', kind: 'short' },
                ],
              },
              weight: 100,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_MODULE_CONFIG',
        details: expect.objectContaining({
          index: 0,
          type: 'READING',
        }),
      }),
    });
    expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
  });

  it('rejects a READING module whose mcq answer is not in choices', async () => {
    setupReadingEnabled();

    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'Reading HW',
          modules: [
            {
              type: 'READING',
              order: 0,
              configJson: {
                passage: 'Hello world.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'pick one',
                    kind: 'mcq',
                    choices: ['a', 'b'],
                    answer: 'c',
                  },
                ],
              },
              weight: 100,
            },
          ],
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'INVALID_MODULE_CONFIG',
        details: expect.objectContaining({ type: 'READING' }),
      }),
    });
  });
});
