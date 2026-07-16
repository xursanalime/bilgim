import { BadRequestException } from '@nestjs/common';
import { GroupModule, HomeworkModuleType } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupModuleRepository } from '../catalog/repositories/group-module.repository';
import { AssignmentService } from './assignment.service';
import { AssignmentRepository } from './repositories/assignment.repository';
import { LANGUAGE_MODULE_TYPES } from './language-module-types';
import { HomeworkModuleRuntimeRegistry } from './runtimes';

/**
 * Unit tests for the English-Only Platform Refocus homework restriction
 * (Task 5.1, Requirements 6.1, 6.2, 6.3, 6.6).
 *
 * Coverage:
 *   - Legacy_Module_Type rejected with `MODULE_TYPE_NOT_SUPPORTED` (400).
 *   - A language type that is disabled for the group is rejected with
 *     `MODULE_NOT_ENABLED_FOR_GROUP` (server-side enabled-state gate).
 *   - Enabled language types are accepted.
 */

const TEACHER_ID = '11111111-1111-1111-1111-111111111111';
const LESSON_ID = '33333333-3333-3333-3333-333333333333';
const GROUP_ID = '44444444-4444-4444-4444-444444444444';
const ASSIGNMENT_ID = '55555555-5555-5555-5555-555555555555';

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

function buildCreatedRow(type: HomeworkModuleType): any {
  return {
    id: ASSIGNMENT_ID,
    lessonId: LESSON_ID,
    title: 'HW',
    description: null,
    dueAt: null,
    totalPoints: 100,
    isPublished: false,
    createdAt: new Date(),
    modules: [
      {
        id: 'm1',
        assignmentId: ASSIGNMENT_ID,
        type,
        order: 0,
        configJson: {},
        weight: 100,
      },
    ],
  };
}

describe('AssignmentService — language module restriction (Task 5.1)', () => {
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
    // Empty registry so opaque `configJson: {}` payloads skip runtime
    // shape validation and we exercise the type-restriction gate only.
    runtimeRegistry = new HomeworkModuleRuntimeRegistry();
    (runtimeRegistry as any).runtimes.clear();

    service = new AssignmentService(
      prisma,
      assignmentRepository,
      groupModuleRepository,
      outboxService,
      runtimeRegistry,
    );

    assignmentRepository.findLessonOwnership.mockResolvedValue({
      groupId: GROUP_ID,
      teacherId: TEACHER_ID,
    });
  });

  it('rejects a Legacy_Module_Type with MODULE_TYPE_NOT_SUPPORTED (400)', async () => {
    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW',
          modules: [
            { type: 'MULTIPLE_CHOICE', order: 0, configJson: {}, weight: 100 },
          ],
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'MODULE_TYPE_NOT_SUPPORTED',
        details: expect.objectContaining({
          unsupported: expect.arrayContaining(['MULTIPLE_CHOICE']),
        }),
      }),
    });
    // The legacy check fires before any group-enablement lookup or write.
    expect(groupModuleRepository.listByGroup).not.toHaveBeenCalled();
    expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
  });

  it('rejects legacy types via BadRequestException (HTTP 400)', async () => {
    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW',
          modules: [
            { type: 'MATH_WORD_PROBLEM', order: 0, configJson: {}, weight: 100 },
            { type: 'CODE_REVIEW', order: 1, configJson: {}, weight: 100 },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a disabled-but-language type with MODULE_NOT_ENABLED_FOR_GROUP', async () => {
    // WRITING is a valid language type but is toggled OFF for the group.
    groupModuleRepository.listByGroup.mockResolvedValue([
      buildGroupModule('WRITING', false),
    ]);

    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW',
          modules: [{ type: 'WRITING', order: 0, configJson: {}, weight: 100 }],
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'MODULE_NOT_ENABLED_FOR_GROUP',
      }),
    });
    expect(assignmentRepository.createWithModules).not.toHaveBeenCalled();
  });

  it('accepts an enabled language type', async () => {
    groupModuleRepository.listByGroup.mockResolvedValue([
      buildGroupModule('WRITING', true),
      buildGroupModule('READING', true),
    ]);
    assignmentRepository.createWithModules.mockResolvedValue(
      buildCreatedRow('WRITING'),
    );

    const result = await service.createForLesson(
      { userId: TEACHER_ID, role: 'TEACHER' },
      LESSON_ID,
      {
        title: 'HW',
        modules: [
          { type: 'WRITING', order: 0, configJson: {}, weight: 60 },
          { type: 'READING', order: 1, configJson: {}, weight: 40 },
        ],
      },
    );

    expect(result.id).toBe(ASSIGNMENT_ID);
    expect(assignmentRepository.createWithModules).toHaveBeenCalledTimes(1);
  });

  it('accepts every one of the eight language module types when enabled', async () => {
    groupModuleRepository.listByGroup.mockResolvedValue(
      LANGUAGE_MODULE_TYPES.map((t) => buildGroupModule(t, true)),
    );
    assignmentRepository.createWithModules.mockResolvedValue(
      buildCreatedRow('WRITING'),
    );

    await expect(
      service.createForLesson(
        { userId: TEACHER_ID, role: 'TEACHER' },
        LESSON_ID,
        {
          title: 'HW',
          modules: LANGUAGE_MODULE_TYPES.map((type, order) => ({
            type,
            order,
            configJson: {},
            weight: 100,
          })),
        },
      ),
    ).resolves.toBeDefined();
    expect(assignmentRepository.createWithModules).toHaveBeenCalledTimes(1);
  });
});
