import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CefrLevel, Prisma } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { LevelingService } from '../leveling/leveling.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import {
  findQuestion,
  getPublicQuestionSequence,
  PLACEMENT_QUESTION_BANK,
  PublicPlacementQuestion,
} from './question-bank';
import {
  AssessmentWithAnswers,
  PlacementRepository,
} from './repositories/placement.repository';
import { PerSkillScore, scoreAssessment } from './scoring';

/** A previously saved answer, returned on resume. */
export interface SavedAnswer {
  questionRef: string;
  skill: string;
  answer: Prisma.JsonValue;
}

/**
 * Learner-facing view of a placement assessment. Deliberately excludes
 * per-question answer keys and (until Task 3.2) any computed score.
 */
export interface PlacementAssessmentView {
  id: string;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  /** The full question sequence to present (no answer keys). */
  questions: PublicPlacementQuestion[];
  /** Answers already saved, so the client can restore progress (Req 5.4). */
  savedAnswers: SavedAnswer[];
}

/**
 * Terminal statuses for a placement assessment. Once an assessment reaches one
 * of these it is "completed": re-submitting is an idempotent no-op (Req 5.2).
 * Scoring sets `SCORED`; `SUBMITTED` is accepted as terminal for forward
 * compatibility with the schema's documented status set.
 */
const COMPLETED_STATUSES = new Set(['SUBMITTED', 'SCORED']);

/** Outbox topic for a computed placement result (Req 15.1). */
export const PLACEMENT_RESULT_TOPIC = 'placement.result';

/**
 * Learner-facing result of a scored placement assessment (Task 3.2). Unlike
 * {@link PlacementAssessmentView} this exposes the computed CEFR level and the
 * per-skill breakdown (Req 5.2, 5.5) but never the answer keys.
 */
export interface PlacementResultView {
  id: string;
  status: string;
  startedAt: Date;
  submittedAt: Date | null;
  /** The computed CEFR level, or null if not yet scored. */
  computedLevel: CefrLevel | null;
  /** Per-skill score breakdown, or null if not yet scored. */
  perSkillScores: PerSkillScore[] | null;
}

/**
 * PlacementService — administers the placement assessment (Task 3.1).
 *
 * Scope (Req 5.1, 5.4):
 *  - start an assessment presenting READING/GRAMMAR/VOCABULARY questions,
 *  - persist answers incrementally so an abandoned assessment can be resumed,
 *  - resume an existing assessment.
 *
 * Out of scope (Task 3.2): submission, scoring and CEFR computation. No score
 * or `computedLevel` is produced here.
 */
@Injectable()
export class PlacementService {
  private readonly logger = new Logger(PlacementService.name);

  constructor(
    private readonly repository: PlacementRepository,
    private readonly levelingService: LevelingService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Start (or resume) a placement assessment for the calling learner.
   *
   * To keep the flow resumable and avoid orphaning half-finished sessions, if
   * the learner already has an IN_PROGRESS assessment we return that one
   * (with its saved answers) rather than creating a duplicate. Otherwise a
   * fresh IN_PROGRESS assessment is created.
   */
  async start(learnerId: string): Promise<PlacementAssessmentView> {
    const existing =
      await this.repository.findInProgressForLearner(learnerId);
    if (existing) {
      this.logger.log(
        `Resuming in-progress placement assessment ${existing.id} for learner ${learnerId}`,
      );
      return this.toView(existing);
    }

    // `learnerId` FKs to StudentProfile.userId; ensure the profile exists.
    await this.repository.ensureStudentProfile(learnerId);
    const assessment = await this.repository.createAssessment(learnerId);
    this.logger.log(
      `Started placement assessment ${assessment.id} for learner ${learnerId}`,
    );
    return this.toView(assessment);
  }

  /**
   * Persist a single answer for an in-progress assessment (Req 5.4).
   *
   * Enforces:
   *  - learner ownership (403 NOT_OWNING_LEARNER),
   *  - the assessment is still IN_PROGRESS (409 PLACEMENT_NOT_IN_PROGRESS),
   *  - the questionRef belongs to the bank (404 PLACEMENT_QUESTION_NOT_FOUND).
   *
   * The skill is derived from the question bank server-side so it always
   * matches the question and never trusts client input.
   */
  async saveAnswer(
    learnerId: string,
    assessmentId: string,
    dto: SubmitAnswerDto,
  ): Promise<PlacementAssessmentView> {
    const assessment = await this.loadOwnedAssessment(learnerId, assessmentId);

    if (assessment.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'PLACEMENT_NOT_IN_PROGRESS',
        message: 'This placement assessment can no longer be edited',
      });
    }

