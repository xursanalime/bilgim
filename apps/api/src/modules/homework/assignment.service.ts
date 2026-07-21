import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Assignment,
  AssignmentModule,
  HomeworkModuleType,
  PrismaClient,
} from '@prisma/client';
import { ZodError } from 'zod';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { GroupModuleRepository } from '../catalog/repositories/group-module.repository';
import {
  AssignmentModuleSeedInput,
  AssignmentRepository,
} from './repositories/assignment.repository';
import {
  AssignmentModuleInputDto,
  CreateAssignmentDto,
  UpdateAssignmentDto,
} from './dto';
import { HomeworkModuleRuntimeRegistry } from './runtimes/registry';
import { HomeworkRuntimeError } from './runtimes/types';

/** JWT role values relevant for assignment authorization. */
type AssignmentActorRole = 'TEACHER' | 'ADMIN';

export interface AssignmentActor {
  userId: string;
  role: AssignmentActorRole;
}

type AssignmentWithModules = Assignment & { modules: AssignmentModule[] };

/**
 * AssignmentService — owns the AssignmentBuilder lifecycle for the
 * Homework module (Task 17.3, Req 11.5, 11.8).
 *
 * Responsibilities:
 *   - Create / update / delete / publish `Assignment` rows together with
 *     their `AssignmentModule` set.
 *   - Enforce that every selected module type is currently enabled for
 *     the lesson's parent group via `GroupModule.isEnabled = true`
 *     (Req 11.8, server-side gate — UI bypass protection).
 *   - Authorize ownership: only the teacher who owns the lesson's
 *     course (or ADMIN) may mutate. ADMIN read-only paths are not
 *     handled here because the builder is teacher-facing.
 *   - Fan out `homework.assigned` to enrolled students on publish via the
 *     transactional outbox (Req 16.2 — HOMEWORK_ASSIGNED notification).
 *
 * The service does NOT touch the SpecialtyModule catalog; the
 * GroupModule toggle state is the authoritative gate (Task 17.2 already
 * keeps GroupModule in sync with SpecialtyModule).
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly assignmentRepository: AssignmentRepository,
    private readonly groupModuleRepository: GroupModuleRepository,
    private readonly outboxService: OutboxService,
    private readonly runtimeRegistry: HomeworkModuleRuntimeRegistry,
  ) {}

  // ==================================================================
  // Create (Req 11.5, 11.8)
  // ==================================================================

  /**
   * Create an `Assignment` (status: draft) inside the given lesson.
   *
   * Flow:
   *   1. Resolve `lesson → group → course.teacherId` and authorize the
   *      caller (404 LESSON_NOT_FOUND when missing, 403 NOT_OWNING_TEACHER
   *      when the lesson belongs to a different teacher).
   *   2. Re-validate every module type against the parent group's
   *      `GroupModule.isEnabled = true` set (Req 11.8). Any failure
   *      raises 409 MODULE_NOT_ENABLED_FOR_GROUP with the offending types.
   *   3. Create the Assignment and its AssignmentModule rows in one
   *      Prisma `$transaction`.
   *
   * Notifications: not emitted here. Assignments start as drafts and only
   * fan out HOMEWORK_ASSIGNED when explicitly published.
   */
  async createForLesson(
    actor: AssignmentActor,
    lessonId: string,
    dto: CreateAssignmentDto,
  ): Promise<AssignmentWithModules> {
    const ownership = await this.assignmentRepository.findLessonOwnership(
      lessonId,
    );
    if (!ownership) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${lessonId} not found`,
      });
    }
    this.assertOwnership(actor, ownership.teacherId);

    await this.assertModulesEnabled(ownership.groupId, dto.modules);

    const seedModules = this.toSeedInputs(dto.modules);
    this.validateModuleConfigs(seedModules);
    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await this.assignmentRepository.createWithModules(
        {
          lessonId,
          title: dto.title,
          description: dto.description ?? null,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          ...(dto.totalPoints !== undefined && {
            totalPoints: dto.totalPoints,
          }),
          isPublished: false,
          modules: seedModules,
        },
        tx,
      );
      return created;
    });

    this.logger.log(
      `Assignment ${assignment.id} (draft) created on lesson ${lessonId} ` +
        `by ${actor.role} ${actor.userId} with ${assignment.modules.length} module(s)`,
    );
    return assignment;
  }

  // ==================================================================
  // Read
  // ==================================================================

  async getById(
    actor: AssignmentActor,
    id: string,
  ): Promise<AssignmentWithModules> {
    const assignment = await this.assignmentRepository.findByIdWithOwnership(id);
    if (!assignment) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${id} not found`,
      });
    }
    this.assertOwnership(actor, assignment.lesson.group.course.teacherId);
    const { lesson: _lesson, ...plain } = assignment;
    return plain as AssignmentWithModules;
  }

  async listForLesson(
    actor: AssignmentActor,
    lessonId: string,
  ): Promise<AssignmentWithModules[]> {
    const ownership = await this.assignmentRepository.findLessonOwnership(
      lessonId,
    );
    if (!ownership) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${lessonId} not found`,
      });
    }
    this.assertOwnership(actor, ownership.teacherId);
    return this.assignmentRepository.listByLesson(lessonId);
  }

  // ==================================================================
  // Update (Req 11.5, 11.8 — re-validate modules on edit)
  // ==================================================================

  /**
   * Patch an existing assignment. Supports updating any of:
   *   - scalar fields: title, description, dueAt, totalPoints, isPublished
   *   - the entire module set (via `modules`)
   *
   * When `modules` is provided every entry is re-validated against the
   * group's currently enabled GroupModule set (Req 11.8). The previous
   * module rows are then atomically replaced inside one transaction.
   */
  async update(
    actor: AssignmentActor,
    id: string,
    dto: UpdateAssignmentDto,
  ): Promise<AssignmentWithModules> {
    const existing = await this.assignmentRepository.findByIdWithOwnership(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${id} not found`,
      });
    }
    this.assertOwnership(actor, existing.lesson.group.course.teacherId);

    if (dto.modules) {
      await this.assertModulesEnabled(existing.lesson.groupId, dto.modules);
    }

    const replacementSeed = dto.modules
      ? this.toSeedInputs(dto.modules)
      : null;
    if (replacementSeed) {
      this.validateModuleConfigs(replacementSeed);
    }

    return this.prisma.$transaction(async (tx) => {
      const scalars = {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.dueAt !== undefined && {
          dueAt: dto.dueAt === null ? null : new Date(dto.dueAt),
        }),
        ...(dto.totalPoints !== undefined && {
          totalPoints: dto.totalPoints,
        }),
        ...(dto.isPublished !== undefined && {
          isPublished: dto.isPublished,
        }),
      };
      const hasScalarChange = Object.keys(scalars).length > 0;
      let updated: AssignmentWithModules = existing;
      if (hasScalarChange) {
        updated = await this.assignmentRepository.updateScalars(id, scalars, tx);
      }
      if (dto.modules) {
        const modules = await this.assignmentRepository.replaceModules(
          id,
          replacementSeed!,
          tx,
        );
        updated = { ...updated, modules };
      }
      return updated;
    });
  }

  // ==================================================================
  // Delete (Req 11.5)
  // ==================================================================

  /**
   * Delete an assignment. Allowed only when:
   *   - `isPublished = false`, AND
   *   - no `Submission` rows exist for the assignment.
   *
   * Otherwise raises 409 (`ASSIGNMENT_PUBLISHED` /
   * `ASSIGNMENT_HAS_SUBMISSIONS`). This protects student work and
   * outstanding HOMEWORK_ASSIGNED notifications from being silently
   * orphaned.
   */
  async delete(actor: AssignmentActor, id: string): Promise<void> {
    const existing = await this.assignmentRepository.findByIdWithOwnership(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${id} not found`,
      });
    }
    this.assertOwnership(actor, existing.lesson.group.course.teacherId);

    if (existing.isPublished) {
      throw new ConflictException({
        code: 'ASSIGNMENT_PUBLISHED',
        message:
          'Cannot delete a published assignment. Unpublish first or archive it.',
      });
    }
    const submissionCount = await this.assignmentRepository.countSubmissions(id);
    if (submissionCount > 0) {
      throw new ConflictException({
        code: 'ASSIGNMENT_HAS_SUBMISSIONS',
        message: `Cannot delete assignment with ${submissionCount} existing submission(s).`,
      });
    }

    const result = await this.assignmentRepository.deleteById(id);
    if (result.count === 0) {
      // Concurrent delete — surface the same 404 the second caller would
      // have seen on the initial fetch.
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${id} not found`,
      });
    }
    this.logger.log(
      `Assignment ${id} deleted by ${actor.role} ${actor.userId}`,
    );
  }

  // ==================================================================
  // Publish (Req 11.5, 16.2 — HOMEWORK_ASSIGNED fan-out)
  // ==================================================================

  /**
   * Flip `isPublished=true` and emit a `homework.assigned` outbox event
   * inside the same transaction. The notification fan-out worker
   * expands the event into one HOMEWORK_ASSIGNED notification per
   * APPROVED student of the lesson's group (same pattern as
   * `lesson.published`).
   *
   * Idempotent: a second publish call after a successful first one
   * raises 409 `ASSIGNMENT_ALREADY_PUBLISHED`. The outbox idempotency
   * key (`homework.assigned:{assignmentId}`) further guarantees the
   * fan-out is only enqueued once even if the transition were retried.
   */
  async publish(
    actor: AssignmentActor,
    id: string,
  ): Promise<AssignmentWithModules> {
    const existing = await this.assignmentRepository.findByIdWithOwnership(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${id} not found`,
      });
    }
    this.assertOwnership(actor, existing.lesson.group.course.teacherId);
    if (existing.isPublished) {
      throw new ConflictException({
        code: 'ASSIGNMENT_ALREADY_PUBLISHED',
        message: `Assignment ${id} is already published`,
      });
    }

    // Re-validate the module set on publish — protects against the case
    // where a teacher disabled a GroupModule between draft creation and
    // publish (Req 11.8).
    await this.assertModulesEnabled(
      existing.lesson.groupId,
      existing.modules.map((m) => ({ type: m.type })),
    );

    const groupId = existing.lesson.groupId;
    const teacherId = existing.lesson.group.course.teacherId;

    return this.prisma.$transaction(async (tx) => {
      const transitioned = await this.assignmentRepository.transitionToPublished(
        id,
        tx,
      );
      if (!transitioned) {
        throw new ConflictException({
          code: 'ASSIGNMENT_ALREADY_PUBLISHED',
          message: `Assignment ${id} is no longer in draft`,
        });
      }

      await this.outboxService.create(tx, {
        topic: 'homework.assigned',
        payload: {
          assignmentId: id,
          lessonId: existing.lessonId,
          groupId,
          teacherId,
          title: existing.title,
        },
        idempotencyKey: `homework.assigned:${id}`,
      });

      const refreshed = await this.assignmentRepository.findById(id, tx);
      if (!refreshed) {
        throw new NotFoundException({
          code: 'ASSIGNMENT_NOT_FOUND',
          message: `Assignment ${id} not found`,
        });
      }
      this.logger.log(
        `Assignment ${id} published (group=${groupId} teacher=${teacherId})`,
      );
      return refreshed;
    });
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Verify every module type in the input is currently enabled for the
   * given group via `GroupModule.isEnabled = true`. Module types not
   * present at all in the GroupModule table are also rejected (the
   * specialty catalog never seeded them — Req 11.6 territory, but the
   * MODULE_NOT_ENABLED_FOR_GROUP error code keeps the contract simple).
   *
   * Throws 409 `MODULE_NOT_ENABLED_FOR_GROUP` listing every offending
   * module type at once so the UI can surface a single error.
   */
  private async assertModulesEnabled(
    groupId: string,
    modules: Array<{ type: HomeworkModuleType }>,
  ): Promise<void> {
    if (modules.length === 0) return;

    const groupModules = await this.groupModuleRepository.listByGroup(groupId);
    const enabledTypes = new Set(
      groupModules.filter((m) => m.isEnabled).map((m) => m.moduleType),
    );

    const offending = new Set<HomeworkModuleType>();
    for (const m of modules) {
      if (!enabledTypes.has(m.type)) offending.add(m.type);
    }

    if (offending.size > 0) {
      throw new ConflictException({
        code: 'MODULE_NOT_ENABLED_FOR_GROUP',
        message:
          `These module types are not enabled for group ${groupId}: ` +
          `${Array.from(offending).join(', ')}`,
        details: { groupId, modules: Array.from(offending) },
      });
    }
  }

  /**
   * Validate every module's `configJson` through its registered
   * runtime (Task 18.3). Modules whose type has no runtime registered
   * are accepted as opaque JSON for forward-compat — a new module type
   * can be plumbed end-to-end before its runtime lands.
   *
   * On a Zod failure or a `HomeworkRuntimeError` we throw a 400
   * `INVALID_MODULE_CONFIG` with the offending module index + type so
   * the assignment-builder UI can surface the error inline.
   */
  private validateModuleConfigs(
    modules: AssignmentModuleSeedInput[],
  ): void {
    modules.forEach((m, index) => {
      const runtime = this.runtimeRegistry.get(m.type);
      if (!runtime) return; // opaque-JSON forward-compat path
      try {
        runtime.validateConfig(m.configJson);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new BadRequestException({
            code: 'INVALID_MODULE_CONFIG',
            message: `Module #${index} (${m.type}) has invalid configJson`,
            details: {
              index,
              type: m.type,
              issues: error.issues,
            },
          });
        }
        if (error instanceof HomeworkRuntimeError) {
          throw new BadRequestException({
            code: error.code,
            message: error.message,
            details: { index, type: m.type, ...(error.details ?? {}) },
          });
        }
        throw error;
      }
    });
  }

  private toSeedInputs(
    modules: AssignmentModuleInputDto[],
  ): AssignmentModuleSeedInput[] {
    return modules.map((m) => ({
      type: m.type,
      order: m.order,
      // Pass through whatever JSON the client supplied; the module-type
      // runtime is responsible for shape validation.
      configJson: m.configJson ?? {},
      weight: m.weight,
    }));
  }

  /**
   * Authorize a mutation against the lesson's owning teacher. Throws
   * 403 NOT_OWNING_TEACHER for a TEACHER caller who does not match;
   * ADMIN bypasses the teacher check (admins may edit any assignment
   * for moderation purposes).
   */
  private assertOwnership(
    actor: AssignmentActor,
    ownerTeacherId: string,
  ): void {
    if (actor.role === 'ADMIN') return;
    if (actor.userId !== ownerTeacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only manage assignments on your own lessons',
      });
    }
  }
}
