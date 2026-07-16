import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CefrLevel, Course, ProficiencyLevelHistory } from '@prisma/client';

import { ProficiencySource, SetCourseLevelDto, SetGroupLevelDto } from './dto';
import { LevelingRepository } from './repositories/leveling.repository';

/**
 * How a Group's effective CEFR level was resolved.
 *
 *   - `GROUP_OVERRIDE`   → the Group has its own `cefrLevel` (Req 3.4).
 *   - `COURSE_INHERITED` → the Group inherits the Course level (Req 3.3).
 *   - `UNASSIGNED`       → neither Group nor Course has a level yet.
 */
export type EffectiveLevelSource =
  | 'GROUP_OVERRIDE'
  | 'COURSE_INHERITED'
  | 'UNASSIGNED';

export interface EffectiveGroupLevel {
  groupId: string;
  courseId: string;
  /** The Group's own override level, or null when it inherits. */
  groupLevel: CefrLevel | null;
  /** The parent Course level (the inheritance source). */
  courseLevel: CefrLevel | null;
  /** The resolved level a learner sees: override first, else inherited. */
  effectiveLevel: CefrLevel | null;
  source: EffectiveLevelSource;
}

/**
 * UNASSESSED is the logical state of a learner who has never been assessed —
 * represented by a `null` `currentCefrLevel` (Req 4.2). It is surfaced as an
 * explicit `status` string so API consumers don't have to special-case null.
 */
export type ProficiencyStatus = 'ASSESSED' | 'UNASSESSED';

export interface LearnerProficiency {
  learnerId: string;
  /** The CEFR level, or null when UNASSESSED (Req 4.1, 4.2). */
  currentCefrLevel: CefrLevel | null;
  status: ProficiencyStatus;
}

/**
 * The authenticated actor making a proficiency read. `role` is the JWT role
 * claim ('STUDENT' | 'TEACHER' | 'ADMIN'); `sub` is the user id.
 */
export interface ProficiencyActor {
  sub: string;
  role: string;
}

/**
 * Maps a nullable `currentCefrLevel` to the public proficiency view (Req
 * 4.1, 4.2). Pure so it can be reused/unit-tested without Nest/Prisma.
 */
export function toLearnerProficiency(
  learnerId: string,
  currentCefrLevel: CefrLevel | null,
): LearnerProficiency {
  return {
    learnerId,
    currentCefrLevel,
    status: currentCefrLevel === null ? 'UNASSESSED' : 'ASSESSED',
  };
}

/**
 * Pure resolution of a Group's effective CEFR level (Req 3.3, 3.4).
 *
 * A Group-specific override always wins; otherwise the Group inherits the
 * Course level. Exported and side-effect-free so it can be unit-tested and
 * reused by Discovery (Req 3.6) without pulling in Nest/Prisma.
 */
export function computeEffectiveLevel(
  courseLevel: CefrLevel | null,
  groupLevel: CefrLevel | null,
): { effectiveLevel: CefrLevel | null; source: EffectiveLevelSource } {
  if (groupLevel !== null) {
    return { effectiveLevel: groupLevel, source: 'GROUP_OVERRIDE' };
  }
  if (courseLevel !== null) {
    return { effectiveLevel: courseLevel, source: 'COURSE_INHERITED' };
  }
  return { effectiveLevel: null, source: 'UNASSIGNED' };
}

/**
 * Reusable publish-guard checker (Req 3.5).
 *
 * Throws a 400 `COURSE_LEVEL_REQUIRED` validation error — naming the missing
 * CEFR level explicitly — when a course has no `cefrLevel`. Pure and
 * dependency-free so the catalog publish path (or any other caller) can
 * invoke it without importing the whole LevelingModule. The companion
 * `LevelingService.assertCoursePublishable(courseId)` wraps this with a DB
 * lookup for callers that only hold an id.
 */
