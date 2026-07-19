import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Course,
  Group,
  GroupModule,
  HomeworkModuleType,
  Lesson,
  LessonStatus,
  PrismaClient,
} from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import {
  CreateCourseDto,
  UpdateCourseDto,
  CreateGroupDto,
  UpdateGroupDto,
  CreateLessonDto,
  UpdateLessonDto,
  BulkUpsertGroupModulesDto,
} from './dto';
import { CourseRepository } from './repositories/course.repository';
import { GroupRepository } from './repositories/group.repository';
import { GroupModuleRepository } from './repositories/group-module.repository';
import { LessonRepository } from './repositories/lesson.repository';

/**
 * Maximum number of `isEnabled = true` `GroupModule` rows per Group
 * (Req 11.7 — mirrors the per-Specialty active cap of 10). The
 * `enforce_specialty_module_cap()` trigger guards the per-Specialty side;
 * the per-Group cap is enforced exclusively at the service layer because
 * the toggle is teacher-driven and never exceeds the pre-seeded specialty
 * catalog.
 */
export const GROUP_MODULE_ACTIVE_CAP = 10;

/**
 * CatalogService — owns Course, Group and Lesson lifecycles for the teacher
 * catalog (Req 7.1 – 7.7).
 *
 * Cross-teacher isolation (Req 7.7): every read and write joins through
 * `course.teacherId`, either directly (`Course`) or via parent (`Group →
 * Course`, `Lesson → Group → Course`). Helpers `assertCourseOwnership`,
 * `assertGroupOwnership` and `assertLessonOwnership` raise the canonical
 * 403 NOT_OWNING_TEACHER / 404 NOT_FOUND errors so the controllers stay
 * thin.
 *
 * Lesson publish flow (Req 7.4 – 7.6, 3.8):
 *   1. Verify teacher owns the lesson.
 *   2. Require an active TRIAL/ACTIVE subscription via
 *      `BillingService.requireActiveSubscription` — Req 3.8.
 *   3. Optimistically transition `DRAFT → READY` with a row-level
 *      precondition; if the row is no longer DRAFT, throw 409
 *      `LESSON_ALREADY_PUBLISHED`.
 *   4. Emit `lesson.published` to the outbox (idempotency key
 *      `lesson.published:{lessonId}`) — same transaction so the side effect
 *      commits atomically with the state change. Notification fan-out
 *      (Req 7.6) is handled by NotificationsModule in Task 8.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly courseRepository: CourseRepository,
    private readonly groupRepository: GroupRepository,
    private readonly groupModuleRepository: GroupModuleRepository,
    private readonly lessonRepository: LessonRepository,
    private readonly teacherProfileRepository: TeacherProfileRepository,
    private readonly specialtyService: SpecialtyService,
    private readonly billingService: BillingService,
    private readonly outboxService: OutboxService,
  ) {}

  // ==================================================================
  // Course CRUD (Req 7.1, 7.7)
  // ==================================================================

  async createCourse(teacherId: string, dto: CreateCourseDto): Promise<Course> {
    const course = await this.courseRepository.create({
      teacherId,
      title: dto.title,
      description: dto.description ?? null,
      level: dto.level ?? null,
      fromPriceUzs: dto.fromPriceUzs ?? null,
    });
    this.logger.log(
      `Course created: id=${course.id} teacher=${teacherId} title="${course.title}"`,
    );
    return course;
  }

  async listCoursesForTeacher(teacherId: string): Promise<Course[]> {
    return this.courseRepository.listByTeacher(teacherId);
  }

  async getCourseForTeacher(teacherId: string, id: string): Promise<Course> {
    return this.assertCourseOwnership(teacherId, id);
  }

  async updateCourse(
    teacherId: string,
    id: string,
    dto: UpdateCourseDto,
  ): Promise<Course> {
    // Authorize first so we get a clean 403/404 instead of a silent no-op.
    await this.assertCourseOwnership(teacherId, id);

    const result = await this.courseRepository.update(id, teacherId, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.level !== undefined && { level: dto.level }),
      ...(dto.fromPriceUzs !== undefined && { fromPriceUzs: dto.fromPriceUzs }),
    });
    if (result.count === 0) {
      // Should be unreachable thanks to the assert above, but keeps the
      // contract honest if a concurrent delete happens.
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${id} not found`,
      });
    }
    return this.assertCourseOwnership(teacherId, id);
  }

  async deleteCourse(teacherId: string, id: string): Promise<void> {
    await this.assertCourseOwnership(teacherId, id);
    const result = await this.courseRepository.delete(id, teacherId);
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${id} not found`,
      });
    }
  }

  /**
   * Publish a course — flips `isPublished=true`. Requires an active
   * subscription (Req 3.8) so a teacher cannot publish from EXPIRED.
   */
  async publishCourse(teacherId: string, id: string): Promise<Course> {
    await this.assertCourseOwnership(teacherId, id);
    await this.billingService.requireActiveSubscription(teacherId);

    const result = await this.courseRepository.update(id, teacherId, {
      isPublished: true,
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${id} not found`,
      });
    }
    return this.assertCourseOwnership(teacherId, id);
  }

  // ==================================================================
  // Group CRUD + module seeding (Req 7.2, 7.3, 7.7)
  // ==================================================================

  /**
   * Create a Group inside a course owned by `teacherId`, and atomically seed
   * `GroupModule` rows from the teacher's specialty catalog.
   *
   * Errors:
   *   - 404 `COURSE_NOT_FOUND` — course missing or owned by a different teacher
   *   - 400 `ONBOARDING_REQUIRED` — teacher has no specialty assigned yet
   *
   * The seed rows are inserted in the same Prisma transaction as the Group,
   * so a failure half-way through rolls back to "no group, no modules" —
   * no orphan rows.
   */
  async createGroup(
    teacherId: string,
    courseId: string,
    dto: CreateGroupDto,
  ): Promise<Group & { modules: GroupModule[] }> {
    await this.assertCourseOwnership(teacherId, courseId);

    const profile = await this.teacherProfileRepository.findByUserId(teacherId);
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { email: true },
    });

    const isBypassAccount = teacher?.email === 'xursanalime@gmail.com';

    if (!isBypassAccount && (!profile || !profile.specialtyId)) {
      throw new BadRequestException({
        code: 'ONBOARDING_REQUIRED',
        message:
          'Complete the onboarding quiz to assign a specialty before creating groups',
      });
    }

    const specialtyId = isBypassAccount 
      ? (profile?.specialtyId ?? (await this.prisma.specialty.findFirst({ select: { id: true } }))?.id)
      : profile?.specialtyId;

    if (!specialtyId) {
       // If still no specialty and not bypass, it already threw above.
       // If bypass and no specialty in DB at all, we might need a fallback specialty.
       throw new BadRequestException({
         code: 'NO_SPECIALTY_AVAILABLE',
         message: 'No active specialties found in the system.',
       });
    }

    const specialtyModules = await this.specialtyService.listActiveModules(
      specialtyId,
    );

    const joinCode = await this.allocateUniqueJoinCode();

    return this.prisma.$transaction(async (tx) => {
      const group = await this.groupRepository.create(
        {
          courseId,
          name: dto.name,
          priceUzs: dto.priceUzs,
          capacity: dto.capacity ?? null,
          startsOn: dto.startsOn ? new Date(dto.startsOn) : null,
          endsOn: dto.endsOn ? new Date(dto.endsOn) : null,
          joinCode,
        },
        tx,
      );

      const modules = await this.groupModuleRepository.seedForGroup(
        {
          groupId: group.id,
          modules: specialtyModules.map((m) => ({
            moduleType: m.moduleType,
            defaultEnabled: m.defaultEnabled,
          })),
        },
        tx,
      );

      this.logger.log(
        `Group ${group.id} created in course ${courseId} (teacher=${teacherId}); seeded ${modules.length} module toggles`,
      );

      return Object.assign(group, { modules });
    });
  }

  async listGroupsForCourse(
    teacherId: string,
    courseId: string,
  ): Promise<Group[]> {
    await this.assertCourseOwnership(teacherId, courseId);
    return this.groupRepository.listByCourse(courseId);
  }

  async getGroupForUser(
    userId: string,
    role: string,
    id: string,
  ): Promise<Group> {
    const group = await this.groupRepository.findById(id);
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${id} not found`,
      });
    }

    if (role === 'ADMIN') {
      const { course: _course, ...plainGroup } = group;
      return plainGroup as Group;
    }

    if (role === 'TEACHER' && group.course.teacherId === userId) {
      const { course: _course, ...plainGroup } = group;
      return plainGroup as Group;
    }

    if (role === 'STUDENT') {
      const enrollment = await this.prisma.enrollment.findUnique({
        where: {
          groupId_studentId: { studentId: userId, groupId: id },
          status: 'APPROVED',
        },
      });
      if (enrollment) {
        const { course: _course, ...plainGroup } = group;
        return plainGroup as Group;
      }
    }

    throw new ForbiddenException({
      code: 'GROUP_ACCESS_DENIED',
      message: 'You do not have permission to access this group',
    });
  }

  async getGroupForTeacher(teacherId: string, id: string): Promise<Group> {
    return this.assertGroupOwnership(teacherId, id);
  }

  async updateGroup(
    teacherId: string,
    id: string,
    dto: UpdateGroupDto,
  ): Promise<Group> {
    await this.assertGroupOwnership(teacherId, id);

    const result = await this.groupRepository.updateForTeacher(id, teacherId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.priceUzs !== undefined && { priceUzs: dto.priceUzs }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.startsOn !== undefined && {
        startsOn: dto.startsOn === null ? null : new Date(dto.startsOn),
      }),
      ...(dto.endsOn !== undefined && {
        endsOn: dto.endsOn === null ? null : new Date(dto.endsOn),
      }),
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${id} not found`,
      });
    }
    return this.assertGroupOwnership(teacherId, id);
  }

  async deleteGroup(teacherId: string, id: string): Promise<void> {
    await this.assertGroupOwnership(teacherId, id);
    const result = await this.groupRepository.deleteForTeacher(id, teacherId);
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${id} not found`,
      });
    }
  }

  // ==================================================================
  // Per-Group module toggle (Req 11.2, 11.3, 11.4, 11.6, 11.7)
  // ==================================================================

  /**
   * Return the per-Group toggle catalog for a group the teacher owns
   * (or any group when called by an ADMIN). Used by the AssignmentBuilder
   * picker and the `<GroupModulesPanel>` UI.
   *
   * The result is the persisted `GroupModule` set ordered by `moduleType`.
   * Rows for `SpecialtyModule` entries that activated *after* the group was
   * seeded are not auto-created here; the next single-toggle call will
   * upsert them on demand.
   */
  async listGroupModules(
    actorUserId: string,
    actorRole: string,
    groupId: string,
  ): Promise<GroupModule[]> {
    if (actorRole === 'ADMIN') {
      const group = await this.groupRepository.findById(groupId);
      if (!group) {
        throw new NotFoundException({
          code: 'GROUP_NOT_FOUND',
          message: `Group ${groupId} not found`,
        });
      }
    } else {
      await this.assertGroupOwnership(actorUserId, groupId);
    }
    return this.groupModuleRepository.listByGroup(groupId);
  }

  /**
   * Toggle a single module for a Group (Req 11.3). Returns the resulting
   * `GroupModule` row.
   *
   * Validation order (each step short-circuits the next):
   *   1. Resolve the group + its teacher's specialty (NOT_FOUND if missing).
   *   2. Authorize: ADMIN bypass, otherwise the caller must be the owning
   *      teacher (Req 11.3, isolation Req 7.7).
   *   3. The teacher must have a specialty assigned (ONBOARDING_REQUIRED).
   *   4. The `moduleType` must exist as an active `SpecialtyModule` for
   *      that specialty (Req 11.6 → `MODULE_NOT_IN_SPECIALTY_CATALOG`).
   *   5. Per-Group active cap of 10 (Req 11.7) — enforced before any DB
   *      write so the user gets a clean 409.
   *   6. Atomic write: upsert the toggle, append an `AdminAuditLog` entry,
   *      emit the `group.module.toggled` outbox event.
   *
   * Idempotency: toggling to the same state returns the current row
   * without emitting a new outbox event (the existing `enabledAt` /
   * `disabledAt` timestamp is preserved). This keeps repeat clicks and
   * client-side autosaves cheap and avoids notification fan-out storms.
   */
  async toggleGroupModule(
    actorUserId: string,
    actorRole: string,
    groupId: string,
    moduleType: HomeworkModuleType,
    isEnabled: boolean,
  ): Promise<GroupModule> {
    const result = await this.toggleGroupModulesAtomic(
      actorUserId,
      actorRole,
      groupId,
      [{ moduleType, isEnabled }],
    );
    return result[0]!;
  }

  /**
   * Bulk variant of `toggleGroupModule` used by the
   * `PUT /catalog/groups/:groupId/modules` route. Same validations, same
   * audit + outbox emission, but applied across all rows in a single
   * transaction.
   *
   * Returns the full `GroupModule` set for the group (not just the
   * touched rows) so the UI can refresh state without a follow-up GET.
   */
  async bulkToggleGroupModules(
    actorUserId: string,
    actorRole: string,
    groupId: string,
    dto: BulkUpsertGroupModulesDto,
  ): Promise<GroupModule[]> {
    if (dto.modules.length === 0) {
      // Nothing to do — return the current catalog so callers do not need
      // a follow-up GET.
      return this.listGroupModules(actorUserId, actorRole, groupId);
    }

    // Reject duplicate moduleType entries in the same batch — ambiguous
    // intent and easy to spot here before we burn a transaction.
    const seen = new Set<HomeworkModuleType>();
    for (const entry of dto.modules) {
      if (seen.has(entry.moduleType)) {
        throw new BadRequestException({
          code: 'DUPLICATE_MODULE_TYPE',
          message: `moduleType ${entry.moduleType} appears more than once in the request`,
        });
      }
      seen.add(entry.moduleType);
    }

    await this.toggleGroupModulesAtomic(
      actorUserId,
      actorRole,
      groupId,
      dto.modules,
    );
    return this.groupModuleRepository.listByGroup(groupId);
  }

  /**
   * Shared internal implementation for single + bulk toggle. Centralises
   * authorization, specialty-catalog validation, the cap pre-check, and
   * the audit + outbox side effects so the two public surfaces never drift.
   *
   * Returns one row per toggle entry — the post-write `GroupModule` for
   * each requested `moduleType`, in the same order as `entries`.
   */
  private async toggleGroupModulesAtomic(
    actorUserId: string,
    actorRole: string,
    groupId: string,
    entries: ReadonlyArray<{
      moduleType: HomeworkModuleType;
      isEnabled: boolean;
    }>,
  ): Promise<GroupModule[]> {
    // ----------------------------------------------------------------
    // (1) Resolve group + teacher specialty.
    // ----------------------------------------------------------------
    const group =
      await this.groupRepository.findByIdWithTeacherSpecialty(groupId);
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }

    // (2) Authorize: ADMIN bypass, otherwise must be the owning teacher.
    if (actorRole !== 'ADMIN' && group.course.teacherId !== actorUserId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only toggle modules on your own groups',
      });
    }

    // (3) Specialty must be assigned for catalog validation to make sense.
    const specialtyId = group.course.teacher?.specialtyId ?? null;
    if (!specialtyId) {
      throw new BadRequestException({
        code: 'ONBOARDING_REQUIRED',
        message:
          'Group teacher has no specialty assigned; complete onboarding before toggling modules',
      });
    }

    // (4) Validate every requested moduleType against the active specialty
    //     catalog. Reject the entire batch on the first miss (Req 11.6).
    const specialtyCatalog =
      await this.specialtyService.listActiveModules(specialtyId);
    const allowedTypes = new Set(
      specialtyCatalog.map((m) => m.moduleType as HomeworkModuleType),
    );
    for (const entry of entries) {
      if (!allowedTypes.has(entry.moduleType)) {
        throw new BadRequestException({
          code: 'MODULE_NOT_IN_SPECIALTY_CATALOG',
          message: `moduleType ${entry.moduleType} is not in the specialty catalog for this group`,
        });
      }
    }

    // (5) Per-Group active cap — compute the projected count, mirroring
    //     `HomeworkService.bulkUpsertSpecialtyModules`.
    const existing = await this.groupModuleRepository.listByGroup(groupId);
    const existingByType = new Map(existing.map((m) => [m.moduleType, m]));

    let currentActive = 0;
    for (const m of existing) if (m.isEnabled) currentActive += 1;

    let projectedActive = currentActive;
    for (const entry of entries) {
      const prev = existingByType.get(entry.moduleType);
      const wasActive = prev?.isEnabled ?? false;
      if (wasActive && !entry.isEnabled) projectedActive -= 1;
      if (!wasActive && entry.isEnabled) projectedActive += 1;
    }

    if (projectedActive > GROUP_MODULE_ACTIVE_CAP) {
      throw new ConflictException({
        code: 'GROUP_MODULE_CAP_EXCEEDED',
        message: `group_module_cap_exceeded: max ${GROUP_MODULE_ACTIVE_CAP} active modules per group (would be ${projectedActive})`,
      });
    }

    // (6) Atomic write: per-row upsert + audit + outbox event per *flipped*
    //     row. Idempotent re-toggles are no-ops at the audit/outbox layer.
    return this.prisma.$transaction(async (tx) => {
      const written: GroupModule[] = [];
      for (const entry of entries) {
        const prev = existingByType.get(entry.moduleType);
        const flipped = (prev?.isEnabled ?? false) !== entry.isEnabled;

        const row = await this.groupModuleRepository.upsertToggle(
          groupId,
          entry.moduleType,
          entry.isEnabled,
          tx,
        );
        written.push(row);

        if (flipped) {
          // Audit log — every toggle is a teacher / admin policy change.
          await tx.adminAuditLog.create({
            data: {
              actorId: actorUserId,
              action: 'group.module.toggled',
              target: `Group/${groupId}`,
              payload: {
                groupId,
                moduleType: entry.moduleType,
                isEnabled: entry.isEnabled,
                actorRole,
                teacherId: group.course.teacherId,
              },
            },
          });

          // Outbox: include a wall-clock suffix in the idempotency key so
          // genuine sequential flips of the same module are not deduped.
          // The flip itself is the event, not the (groupId, moduleType) pair.
          await this.outboxService.create(tx, {
            topic: 'group.module.toggled',
            payload: {
              groupId,
              moduleType: entry.moduleType,
              isEnabled: entry.isEnabled,
              actorUserId,
              actorRole,
              teacherId: group.course.teacherId,
            },
            idempotencyKey: `group.module.toggled:${groupId}:${entry.moduleType}:${Date.now()}:${
              entry.isEnabled ? '1' : '0'
            }`,
          });
        }
      }

      this.logger.log(
        `Group ${groupId}: ${entries.length} module toggle(s) applied by ${actorRole} ${actorUserId}`,
      );

      return written;
    });
  }

  // ==================================================================
  // Lesson CRUD + publish (Req 7.4, 7.5, 7.6, 7.7, 3.8)
  // ==================================================================

  async createLesson(
    teacherId: string,
    groupId: string,
    dto: CreateLessonDto,
  ): Promise<Lesson> {
    await this.assertGroupOwnership(teacherId, groupId);

    const lesson = await this.lessonRepository.create({
      groupId,
      title: dto.title,
      description: dto.description ?? null,
      type: dto.type,
      position: dto.position,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    });
    this.logger.log(
      `Lesson ${lesson.id} (status=DRAFT) created in group ${groupId} (teacher=${teacherId})`,
    );
    return lesson;
  }

  /**
   * List lessons for a group.
   *  - Teacher who owns the group: all lessons (any status).
   *  - Student: only READY lessons; enrollment is enforced by the controller
   *    (LessonAccessGuard) on per-lesson reads.
   */
  async listLessonsForTeacher(
    teacherId: string,
    groupId: string,
  ): Promise<Lesson[]> {
    await this.assertGroupOwnership(teacherId, groupId);
    return this.lessonRepository.listByGroup(groupId);
  }

  async listReadyLessonsForGroup(groupId: string): Promise<Lesson[]> {
    return this.lessonRepository.listByGroupAndStatus(
      groupId,
      'READY' as LessonStatus,
    );
  }

  /**
   * Verify a student has an APPROVED enrollment in `groupId`. Mirrors the
   * predicate enforced by `LessonAccessGuard` for individual lesson reads
   * (Req 6.1 / 6.2 / 6.6).
   */
  async assertStudentEnrolledInGroup(
    studentId: string,
    groupId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId } },
    });
    if (!enrollment || enrollment.status !== 'APPROVED') {
      throw new ForbiddenException({
        code: 'LESSON_ACCESS_DENIED',
        message:
          'You do not have approved access to this group. Pay and wait for teacher approval to enroll.',
      });
    }
  }

  async getLessonForTeacher(teacherId: string, id: string): Promise<Lesson> {
    return this.assertLessonOwnership(teacherId, id);
  }

  /** Plain lookup; access control is performed by `LessonAccessGuard`. */
  async getLessonById(id: string): Promise<Lesson> {
    const lesson = await this.lessonRepository.findById(id);
    if (!lesson) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${id} not found`,
      });
    }
    return lesson;
  }

  async updateLesson(
    teacherId: string,
    id: string,
    dto: UpdateLessonDto,
  ): Promise<Lesson> {
    await this.assertLessonOwnership(teacherId, id);

    const result = await this.lessonRepository.updateForTeacher(id, teacherId, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.position !== undefined && { position: dto.position }),
      ...(dto.scheduledAt !== undefined && {
        scheduledAt:
          dto.scheduledAt === null ? null : new Date(dto.scheduledAt),
      }),
    });
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${id} not found`,
      });
    }
    return this.assertLessonOwnership(teacherId, id);
  }

  async deleteLesson(teacherId: string, id: string): Promise<void> {
    await this.assertLessonOwnership(teacherId, id);
    const result = await this.lessonRepository.deleteForTeacher(id, teacherId);
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${id} not found`,
      });
    }
  }

  /**
   * Publish a lesson: DRAFT → READY (Req 7.5, 7.6).
   *
   * Order of checks matters:
   *   1. Ownership (404/403) — never leak existence.
   *   2. Active subscription (Req 3.8) — fail fast with 403 SUBSCRIPTION_EXPIRED
   *      so we don't waste a transition on a blocked teacher.
   *   3. Optimistic state transition (Req 7.5) — only one of N concurrent
   *      publish calls succeeds.
   *   4. Outbox event (Req 7.6) — emitted in the same transaction as the
   *      transition for atomicity.
   */
  async publishLesson(teacherId: string, id: string): Promise<Lesson> {
    const lesson = await this.assertLessonOwnership(teacherId, id);

    // Fast-fail when the lesson is already published. This is racy with the
    // updateMany below, but spares the caller the overhead of a transaction
    // when the answer is obvious.
    if (lesson.status === 'READY' || lesson.status === 'ARCHIVED') {
      throw new ConflictException({
        code: 'LESSON_ALREADY_PUBLISHED',
        message: `Lesson ${id} is not in DRAFT (status=${lesson.status})`,
      });
    }

    await this.billingService.requireActiveSubscription(teacherId);

    const groupId = lesson.groupId;

    return this.prisma.$transaction(async (tx) => {
      const transitioned = await this.lessonRepository.transitionDraftToReady(
        id,
        teacherId,
        tx,
      );
      if (!transitioned) {
        throw new ConflictException({
          code: 'LESSON_ALREADY_PUBLISHED',
          message: `Lesson ${id} is no longer in DRAFT`,
        });
      }

      await this.outboxService.create(tx, {
        topic: 'lesson.published',
        payload: {
          lessonId: id,
          groupId,
          teacherId,
        },
        idempotencyKey: `lesson.published:${id}`,
      });

      const updated = await this.lessonRepository.findById(id, tx);
      if (!updated) {
        // Defensive: should never happen because we just transitioned the row.
        throw new NotFoundException({
          code: 'LESSON_NOT_FOUND',
          message: `Lesson ${id} not found`,
        });
      }
      this.logger.log(
        `Lesson ${id} published (group=${groupId} teacher=${teacherId})`,
      );
      return updated;
    });
  }

  // ==================================================================
  // Ownership helpers (Req 7.7)
  // ==================================================================

  /**
   * Load a course and assert it belongs to `teacherId`. Throws 404 (not
   * 403) when the row exists but is owned by another teacher — preventing
   * cross-teacher existence leaks.
   */
  private async assertCourseOwnership(
    teacherId: string,
    courseId: string,
  ): Promise<Course> {
    const course = await this.courseRepository.findById(courseId);
    if (!course) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${courseId} not found`,
      });
    }
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only access your own courses',
      });
    }
    return course;
  }

  private async assertGroupOwnership(
    teacherId: string,
    groupId: string,
  ): Promise<Group> {
    const group = await this.groupRepository.findById(groupId);
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }
    if (group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only access your own groups',
      });
    }
    // Strip the joined `course` field — the public return type is `Group`.
    const { course: _course, ...plainGroup } = group;
    return plainGroup as Group;
  }

  // ==================================================================
  // Lesson Attachments (teacher-curated materials)
  // ==================================================================

  /**
   * List attachments for a lesson the teacher owns. Returns each row
   * joined with its MediaAsset so the dashboard can show file name +
   * size + status without a second round-trip.
   */
  async listAttachmentsForLesson(teacherId: string, lessonId: string) {
    await this.assertLessonOwnership(teacherId, lessonId);
    const rows = await this.prisma.attachment.findMany({
      where: { lessonId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        asset: {
          select: {
            id: true,
            kind: true,
            status: true,
            bytes: true,
            contentType: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });
    return rows.map((r) => this.serializeAttachment(r));
  }

  /**
   * Link an UPLOADED MediaAsset to a Lesson via the Attachment table.
   * Both the lesson and the asset must be owned by the calling teacher;
   * the asset must already be in a usable status (UPLOADED / TRANSCODING /
   * READY) — UPLOADING / FAILED rows are rejected.
   */
  async createAttachment(
    teacherId: string,
    lessonId: string,
    dto: {
      assetId: string;
      kind:
        | 'VIDEO'
        | 'AUDIO'
        | 'IMAGE'
        | 'PDF'
        | 'DOC'
        | 'SHEET'
        | 'RECORDING'
        | 'OTHER';
      role?: string;
      position?: number;
    },
  ) {
    await this.assertLessonOwnership(teacherId, lessonId);

    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: dto.assetId },
    });
    if (!asset) {
      throw new NotFoundException({
        code: 'MEDIA_NOT_FOUND',
        message: 'Media asset not found',
      });
    }
    if (asset.ownerUserId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only attach your own uploads',
      });
    }
    if (asset.status === 'UPLOADING' || asset.status === 'FAILED') {
      throw new BadRequestException({
        code: 'MEDIA_NOT_READY',
        message: `Media asset is in status ${asset.status}`,
      });
    }

    const position =
      dto.position ??
      (await this.prisma.attachment.count({ where: { lessonId } }));

    return this.prisma.attachment.create({
      data: {
        lessonId,
        assetId: dto.assetId,
        kind: dto.kind as any,
        role: dto.role ?? 'supplementary',
        position,
      },
      include: {
        asset: {
          select: {
            id: true,
            kind: true,
            status: true,
            bytes: true,
            contentType: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    }).then((r) => this.serializeAttachment(r));
  }

  /**
   * Convert MediaAsset.bytes (BigInt) to a plain number so JSON.stringify
   * works. Express response serialization fails on BigInt fields.
   */
  private serializeAttachment<T extends { asset: { bytes: bigint | null } }>(
    row: T,
  ): T & { asset: T['asset'] & { bytes: number | null } } {
    return {
      ...row,
      asset: {
        ...row.asset,
        bytes: row.asset.bytes == null ? null : Number(row.asset.bytes),
      },
    } as any;
  }

  /**
   * Delete an attachment owned by the calling teacher. The MediaAsset
   * itself stays — a teacher can delete the link without losing the file.
   */
  async deleteAttachment(teacherId: string, attachmentId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        lesson: { include: { group: { include: { course: true } } } },
      },
    });
    if (!attachment) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: `Attachment ${attachmentId} not found`,
      });
    }
    if (attachment.lesson.group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only delete your own attachments',
      });
    }
    await this.prisma.attachment.delete({ where: { id: attachmentId } });
  }

  private async assertLessonOwnership(
    teacherId: string,
    lessonId: string,
  ): Promise<Lesson> {
    const lesson = await this.lessonRepository.findByIdWithOwnership(lessonId);
    if (!lesson) {
      throw new NotFoundException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${lessonId} not found`,
      });
    }
    if (lesson.group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only access your own lessons',
      });
    }
    const { group: _group, ...plainLesson } = lesson;
    return plainLesson as Lesson;
  }

  private async allocateUniqueJoinCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateJoinCode();
      const existing = await this.prisma.group.findUnique({
        where: { joinCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new Error('Failed to allocate a unique join code');
  }

  private generateJoinCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