    const question = findQuestion(dto.questionRef);
    if (!question) {
      throw new NotFoundException({
        code: 'PLACEMENT_QUESTION_NOT_FOUND',
        message: `Unknown placement question: ${dto.questionRef}`,
      });
    }

    await this.repository.upsertAnswer({
      assessmentId: assessment.id,
      skill: question.skill,
      questionRef: question.questionRef,
      answer: dto.answer as Prisma.InputJsonValue,
    });

    // Re-load so the returned view reflects the freshly persisted answer.
    const updated = await this.repository.findById(assessment.id);
    return this.toView(updated ?? assessment);
  }

  /**
   * Resume an assessment: return its questions and any saved answers (Req 5.4).
   * Enforces learner ownership.
   */
  async getById(
    learnerId: string,
    assessmentId: string,
  ): Promise<PlacementAssessmentView> {
    const assessment = await this.loadOwnedAssessment(learnerId, assessmentId);
    return this.toView(assessment);
  }

  /**
   * Submit + score a placement assessment (Task 3.2, Req 5.2, 5.3, 5.5, 15.1).
   *
   * Flow for an IN_PROGRESS assessment:
   *   1. Require every bank question to be answered (Req 5.2 — "submits all
   *      answers"); otherwise 409 PLACEMENT_INCOMPLETE.
   *   2. Score the answers → per-skill breakdown + overall CEFR level
   *      (deterministic, see `scoring.ts`).
   *   3. Atomically transition IN_PROGRESS → SCORED, persisting perSkillScores
   *      + computedLevel. This `updateMany`-guarded transition is the
   *      idempotency gate (Req 5.2): only the winning submit proceeds.
   *   4. Set the learner's proficiency to the computed level by REUSING
   *      `LevelingService.recordProficiencyChange(..., 'placement', null)` —
   *      no proficiency-write logic is duplicated here (Req 5.3, 4.3).
   *   5. Emit a `placement.result` outbox event so the Notifications_Module
   *      fans out a placement-result notification (Req 15.1). The event is
   *      idempotent on `placement.result:{assessmentId}`.
   *
   * Idempotency (Req 5.2): re-submitting an already-completed assessment
   * short-circuits and returns the stored result WITHOUT re-writing
   * proficiency/history or re-notifying. Under a concurrent double-submit the
   * optimistic transition guarantees exactly one winner; the loser is treated
   * as a replay.
   */
  async submit(
    learnerId: string,
    assessmentId: string,
  ): Promise<PlacementResultView> {
    const assessment = await this.loadOwnedAssessment(learnerId, assessmentId);

    // Idempotent replay: already completed → return stored result, no writes.
    if (COMPLETED_STATUSES.has(assessment.status)) {
      this.logger.log(
        `Placement assessment ${assessmentId} already ${assessment.status}; returning stored result (idempotent)`,
      );
      return this.toResultView(assessment);
    }

    if (assessment.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'PLACEMENT_NOT_IN_PROGRESS',
        message: 'This placement assessment cannot be submitted',
      });
    }

    // (1) Require a complete assessment before scoring (Req 5.2).
    this.assertComplete(assessment);

    // (2) Score → per-skill breakdown + overall CEFR level.
    const score = scoreAssessment(
      assessment.answers.map((a) => ({
        questionRef: a.questionRef,
        answer: a.answer,
      })),
    );

    // (3) Optimistic transition IN_PROGRESS → SCORED (idempotency gate).
    const transitioned = await this.repository.completeAssessment({
      assessmentId,
      perSkillScores: score.perSkill as unknown as Prisma.InputJsonValue,
      computedLevel: score.computedLevel,
    });

    if (!transitioned) {
      // A concurrent submit won the race. Treat as an idempotent replay:
      // reload and return the stored result without re-writing anything.
      this.logger.log(
        `Placement assessment ${assessmentId} was completed concurrently; returning stored result`,
      );
      const reloaded = await this.repository.findById(assessmentId);
      return this.toResultView(reloaded ?? assessment);
    }

    this.logger.log(
      `Scored placement assessment ${assessmentId}: level=${score.computedLevel} ` +
        `ratio=${score.overallRatio.toFixed(3)} (learner=${learnerId})`,
    );

    // (4) Set learner proficiency by reusing the leveling primitive (Req 5.3).
    await this.levelingService.recordProficiencyChange(
      learnerId,
      score.computedLevel,
      'placement',
      null,
    );

    // (5) Emit the placement-result notification event (Req 15.1).
    await this.repository.runInTransaction((tx) =>
      this.outboxService.create(tx, {
        topic: PLACEMENT_RESULT_TOPIC,
        payload: {
          assessmentId,
          learnerId,
          computedLevel: score.computedLevel,
          perSkillScores: score.perSkill,
        },
        idempotencyKey: `${PLACEMENT_RESULT_TOPIC}:${assessmentId}`,
      }),
    );

    const reloaded = await this.repository.findById(assessmentId);
    return this.toResultView(reloaded ?? assessment);
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Load an assessment and assert it belongs to `learnerId`. Throws 404 when
   * missing and 403 when owned by another learner.
   */
  private async loadOwnedAssessment(
    learnerId: string,
    assessmentId: string,
  ): Promise<AssessmentWithAnswers> {
    const assessment = await this.repository.findById(assessmentId);
    if (!assessment) {
      throw new NotFoundException({
        code: 'PLACEMENT_ASSESSMENT_NOT_FOUND',
        message: 'Placement assessment not found',
      });
    }
    if (assessment.learnerId !== learnerId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_LEARNER',
        message: 'You can only access your own placement assessment',
      });
    }
    return assessment;
  }

  /** Build the learner-facing view (no answer keys, no score). */
  private toView(assessment: AssessmentWithAnswers): PlacementAssessmentView {
    return {
      id: assessment.id,
      status: assessment.status,
      startedAt: assessment.startedAt,
      submittedAt: assessment.submittedAt,
      questions: getPublicQuestionSequence(),
      savedAnswers: assessment.answers.map((a) => ({
        questionRef: a.questionRef,
        skill: a.skill,
        answer: a.answer as Prisma.JsonValue,
      })),
    };
  }

  /**
   * Assert every question in the bank has a saved answer before scoring
   * (Req 5.2 — scoring happens "when a Learner submits all placement
   * answers"). Throws 409 PLACEMENT_INCOMPLETE listing the missing refs.
   */
  private assertComplete(assessment: AssessmentWithAnswers): void {
    const answered = new Set(assessment.answers.map((a) => a.questionRef));
    const missing = PLACEMENT_QUESTION_BANK.filter(
      (q) => !answered.has(q.questionRef),
    ).map((q) => q.questionRef);

    if (missing.length > 0) {
      throw new ConflictException({
        code: 'PLACEMENT_INCOMPLETE',
        message:
          'All placement questions must be answered before submitting',
        details: [{ field: 'answers', missing }],
      });
    }
  }

  /**
   * Build the scored-result view (Req 5.2, 5.5). `perSkillScores` is persisted
   * as JSON, so we cast it back to the typed `PerSkillScore[]` for the API.
   */
  private toResultView(assessment: AssessmentWithAnswers): PlacementResultView {
    return {
      id: assessment.id,
      status: assessment.status,
      startedAt: assessment.startedAt,
      submittedAt: assessment.submittedAt,
      computedLevel: assessment.computedLevel,
      perSkillScores:
        assessment.perSkillScores === null
          ? null
          : (assessment.perSkillScores as unknown as PerSkillScore[]),
    };
  }
}