export function assertCourseHasCefrLevel(
  course: Pick<Course, 'id' | 'cefrLevel'>,
): void {
  if (course.cefrLevel === null || course.cefrLevel === undefined) {
    throw new BadRequestException({
      code: 'COURSE_LEVEL_REQUIRED',
      message:
        `Course ${course.id} cannot be published without a CEFR level. ` +
        'Assign one of A1, A2, B1, B2, C1, C2 via PATCH /catalog/courses/:id/level first.',
      details: [{ field: 'cefrLevel', reason: 'missing_cefr_level' }],
    });
  }
}

/**
 * LevelingService — owns CEFR level + Exam_Track assignment on Course and
 * Group, level inheritance/override resolution, and the publish-without-level
 * guard (Req 3.1 – 3.5).
 *
 * Cross-teacher isolation (mirrors CatalogService): every mutation asserts
 * the calling teacher owns the Course (directly, or via the Group's parent
 * Course) and raises 404 `*_NOT_FOUND` / 403 `NOT_OWNING_TEACHER` so the
 * controller stays thin.
 */
@Injectable()
export class LevelingService {
  private readonly logger = new Logger(LevelingService.name);

  constructor(private readonly levelingRepository: LevelingRepository) {}

  // ==================================================================
  // Course level assignment (Req 3.1, 3.2)
  // ==================================================================

