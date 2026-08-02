import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Assignment,
  AssignmentModule,
  Prisma,
  PrismaClient,
  SpecialtyModule,
  SubmissionStatus,
} from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { SpecialtyService } from '../teacher/specialty.service';
import { TeacherProfileRepository } from '../teacher/repositories/teacher-profile.repository';
import { BulkUpsertSpecialtyModulesDto } from './dto';
import { SpecialtyModuleRepository } from './repositories/specialty-module.repository';

/**
 * Maximum active SpecialtyModule rows per Specialty (Req 11.1, 11.7).
 *
 * Spelled out as a constant so the service-layer guard, the DB trigger,
 * and the user-facing error message all reference the same number.
 */
export const SPECIALTY_MODULE_ACTIVE_CAP = 10;

/**
 * One row of a student's cross-group homework feed: the published
 * assignment, where it lives, and the student's own submission (or `null`
 * when they have not started it).
 */
export interface StudentAssignmentRow {
  assignment: Assignment & { modules: AssignmentModule[] };
  lesson: { id: string; title: string };
  group: { id: string; name: string };
  submission: {
    id: string;
    status: SubmissionStatus;
    score: number | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
    updatedAt: Date;
  } | null;
}

/**
 * HomeworkService — owns the admin-managed `SpecialtyModule` catalog and
 * the teacher-facing read endpoints for it (Task 17.1, Req 11.1, 11.7).
 *
 * The service is intentionally narrow at this stage: only catalog
 * operations live here. Per-Group toggles (Task 17.2), assignment
 * creation (Task 17.3) and the submission lifecycle (Task 18.x) will
 * land in follow-up tasks.
 *
 * Cap enforcement (Req 11.1, 11.7) is implemented at two layers:
 *   1. Service-layer guard — counts current active rows and compares
 *      against the desired post-write active count before issuing the
 *      upsert. Produces a friendly 409 `SPECIALTY_MODULE_CAP_EXCEEDED`.
 *   2. DB-level deferred constraint trigger
 *      `enforce_specialty_module_cap()` — runs at COMMIT time so any
 *      concurrent admin write that slips past the service guard is still
 *      rejected with `specialty_module_cap_exceeded`.
 *
 * Both layers must agree on the cap number; that is why
 * `SPECIALTY_MODULE_ACTIVE_CAP = 10` mirrors the literal `> 10` check in
 * the migration's `enforce_specialty_module_cap()` plpgsql function.
 */
@Injectable()
export class HomeworkService {
  private readonly logger = new Logger(HomeworkService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly specialtyModuleRepository: SpecialtyModuleRepository,
    private readonly specialtyService: SpecialtyService,
    private readonly teacherProfileRepository: TeacherProfileRepository,
    private readonly outboxService: OutboxService,
  ) {}

  // ==================================================================
  // Admin: SpecialtyModule CRUD (Req 11.1, 11.7)
  // ==================================================================

  /**
   * Return the admin "full mapping" view of a specialty's catalog: every
   * `SpecialtyModule` row that exists for the specialty, ordered by
   * `moduleType`. The admin UI augments this with the unmapped enum
   * values rendered as `isActive=false` placeholders, so the response
   * here is deliberately just the persisted rows.
   */
  async listSpecialtyModulesForAdmin(
    specialtyId: string,
  ): Promise<SpecialtyModule[]> {
    // Surface a clean 404 instead of returning [] when the specialty
    // does not exist — admins should not be able to manipulate ghost
    // catalogs.
    await this.specialtyService.getById(specialtyId);
    return this.specialtyModuleRepository.listBySpecialty(specialtyId);
  }

