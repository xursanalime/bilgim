import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CefrLevel } from '@prisma/client';

import {
  LevelingService,
  assertCourseHasCefrLevel,
  computeEffectiveLevel,
  toLearnerProficiency,
} from './leveling.service';
import { LevelingRepository } from './repositories/leveling.repository';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = '00000000-0000-0000-0000-000000000099';
const COURSE_ID = '22222222-2222-2222-2222-222222222222';
const GROUP_ID = '33333333-3333-3333-3333-333333333333';
const LEARNER_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ID = '55555555-5555-5555-5555-555555555555';

/**
 * LevelingService unit tests — Requirements 3.1, 3.3, 3.4, 3.5.
 *
 * Coverage:
 *   - setCourseLevel: ownership isolation, level + examTrack persistence.
 *   - setGroupLevel: override takes precedence (Req 3.4); null clears the
 *     override → Group inherits the Course level (Req 3.3).
 *   - getEffectiveGroupLevel / computeEffectiveLevel: inheritance vs override
 *     vs unassigned resolution.
 *   - assertCoursePublishable / assertCourseHasCefrLevel: publish is rejected
 *     when a Course has no CEFR level (Req 3.5).
 */
describe('LevelingService', () => {
  let service: LevelingService;
  let repo: jest.Mocked<LevelingRepository>;

  beforeEach(() => {
    repo = {
      findCourseById: jest.fn(),
      setCourseLevel: jest.fn(),
      findGroupWithCourse: jest.fn(),
      setGroupLevel: jest.fn(),
      getCurrentCefrLevel: jest.fn(),
      applyProficiencyChange: jest.fn(),
      findProficiencyHistory: jest.fn(),
      instructorTeachesLearner: jest.fn(),
    } as any;
    service = new LevelingService(repo);
  });

  // ==================================================================
  // computeEffectiveLevel (pure) — Req 3.3, 3.4
  // ==================================================================

  describe('computeEffectiveLevel', () => {
    it('returns the Group override when present (Req 3.4)', () => {
      expect(computeEffectiveLevel(CefrLevel.A2, CefrLevel.B2)).toEqual({
        effectiveLevel: CefrLevel.B2,
        source: 'GROUP_OVERRIDE',
      });
    });

    it('inherits the Course level when the Group has no override (Req 3.3)', () => {
      expect(computeEffectiveLevel(CefrLevel.A2, null)).toEqual({
        effectiveLevel: CefrLevel.A2,
        source: 'COURSE_INHERITED',
      });
    });

    it('reports UNASSIGNED when neither level is set', () => {
      expect(computeEffectiveLevel(null, null)).toEqual({
        effectiveLevel: null,
        source: 'UNASSIGNED',
      });
    });

    it('override wins even when it equals the course level', () => {
      expect(computeEffectiveLevel(CefrLevel.C1, CefrLevel.C1)).toEqual({
        effectiveLevel: CefrLevel.C1,
        source: 'GROUP_OVERRIDE',
      });
    });
  });

  // ==================================================================
  // assertCourseHasCefrLevel (pure) — Req 3.5
  // ==================================================================

  describe('assertCourseHasCefrLevel', () => {
    it('throws 400 COURSE_LEVEL_REQUIRED naming the missing level when cefrLevel is null', () => {
      expect.assertions(2);
      try {
        assertCourseHasCefrLevel({ id: COURSE_ID, cefrLevel: null });
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          code: 'COURSE_LEVEL_REQUIRED',
        });
      }
    });

    it('passes when a CEFR level is present', () => {
      expect(() =>
        assertCourseHasCefrLevel({ id: COURSE_ID, cefrLevel: CefrLevel.B1 }),
      ).not.toThrow();
    });
  });

  // ==================================================================
  // setCourseLevel — Req 3.1, 3.2
  // ==================================================================

  describe('setCourseLevel', () => {
    it('persists cefrLevel + examTrack for an owned course', async () => {
      repo.findCourseById
        .mockResolvedValueOnce({ id: COURSE_ID, teacherId: TEACHER_ID } as any)
        .mockResolvedValueOnce({
          id: COURSE_ID,
          teacherId: TEACHER_ID,
          cefrLevel: CefrLevel.B2,
          examTrack: 'ielts',
        } as any);
      repo.setCourseLevel.mockResolvedValue({ count: 1 });

      const result = await service.setCourseLevel(TEACHER_ID, COURSE_ID, {
        cefrLevel: CefrLevel.B2,
        examTrack: 'ielts',
      });

      expect(repo.setCourseLevel).toHaveBeenCalledWith(COURSE_ID, TEACHER_ID, {
        cefrLevel: CefrLevel.B2,
        examTrack: 'ielts',
      });
      expect(result.cefrLevel).toBe(CefrLevel.B2);
    });

    it('omits examTrack from the write when not provided (level-only update)', async () => {
      repo.findCourseById
        .mockResolvedValueOnce({ id: COURSE_ID, teacherId: TEACHER_ID } as any)
        .mockResolvedValueOnce({
          id: COURSE_ID,
          teacherId: TEACHER_ID,
          cefrLevel: CefrLevel.A1,
        } as any);
      repo.setCourseLevel.mockResolvedValue({ count: 1 });

      await service.setCourseLevel(TEACHER_ID, COURSE_ID, {
        cefrLevel: CefrLevel.A1,
      });

      expect(repo.setCourseLevel).toHaveBeenCalledWith(COURSE_ID, TEACHER_ID, {
        cefrLevel: CefrLevel.A1,
      });
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher course', async () => {
      repo.findCourseById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: OTHER_TEACHER_ID,
      } as any);

      await expect(
        service.setCourseLevel(TEACHER_ID, COURSE_ID, {
          cefrLevel: CefrLevel.B1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.setCourseLevel).not.toHaveBeenCalled();
    });

    it('throws 404 COURSE_NOT_FOUND when the course is missing', async () => {
      repo.findCourseById.mockResolvedValue(null);

      await expect(
        service.setCourseLevel(TEACHER_ID, COURSE_ID, {
          cefrLevel: CefrLevel.B1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // setGroupLevel — Req 3.3, 3.4
  // ==================================================================

  describe('setGroupLevel', () => {
    it('stores a Group override that takes precedence over the course level (Req 3.4)', async () => {
      repo.findGroupWithCourse.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        cefrLevel: null,
        course: { teacherId: TEACHER_ID, cefrLevel: CefrLevel.A2 },
      } as any);
      repo.setGroupLevel.mockResolvedValue({ count: 1 });

      const result = await service.setGroupLevel(TEACHER_ID, GROUP_ID, {
        cefrLevel: CefrLevel.B2,
      });

      expect(repo.setGroupLevel).toHaveBeenCalledWith(
        GROUP_ID,
        TEACHER_ID,
        CefrLevel.B2,
      );
      expect(result).toMatchObject({
        groupLevel: CefrLevel.B2,
        courseLevel: CefrLevel.A2,
        effectiveLevel: CefrLevel.B2,
        source: 'GROUP_OVERRIDE',
      });
    });

    it('clears the override (null) so the Group inherits the course level (Req 3.3)', async () => {
      repo.findGroupWithCourse.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        cefrLevel: CefrLevel.C1,
        course: { teacherId: TEACHER_ID, cefrLevel: CefrLevel.A2 },
      } as any);
      repo.setGroupLevel.mockResolvedValue({ count: 1 });

      const result = await service.setGroupLevel(TEACHER_ID, GROUP_ID, {
        cefrLevel: null,
      });

      expect(repo.setGroupLevel).toHaveBeenCalledWith(
        GROUP_ID,
        TEACHER_ID,
        null,
      );
      expect(result).toMatchObject({
        groupLevel: null,
        courseLevel: CefrLevel.A2,
        effectiveLevel: CefrLevel.A2,
        source: 'COURSE_INHERITED',
      });
    });

    it('throws 403 NOT_OWNING_TEACHER for a cross-teacher group', async () => {
      repo.findGroupWithCourse.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        cefrLevel: null,
        course: { teacherId: OTHER_TEACHER_ID, cefrLevel: null },
      } as any);

      await expect(
        service.setGroupLevel(TEACHER_ID, GROUP_ID, { cefrLevel: CefrLevel.B1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.setGroupLevel).not.toHaveBeenCalled();
    });

    it('throws 404 GROUP_NOT_FOUND when the group is missing', async () => {
      repo.findGroupWithCourse.mockResolvedValue(null);

      await expect(
        service.setGroupLevel(TEACHER_ID, GROUP_ID, { cefrLevel: CefrLevel.B1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // getEffectiveGroupLevel — Req 3.3, 3.4
  // ==================================================================

  describe('getEffectiveGroupLevel', () => {
    it('reflects the override when the group has its own level', async () => {
      repo.findGroupWithCourse.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        cefrLevel: CefrLevel.C2,
        course: { teacherId: TEACHER_ID, cefrLevel: CefrLevel.B1 },
      } as any);

      const result = await service.getEffectiveGroupLevel(TEACHER_ID, GROUP_ID);
      expect(result).toMatchObject({
        effectiveLevel: CefrLevel.C2,
        source: 'GROUP_OVERRIDE',
      });
    });

    it('inherits the course level when the group has no override', async () => {
      repo.findGroupWithCourse.mockResolvedValue({
        id: GROUP_ID,
        courseId: COURSE_ID,
        cefrLevel: null,
        course: { teacherId: TEACHER_ID, cefrLevel: CefrLevel.B1 },
      } as any);

      const result = await service.getEffectiveGroupLevel(TEACHER_ID, GROUP_ID);
      expect(result).toMatchObject({
        effectiveLevel: CefrLevel.B1,
        source: 'COURSE_INHERITED',
      });
    });
  });

  // ==================================================================
  // assertCoursePublishable — Req 3.5
  // ==================================================================

  describe('assertCoursePublishable', () => {
    it('rejects publish with 400 COURSE_LEVEL_REQUIRED when the course has no level', async () => {
      repo.findCourseById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
        cefrLevel: null,
      } as any);

      await expect(
        service.assertCoursePublishable(COURSE_ID),
      ).rejects.toMatchObject({
        response: { code: 'COURSE_LEVEL_REQUIRED' },
      });
    });

    it('passes when the course has a CEFR level', async () => {
      repo.findCourseById.mockResolvedValue({
        id: COURSE_ID,
        teacherId: TEACHER_ID,
        cefrLevel: CefrLevel.B2,
      } as any);

      await expect(
        service.assertCoursePublishable(COURSE_ID),
      ).resolves.toBeUndefined();
    });

    it('throws 404 COURSE_NOT_FOUND when the course is missing', async () => {
      repo.findCourseById.mockResolvedValue(null);

      await expect(
        service.assertCoursePublishable(COURSE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // toLearnerProficiency (pure) — Req 4.1, 4.2
  // ==================================================================

  describe('toLearnerProficiency', () => {
    it('maps a CEFR level to ASSESSED', () => {
      expect(toLearnerProficiency(LEARNER_ID, CefrLevel.B1)).toEqual({
        learnerId: LEARNER_ID,
        currentCefrLevel: CefrLevel.B1,
        status: 'ASSESSED',
      });
    });

    it('maps null to UNASSESSED (Req 4.2)', () => {
      expect(toLearnerProficiency(LEARNER_ID, null)).toEqual({
        learnerId: LEARNER_ID,
        currentCefrLevel: null,
        status: 'UNASSESSED',
      });
    });
  });

  // ==================================================================
  // getProficiency — Req 4.1, 4.2, 4.4 (authorization)
  // ==================================================================

  describe('getProficiency', () => {
    it('returns the level for a STUDENT reading their own record', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.B2);

      const result = await service.getProficiency(
        { sub: LEARNER_ID, role: 'STUDENT' },
        LEARNER_ID,
      );

      expect(result).toEqual({
        learnerId: LEARNER_ID,
        currentCefrLevel: CefrLevel.B2,
        status: 'ASSESSED',
      });
      expect(repo.instructorTeachesLearner).not.toHaveBeenCalled();
    });

    it('returns UNASSESSED when the learner has no level yet (Req 4.2)', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(null);

      const result = await service.getProficiency(
        { sub: LEARNER_ID, role: 'STUDENT' },
        LEARNER_ID,
      );

      expect(result).toMatchObject({
        currentCefrLevel: null,
        status: 'UNASSESSED',
      });
    });

    it('lets a TEACHER read a learner they teach', async () => {
      repo.instructorTeachesLearner.mockResolvedValue(true);
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.A2);

      const result = await service.getProficiency(
        { sub: TEACHER_ID, role: 'TEACHER' },
        LEARNER_ID,
      );

      expect(repo.instructorTeachesLearner).toHaveBeenCalledWith(
        TEACHER_ID,
        LEARNER_ID,
      );
      expect(result.currentCefrLevel).toBe(CefrLevel.A2);
    });

    it('lets an ADMIN read any learner without an enrollment check', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.C1);

      const result = await service.getProficiency(
        { sub: ADMIN_ID, role: 'ADMIN' },
        LEARNER_ID,
      );

      expect(repo.instructorTeachesLearner).not.toHaveBeenCalled();
      expect(result.currentCefrLevel).toBe(CefrLevel.C1);
    });

    it('forbids a STUDENT from reading another learner (Req 4.4)', async () => {
      await expect(
        service.getProficiency({ sub: ADMIN_ID, role: 'STUDENT' }, LEARNER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.getCurrentCefrLevel).not.toHaveBeenCalled();
    });

    it('forbids a TEACHER who does not teach the learner (Req 4.4)', async () => {
      repo.instructorTeachesLearner.mockResolvedValue(false);

      await expect(
        service.getProficiency({ sub: TEACHER_ID, role: 'TEACHER' }, LEARNER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.getCurrentCefrLevel).not.toHaveBeenCalled();
    });

    it('throws 404 LEARNER_NOT_FOUND when no profile exists', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(undefined);

      await expect(
        service.getProficiency({ sub: ADMIN_ID, role: 'ADMIN' }, LEARNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // getProficiencyHistory — Req 4.4
  // ==================================================================

  describe('getProficiencyHistory', () => {
    it('returns history for an authorized reader', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.B1);
      const rows = [
        { id: 'h1', fromLevel: null, toLevel: CefrLevel.B1, source: 'placement' },
      ];
      repo.findProficiencyHistory.mockResolvedValue(rows as any);

      const result = await service.getProficiencyHistory(
        { sub: LEARNER_ID, role: 'STUDENT' },
        LEARNER_ID,
      );

      expect(result).toBe(rows);
      expect(repo.findProficiencyHistory).toHaveBeenCalledWith(LEARNER_ID);
    });

    it('forbids an unrelated teacher', async () => {
      repo.instructorTeachesLearner.mockResolvedValue(false);

      await expect(
        service.getProficiencyHistory(
          { sub: TEACHER_ID, role: 'TEACHER' },
          LEARNER_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.findProficiencyHistory).not.toHaveBeenCalled();
    });

    it('throws 404 LEARNER_NOT_FOUND when no profile exists', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(undefined);

      await expect(
        service.getProficiencyHistory(
          { sub: ADMIN_ID, role: 'ADMIN' },
          LEARNER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================================================================
  // recordProficiencyChange (reusable primitive) — Req 4.4
  // ==================================================================

  describe('recordProficiencyChange', () => {
    it('updates the level and appends history fromLevel→toLevel (Req 4.4)', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.A2);
      repo.applyProficiencyChange.mockResolvedValue({
        id: 'h1',
        learnerId: LEARNER_ID,
        fromLevel: CefrLevel.A2,
        toLevel: CefrLevel.B1,
        source: 'placement',
        changedById: null,
      } as any);

      const result = await service.recordProficiencyChange(
        LEARNER_ID,
        CefrLevel.B1,
        'placement',
        null,
      );

      expect(repo.applyProficiencyChange).toHaveBeenCalledWith({
        learnerId: LEARNER_ID,
        fromLevel: CefrLevel.A2,
        toLevel: CefrLevel.B1,
        source: 'placement',
        changedById: null,
      });
      expect(result.proficiency).toEqual({
        learnerId: LEARNER_ID,
        currentCefrLevel: CefrLevel.B1,
        status: 'ASSESSED',
      });
      expect(result.history.fromLevel).toBe(CefrLevel.A2);
    });

    it('captures the UNASSESSED→level transition (fromLevel null) on first placement', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(null);
      repo.applyProficiencyChange.mockResolvedValue({ id: 'h2' } as any);

      await service.recordProficiencyChange(
        LEARNER_ID,
        CefrLevel.A1,
        'placement',
        null,
      );

      expect(repo.applyProficiencyChange).toHaveBeenCalledWith(
        expect.objectContaining({ fromLevel: null, toLevel: CefrLevel.A1 }),
      );
    });

    it('supports a migration reverting a learner to UNASSESSED (toLevel null)', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.B2);
      repo.applyProficiencyChange.mockResolvedValue({ id: 'h3' } as any);

      const result = await service.recordProficiencyChange(
        LEARNER_ID,
        null,
        'migration',
        null,
      );

      expect(result.proficiency.status).toBe('UNASSESSED');
      expect(repo.applyProficiencyChange).toHaveBeenCalledWith(
        expect.objectContaining({ toLevel: null, source: 'migration' }),
      );
    });

    it('throws 404 LEARNER_NOT_FOUND when the learner has no profile', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(undefined);

      await expect(
        service.recordProficiencyChange(
          LEARNER_ID,
          CefrLevel.B1,
          'placement',
          null,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.applyProficiencyChange).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // setProficiencyByInstructor — Req 4.4 (authorization + history)
  // ==================================================================

  describe('setProficiencyByInstructor', () => {
    it('records an instructor change for a taught learner', async () => {
      repo.instructorTeachesLearner.mockResolvedValue(true);
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.A2);
      repo.applyProficiencyChange.mockResolvedValue({ id: 'h1' } as any);

      const result = await service.setProficiencyByInstructor(
        TEACHER_ID,
        LEARNER_ID,
        CefrLevel.B1,
      );

      expect(repo.instructorTeachesLearner).toHaveBeenCalledWith(
        TEACHER_ID,
        LEARNER_ID,
      );
      expect(repo.applyProficiencyChange).toHaveBeenCalledWith(
        expect.objectContaining({
          learnerId: LEARNER_ID,
          fromLevel: CefrLevel.A2,
          toLevel: CefrLevel.B1,
          source: 'instructor',
          changedById: TEACHER_ID,
        }),
      );
      expect(result).toEqual({
        learnerId: LEARNER_ID,
        currentCefrLevel: CefrLevel.B1,
        status: 'ASSESSED',
      });
    });

    it('throws 403 NOT_TEACHING_LEARNER when the instructor does not teach the learner', async () => {
      repo.instructorTeachesLearner.mockResolvedValue(false);

      await expect(
        service.setProficiencyByInstructor(
          TEACHER_ID,
          LEARNER_ID,
          CefrLevel.B1,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.applyProficiencyChange).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // getLearnerProficiencyLevel — Discovery accessor (Req 4.5, 3.6)
  // ==================================================================

  describe('getLearnerProficiencyLevel', () => {
    it('returns the raw CEFR level for discovery', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(CefrLevel.C1);
      await expect(
        service.getLearnerProficiencyLevel(LEARNER_ID),
      ).resolves.toBe(CefrLevel.C1);
    });

    it('returns null (UNASSESSED) when the learner has no level', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(null);
      await expect(
        service.getLearnerProficiencyLevel(LEARNER_ID),
      ).resolves.toBeNull();
    });

    it('returns null when the learner profile does not exist', async () => {
      repo.getCurrentCefrLevel.mockResolvedValue(undefined);
      await expect(
        service.getLearnerProficiencyLevel(LEARNER_ID),
      ).resolves.toBeNull();
    });
  });
});