  /**
   * Assign / update a Course's CEFR level and optional Exam_Track. Ownership
   * is asserted first so a cross-teacher call gets a clean 403/404 instead
   * of a silent no-op.
   */
  async setCourseLevel(
    teacherId: string,
    courseId: string,
    dto: SetCourseLevelDto,
  ): Promise<Course> {
    await this.assertCourseOwnership(teacherId, courseId);

    const result = await this.levelingRepository.setCourseLevel(
      courseId,
      teacherId,
      {
        cefrLevel: dto.cefrLevel,
        ...(dto.examTrack !== undefined && { examTrack: dto.examTrack }),
      },
    );
    if (result.count === 0) {
      // Unreachable given the assert above, but keeps the contract honest
      // under a concurrent delete.
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${courseId} not found`,
      });
    }

    this.logger.log(
      `Course ${courseId} level set to ${dto.cefrLevel}` +
        (dto.examTrack !== undefined
          ? ` examTrack=${dto.examTrack ?? 'null'}`
          : '') +
        ` (teacher=${teacherId})`,
    );
    return this.assertCourseOwnership(teacherId, courseId);
  }

  // ==================================================================
  // Group level override / inheritance (Req 3.3, 3.4)
  // ==================================================================

  /**
   * Set or clear a Group-specific CEFR override. Passing `null` clears the
   * override so the Group inherits its Course level again (Req 3.3, 3.4).
   * Returns the resolved effective level so the caller can render the
   * inheritance state without a follow-up read.
   */
  async setGroupLevel(
    teacherId: string,
    groupId: string,
    dto: SetGroupLevelDto,
  ): Promise<EffectiveGroupLevel> {
    const group = await this.assertGroupOwnership(teacherId, groupId);

    const result = await this.levelingRepository.setGroupLevel(
      groupId,
      teacherId,
      dto.cefrLevel,
    );
    if (result.count === 0) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }

    this.logger.log(
      `Group ${groupId} level override set to ${dto.cefrLevel ?? 'null (inherit)'} (teacher=${teacherId})`,
    );

    const { effectiveLevel, source } = computeEffectiveLevel(
      group.course.cefrLevel,
      dto.cefrLevel,
    );
    return {
      groupId,
      courseId: group.courseId,
      groupLevel: dto.cefrLevel,
      courseLevel: group.course.cefrLevel,
      effectiveLevel,
      source,
    };
  }

  /**
   * Resolve a Group's effective CEFR level (override → inherited → none).
   * Exposed for the teacher dashboard and consumed by Discovery (Req 3.6).
   */
  async getEffectiveGroupLevel(
    teacherId: string,
    groupId: string,
  ): Promise<EffectiveGroupLevel> {
    const group = await this.assertGroupOwnership(teacherId, groupId);
    const { effectiveLevel, source } = computeEffectiveLevel(
      group.course.cefrLevel,
      group.cefrLevel,
    );
    return {
      groupId,
      courseId: group.courseId,
      groupLevel: group.cefrLevel,
      courseLevel: group.course.cefrLevel,
      effectiveLevel,
      source,
    };
  }

  // ==================================================================
  // Learner proficiency (Req 4.1 – 4.5)
  // ==================================================================

  /**
   * Read a learner's current proficiency, returning UNASSESSED when the
   * learner has no level yet (Req 4.1, 4.2). Authorization (Req 4.4):
   *   - ADMIN may read any learner;
   *   - STUDENT may read only their own proficiency;
   *   - TEACHER may read only learners they teach (APPROVED enrollment in one
   *     of their groups).
   */
  async getProficiency(
    actor: ProficiencyActor,
    learnerId: string,
  ): Promise<LearnerProficiency> {
    await this.assertCanAccessLearner(actor, learnerId);
    const current = await this.levelingRepository.getCurrentCefrLevel(learnerId);
    if (current === undefined) {
      throw new NotFoundException({
        code: 'LEARNER_NOT_FOUND',
        message: `Learner ${learnerId} not found`,
      });
    }
    return toLearnerProficiency(learnerId, current);
  }

  /**
   * Read a learner's proficiency change history, newest first (Req 4.4).
   * Same authorization rules as {@link getProficiency}.
   */
  async getProficiencyHistory(
    actor: ProficiencyActor,
    learnerId: string,
  ): Promise<ProficiencyLevelHistory[]> {
    await this.assertCanAccessLearner(actor, learnerId);
    // Surface a clean 404 for an unknown learner rather than an empty list.
    const current = await this.levelingRepository.getCurrentCefrLevel(learnerId);
    if (current === undefined) {
      throw new NotFoundException({
        code: 'LEARNER_NOT_FOUND',
        message: `Learner ${learnerId} not found`,
      });
    }
    return this.levelingRepository.findProficiencyHistory(learnerId);
  }

  /**
   * Instructor-initiated proficiency change for an enrolled learner (Req 4.4).
   * Authorizes that the instructor actually teaches the learner, then records
   * the change (with `source = 'instructor'`) via the reusable
   * {@link recordProficiencyChange}.
   */
  async setProficiencyByInstructor(
    instructorId: string,
    learnerId: string,
    toLevel: CefrLevel,
  ): Promise<LearnerProficiency> {
    const teaches = await this.levelingRepository.instructorTeachesLearner(
      instructorId,
      learnerId,
    );
    if (!teaches) {
      throw new ForbiddenException({
        code: 'NOT_TEACHING_LEARNER',
        message: 'You can only change proficiency for learners you teach',
      });
    }
    const { proficiency } = await this.recordProficiencyChange(
      learnerId,
      toLevel,
      'instructor',
      instructorId,
    );
    return proficiency;
  }

  /**
   * Reusable proficiency-change primitive (Req 4.4). Updates
   * `StudentProfile.currentCefrLevel` and appends a `ProficiencyLevelHistory`
   * row (`fromLevel → toLevel`, `source`, `changedById`) in a single
   * transaction. Other modules call this directly:
   *   - Placement (task 3.2): `recordProficiencyChange(id, level, 'placement', null)`;
   *   - Migration (task 8.1): `recordProficiencyChange(id, null, 'migration', null)`.
   *
   * Performs no enrollment authorization — callers that expose this to an
   * actor (e.g. the instructor endpoint) are responsible for authorizing
   * first. Throws 404 `LEARNER_NOT_FOUND` when the learner has no profile.
   */
  async recordProficiencyChange(
    learnerId: string,
    toLevel: CefrLevel | null,
    source: ProficiencySource,
    changedById: string | null,
  ): Promise<{ proficiency: LearnerProficiency; history: ProficiencyLevelHistory }> {
    const fromLevel = await this.levelingRepository.getCurrentCefrLevel(learnerId);
    if (fromLevel === undefined) {
      throw new NotFoundException({
        code: 'LEARNER_NOT_FOUND',
        message: `Learner ${learnerId} not found`,
      });
    }

    const history = await this.levelingRepository.applyProficiencyChange({
      learnerId,
      fromLevel,
      toLevel,
      source,
      changedById,
    });

    this.logger.log(
      `Learner ${learnerId} proficiency ${fromLevel ?? 'UNASSESSED'} → ` +
        `${toLevel ?? 'UNASSESSED'} (source=${source}` +
        (changedById ? ` by=${changedById}` : '') +
        ')',
    );

    return {
      proficiency: toLearnerProficiency(learnerId, toLevel),
      history,
    };
  }

  /**
   * Discovery integration point (Req 4.5, 3.6): expose a learner's current
   * CEFR level for course recommendations. Returns the raw `CefrLevel` or
   * `null` (UNASSESSED). Intended for service-to-service use by the
   * Discovery_Module (no actor authorization) — Discovery imports
   * `LevelingService` and calls this to bias/filter recommendations by level.
   */
  async getLearnerProficiencyLevel(
    learnerId: string,
  ): Promise<CefrLevel | null> {
    const current = await this.levelingRepository.getCurrentCefrLevel(learnerId);
    return current ?? null;
  }

  // ==================================================================
  // Publish guard (Req 3.5)
  // ==================================================================

  /**
   * Reusable publish-guard for the catalog publish path. Loads the course
   * and throws 400 `COURSE_LEVEL_REQUIRED` when it has no CEFR level. The
   * catalog `publishCourse` flow can DI `LevelingService` and `await
   * levelingService.assertCoursePublishable(courseId)` before flipping
   * `isPublished` — or callers holding the row can use the pure
   * {@link assertCourseHasCefrLevel} helper directly.
   */
  async assertCoursePublishable(courseId: string): Promise<void> {
    const course = await this.levelingRepository.findCourseById(courseId);
    if (!course) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${courseId} not found`,
      });
    }
    assertCourseHasCefrLevel(course);
  }

  // ==================================================================
  // Ownership helpers (mirror CatalogService, Req 7.7)
  // ==================================================================

  private async assertCourseOwnership(
    teacherId: string,
    courseId: string,
  ): Promise<Course> {
    const course = await this.levelingRepository.findCourseById(courseId);
    if (!course) {
      throw new NotFoundException({
        code: 'COURSE_NOT_FOUND',
        message: `Course ${courseId} not found`,
      });
    }
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only assign levels to your own courses',
      });
    }
    return course;
  }

  private async assertGroupOwnership(teacherId: string, groupId: string) {
    const group = await this.levelingRepository.findGroupWithCourse(groupId);
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: `Group ${groupId} not found`,
      });
    }
    if (group.course.teacherId !== teacherId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only assign levels to your own groups',
      });
    }
    return group;
  }

  /**
   * Authorize a proficiency read for `actor` against `learnerId` (Req 4.4):
   *   - ADMIN  → any learner;
   *   - STUDENT → only their own record;
   *   - TEACHER → only learners they teach (APPROVED enrollment in one of
   *     their groups).
   * Raises 403 `FORBIDDEN_PROFICIENCY_ACCESS` otherwise.
   */
  private async assertCanAccessLearner(
    actor: ProficiencyActor,
    learnerId: string,
  ): Promise<void> {
    if (actor.role === 'ADMIN') {
      return;
    }
    if (actor.role === 'STUDENT') {
      if (actor.sub !== learnerId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN_PROFICIENCY_ACCESS',
          message: 'You can only view your own proficiency',
        });
      }
      return;
    }
    if (actor.role === 'TEACHER') {
      const teaches = await this.levelingRepository.instructorTeachesLearner(
        actor.sub,
        learnerId,
      );
      if (!teaches) {
        throw new ForbiddenException({
          code: 'FORBIDDEN_PROFICIENCY_ACCESS',
          message: 'You can only view proficiency for learners you teach',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN_PROFICIENCY_ACCESS',
      message: 'You are not allowed to view this learner proficiency',
    });
  }
}