  /**
   * Bulk upsert the admin-managed SpecialtyModule catalog. The input is
   * a *partial* desired state: only the rows the admin wants to write
   * are sent, anything not listed is left at its current value.
   *
   * Errors:
   *   - 404 SPECIALTY_NOT_FOUND          — specialty does not exist
   *   - 409 SPECIALTY_MODULE_CAP_EXCEEDED — would push active count past 10
   *
   * Atomic: all upserts run inside a single Prisma transaction together
   * with the outbox emission, so the trigger sees the post-batch state
   * once at COMMIT and any failure rolls back to the pre-call state.
   *
   * Outbox: a single `specialty.modules.updated` event is emitted per
   * batch (idempotency key `specialty.modules.updated:{specialtyId}:{nowMs}`)
   * — the actual mutation list is in the payload so subscribers can
   * decide whether to invalidate downstream caches.
   */
  async bulkUpsertSpecialtyModules(
    specialtyId: string,
    dto: BulkUpsertSpecialtyModulesDto,
    actorUserId: string,
  ): Promise<SpecialtyModule[]> {
    await this.specialtyService.getById(specialtyId);

    if (dto.modules.length === 0) {
      // Nothing to do; return the current catalog so callers don't need a
      // follow-up GET.
      return this.specialtyModuleRepository.listBySpecialty(specialtyId);
    }

    return this.prisma.$transaction(async (tx) => {
      // ----------------------------------------------------------------
      // Cap pre-check (service-layer mirror of the DB trigger).
      //
      // Compute the post-write active count by:
      //   currentActive
      //   - (rows we will flip OFF: isActive=false in the input but
      //     currently isActive=true in DB)
      //   + (rows we will turn ON: isActive=true in the input but
      //     currently absent or isActive=false in DB)
      // ----------------------------------------------------------------
      const existing = await this.specialtyModuleRepository.listBySpecialty(
        specialtyId,
        tx,
      );
      const existingByType = new Map(existing.map((m) => [m.moduleType, m]));

      let currentActive = 0;
      for (const m of existing) if (m.isActive) currentActive += 1;

      let projectedActive = currentActive;
      for (const desired of dto.modules) {
        const prev = existingByType.get(desired.moduleType);
        const wasActive = prev?.isActive ?? false;
        if (wasActive && !desired.isActive) projectedActive -= 1;
        if (!wasActive && desired.isActive) projectedActive += 1;
      }

      if (projectedActive > SPECIALTY_MODULE_ACTIVE_CAP) {
        throw new ConflictException({
          code: 'SPECIALTY_MODULE_CAP_EXCEEDED',
          message: `specialty_module_cap_exceeded: max ${SPECIALTY_MODULE_ACTIVE_CAP} active modules per specialty (would be ${projectedActive})`,
        });
      }

      // ----------------------------------------------------------------
      // Apply upserts. We catch the trigger violation as a final guard —
      // a concurrent admin write between our count and our INSERT could
      // still push the total past the cap, in which case the DB raises
      // `specialty_module_cap_exceeded` and we re-throw it as a 409.
      // ----------------------------------------------------------------
      try {
        for (const desired of dto.modules) {
          await this.specialtyModuleRepository.upsert(
            {
              specialtyId,
              moduleType: desired.moduleType,
              isActive: desired.isActive,
              ...(desired.defaultEnabled !== undefined && {
                defaultEnabled: desired.defaultEnabled,
              }),
            },
            tx,
          );
        }

        await this.outboxService.create(tx, {
          topic: 'specialty.modules.updated',
          payload: {
            specialtyId,
            actorUserId,
            modules: dto.modules.map((m) => ({
              moduleType: m.moduleType,
              isActive: m.isActive,
              ...(m.defaultEnabled !== undefined && {
                defaultEnabled: m.defaultEnabled,
              }),
            })),
          },
          // Use a wall-clock-derived suffix so legitimate sequential
          // updates from the same admin do not get deduped — the bulk
          // upsert is the unit of change, not the (specialtyId,) pair.
          idempotencyKey: `specialty.modules.updated:${specialtyId}:${Date.now()}`,
        });
      } catch (error) {
        // Map the DB trigger's RAISE EXCEPTION onto our public error
        // shape so HTTP clients see a consistent contract regardless of
        // which layer caught the breach.
        if (this.isCapTriggerError(error)) {
          throw new ConflictException({
            code: 'SPECIALTY_MODULE_CAP_EXCEEDED',
            message: `specialty_module_cap_exceeded: max ${SPECIALTY_MODULE_ACTIVE_CAP} active modules per specialty`,
          });
        }
        throw error;
      }

      return this.specialtyModuleRepository.listBySpecialty(specialtyId, tx);
    });
  }

  // ==================================================================
  // Teacher: SpecialtyModule listing (Req 11.5 read path foundation)
  // ==================================================================

  /**
   * Return the active SpecialtyModule rows for a teacher's own specialty.
   *
   * Used by the teacher dashboard's "Available Modules" panel as a
   * read-only catalog view. Per-Group toggle filtering happens in
   * Task 17.2 — at this stage the teacher only sees what their specialty
   * has enabled in the admin catalog.
   *
   * Errors:
   *   - 404 ONBOARDING_REQUIRED — teacher has not finished onboarding,
   *     so we do not know which specialty's catalog to return.
   */
  async listActiveModulesForTeacher(
    teacherUserId: string,
  ): Promise<SpecialtyModule[]> {
    const profile =
      await this.teacherProfileRepository.findByUserId(teacherUserId);
    if (!profile || !profile.specialtyId) {
      throw new NotFoundException({
        code: 'ONBOARDING_REQUIRED',
        message:
          'Complete onboarding to be assigned a specialty before listing homework modules',
      });
    }
    return this.specialtyModuleRepository.listActiveBySpecialty(
      profile.specialtyId,
    );
  }

  /**
   * Return the active SpecialtyModule rows for an explicit specialty.
   * Restricted to ADMIN callers at the controller level — exposed here
   * so the admin dashboard can preview a different specialty's catalog
   * without having to go through the per-teacher path.
   */
  async listActiveModulesBySpecialty(
    specialtyId: string,
  ): Promise<SpecialtyModule[]> {
    await this.specialtyService.getById(specialtyId);
    return this.specialtyModuleRepository.listActiveBySpecialty(specialtyId);
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  // ==================================================================
  // Student: cross-group homework feed
  // ==================================================================

  /**
   * Every published assignment the student can currently see, paired with
   * their own submission for it.
   *
   * This is the data behind `/homework` for a STUDENT. The page used to
   * assemble it client-side by walking
   *   myEnrollments → group → lessons → assignments → mySubmission,
   * which is an N+1 storm — a student in three groups with ten lessons each
   * fired close to a hundred requests to render one list, and any single
   * failure silently dropped a row. One indexed query replaces all of it.
   *
   * Scoping rules mirror the rest of the homework surface: APPROVED
   * enrollment only, published assignments only.
   */
  async listMyAssignments(studentId: string): Promise<StudentAssignmentRow[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId, status: 'APPROVED' },
      select: { groupId: true },
    });
    if (enrollments.length === 0) return [];

    const groupIds = enrollments.map((e) => e.groupId);

    const assignments = await this.prisma.assignment.findMany({
      where: {
        isPublished: true,
        lesson: { groupId: { in: groupIds } },
      },
      include: {
        modules: { orderBy: { order: 'asc' } },
        lesson: {
          select: {
            id: true,
            title: true,
            groupId: true,
            group: { select: { id: true, name: true } },
          },
        },
        // The unique (assignmentId, studentId) index means this is at most
        // one row; `take: 1` keeps Prisma from materialising the whole
        // class's submissions for a popular assignment.
        submissions: {
          where: { studentId },
          take: 1,
          select: {
            id: true,
            status: true,
            score: true,
            submittedAt: true,
            gradedAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    });

    return assignments.map(({ lesson, submissions, ...assignment }) => ({
      assignment,
      lesson: { id: lesson.id, title: lesson.title },
      group: { id: lesson.group.id, name: lesson.group.name },
      submission: submissions[0] ?? null,
    }));
  }

  /**
   * Detect whether the given error is the cap trigger's RAISE EXCEPTION
   * surface. Prisma wraps unknown DB errors in
   * `PrismaClientKnownRequestError` (code P2010) or
   * `PrismaClientUnknownRequestError`; in both cases the trigger's
   * message string is preserved verbatim, so we match on substring.
   */
  private isCapTriggerError(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return /specialty_module_cap_exceeded/i.test(error.message);
    }
    if (error instanceof Error) {
      return /specialty_module_cap_exceeded/i.test(error.message);
    }
    return false;
  }
}
