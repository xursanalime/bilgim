import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { GradeSpeakingSubmissionDto, OverrideSpeakingScoreDto } from './dto';
import {
  SpeakingScoringContext,
  SpeakingSubmissionRepository,
} from './repositories/speaking-submission.repository';
import { isSpeakingModuleType, type SpeakingAudioAnswer } from './speaking.types';
import {
  SPEAKING_AI_DRAFT_AUTHOR_TYPE,
  SPEAKING_GRADED_TOPIC,
  SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
  SPEAKING_SCORING_FAILED_TOPIC,
  SPEAKING_SCORING_JOB_NAME,
  SPEAKING_SCORING_PORT,
  SPEAKING_TEACHER_AUTHOR_TYPE,
  type SpeakingAiDraftPayload,
  type SpeakingScoringJob,
  type SpeakingScoringPort,
  clamp01,
} from './speaking-scoring.types';

/** JWT roles relevant to the override flow. */
type SpeakingScoringRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface SpeakingScoringActor {
  userId: string;
  role: SpeakingScoringRole;
}

/** Result of `score()` — surfaced by the processor for metrics. */
export interface SpeakingScoreOutcome {
  submissionId: string;
  /** `true` when this run wrote a new AI_DRAFT Feedback row. */
  feedbackCreated: boolean;
  /** `true` when the run was an idempotent / non-applicable no-op. */
  skipped: boolean;
  /** Numeric score (scaled to totalPoints) when produced. */
  score: number | null;
}

/**
 * The located AUDIO answer for a submission: which speaking module it
 * belongs to and the AUDIO MediaAsset id.
 */
interface LocatedAudioAnswer {
  moduleId: string;
  moduleType: string;
  assetId: string;
  contentType: string;
}

/**
 * SpeakingScoringService — drives AI scoring of audio submissions and
 * the instructor override (Task 4.2, Req 7.3, 7.4, 7.6).
 *
 * Pipeline (mirrors the homework AI-grading flow):
 *
 *   submit (SUBMITTED)
 *        │  enqueueScoring()            ← Req 7.3
 *        ▼
 *   speaking-scoring queue
 *        │  SpeakingScoringProcessor → score()
 *        ▼
 *   AI_DRAFT Feedback row + SUBMITTED → IN_REVIEW   ← Req 7.4
 *        │
 *        │  overrideScore() (teacher, pre-GRADED)   ← Req 7.6
 *        ▼
 *   (final GRADED transition stays on the existing homework grade path)
 *
 * The scoring provider itself is provider-agnostic (`SpeakingScoringPort`)
 * because the transcription/scoring engine is an Open Question (6/7).
 */
@Injectable()
export class SpeakingScoringService {
  private readonly logger = new Logger(SpeakingScoringService.name);

  constructor(
    private readonly submissions: SpeakingSubmissionRepository,
    @Inject(SPEAKING_SCORING_PORT)
    private readonly scoringPort: SpeakingScoringPort,
    @InjectQueue(QUEUE_NAMES.SPEAKING_SCORING)
    private readonly scoringQueue: Queue,
    private readonly outbox: OutboxService,
  ) {}

  // ==================================================================
  // 1. Enqueue on SUBMITTED (Req 7.3)
  // ==================================================================

  /**
   * Enqueue an AI scoring job for a submission that has reached
   * SUBMITTED (Req 7.3). Verifies the submission exists, is in SUBMITTED
   * status, and carries a SPEAKING/PRONUNCIATION AUDIO answer before
   * pushing the job — a text-only submission is never enqueued here (it
   * flows through the homework text-precheck queue instead).
   *
   * Returns `true` when a job was enqueued, `false` when the submission
   * is not an applicable speaking submission (so the caller can no-op).
   *
   * BullMQ dedups by `jobId = "speaking-score:{submissionId}"` so a
   * retried submit never piles up parallel scoring runs; `score()` is
   * also idempotent end to end.
   */
  async enqueueScoring(submissionId: string): Promise<boolean> {
    const context = await this.submissions.findScoringContext(submissionId);
    if (!context) {
      this.logger.warn(
        `enqueueScoring: submission ${submissionId} not found; skipping`,
      );
      return false;
    }

    if (context.status !== 'SUBMITTED') {
      this.logger.debug(
        `enqueueScoring: submission ${submissionId} is ${context.status}, not SUBMITTED; skipping`,
      );
      return false;
    }

    const audio = this.locateAudioAnswer(context);
    if (!audio) {
      this.logger.debug(
        `enqueueScoring: submission ${submissionId} has no speaking audio answer; skipping`,
      );
      return false;
    }

    const job: SpeakingScoringJob = {
      submissionId,
      moduleId: audio.moduleId,
      assetId: audio.assetId,
      idempotencyKey: `speaking-score:${submissionId}`,
    };

    await this.scoringQueue.add(SPEAKING_SCORING_JOB_NAME, job, {
      jobId: `speaking-score:${submissionId}`,
    });

    this.logger.log(
      `enqueueScoring: submission ${submissionId} → speaking-scoring queue ` +
        `(module=${audio.moduleId} asset=${audio.assetId})`,
    );
    return true;
  }

  // ==================================================================
  // 2. Score (Req 7.4) — called by the processor
  // ==================================================================

  /**
   * Score one audio submission and persist the verdict as an AI_DRAFT
   * Feedback row, then transition SUBMITTED → IN_REVIEW (Req 7.4).
   *
   * Idempotent: a re-delivered job for a submission that already has an
   * AI_DRAFT row, or that is no longer in SUBMITTED, returns
   * `{ skipped: true }` without calling the provider or writing a
   * second row.
   */
  async score(submissionId: string): Promise<SpeakingScoreOutcome> {
    const context = await this.submissions.findScoringContext(submissionId);
    if (!context) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: `Submission ${submissionId} not found`,
      });
    }

    // Idempotency guard #1 — already scored once.
    const existing = await this.submissions.findAiDraftFeedback(
      submissionId,
      SPEAKING_AI_DRAFT_AUTHOR_TYPE,
    );
    if (existing) {
      this.logger.debug(
        `score: submission ${submissionId} already has an AI_DRAFT (${existing.id}); skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    // Idempotency guard #2 — only score SUBMITTED rows. A row already in
    // IN_REVIEW/GRADED/RETURNED was handled by a previous run.
    if (context.status !== 'SUBMITTED') {
      this.logger.debug(
        `score: submission ${submissionId} is ${context.status}, not SUBMITTED; skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    const audio = this.locateAudioAnswer(context);
    if (!audio) {
      // No audio to score — surface so the failure path (Task 4.3) can
      // notify the instructor for manual review (Req 7.5).
      throw new BadRequestException({
        code: 'SPEAKING_AUDIO_ANSWER_MISSING',
        message: `Submission ${submissionId} has no speaking audio answer to score`,
      });
    }

    // Call the (provider-agnostic) scoring engine. Errors propagate to
    // the BullMQ worker so the retry/notify policy in Task 4.3 applies.
    const verdict = await this.scoringPort.scoreAudio({
      submissionId,
      moduleId: audio.moduleId,
      assetId: audio.assetId,
      contentType: audio.contentType,
      moduleType: audio.moduleType,
    });

    const scoreRaw = clamp01(verdict.overall);
    const numericScore = Math.round(scoreRaw * context.totalPoints);

    const payload: SpeakingAiDraftPayload = {
      kind: 'SPEAKING_SCORE',
      source: 'AI_DRAFT',
      moduleId: audio.moduleId,
      assetId: audio.assetId,
      score: numericScore,
      scoreRaw,
      pronunciation: {
        score: clamp01(verdict.pronunciation.score),
        comment: verdict.pronunciation.comment,
      },
      fluency: {
        score: clamp01(verdict.fluency.score),
        comment: verdict.fluency.comment,
      },
      summary: verdict.summary,
      provider: verdict.provider,
      transcript: verdict.transcript ?? null,
      idempotencyTag: `speaking-score:${submissionId}`,
    };

    const result = await this.submissions.runInTransaction(async (tx) => {
      // Re-check inside the transaction for race-safety with a concurrent
      // worker that picked up the same job.
      const raceCheck = await this.submissions.findAiDraftFeedback(
        submissionId,
        SPEAKING_AI_DRAFT_AUTHOR_TYPE,
        tx,
      );
      if (raceCheck) {
        return { feedbackCreated: false } as const;
      }

      await this.submissions.createFeedback(
        {
          submissionId,
          authorType: SPEAKING_AI_DRAFT_AUTHOR_TYPE,
          authorId: null,
          payload: payload as unknown as Prisma.InputJsonValue,
          isFinal: false,
        },
        tx,
      );

      // Stamp the draft numeric score and flip SUBMITTED → IN_REVIEW so
      // the submission always carries a score (Property 4) and the
      // teacher knows the precheck is complete.
      await this.submissions.transitionToInReview(submissionId, numericScore, tx);

      return { feedbackCreated: true } as const;
    });

    this.logger.log(
      `score: submission ${submissionId} → IN_REVIEW ` +
        `(score=${numericScore}/${context.totalPoints} provider=${verdict.provider})`,
    );

    return {
      submissionId,
      feedbackCreated: result.feedbackCreated,
      skipped: !result.feedbackCreated,
      score: numericScore,
    };
  }

  // ==================================================================
  // 3. Instructor override before GRADED (Req 7.6)
  // ==================================================================

  /**
   * Let the owning instructor override the AI score and/or feedback
   * before the submission reaches GRADED (Req 7.6).
   *
   * Authorisation: only the teacher who owns the lesson (or an ADMIN)
   * may override. The submission must still be pre-GRADED (SUBMITTED or
   * IN_REVIEW) — once GRADED, the override window is closed and the
   * caller must use the normal grade flow.
   *
   * Persists the override as a TEACHER-authored, non-final Feedback row
   * (the final GRADED feedback is still produced by the homework grade
   * path) and stamps the overridden numeric score on the submission.
   */
  async overrideScore(
    actor: SpeakingScoringActor,
    submissionId: string,
    dto: OverrideSpeakingScoreDto,
  ): Promise<SpeakingScoreOutcome> {
    const context = await this.submissions.findScoringContext(submissionId);
    if (!context) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: `Submission ${submissionId} not found`,
      });
    }

    // Authorise the owning instructor (ADMIN bypasses).
    if (actor.role === 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Only an instructor can override a speaking score',
      });
    }
    if (actor.role === 'TEACHER' && context.teacherId !== actor.userId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only override scores for your own lessons',
      });
    }

    // Override window: before GRADED only (Req 7.6).
    if (context.status !== 'SUBMITTED' && context.status !== 'IN_REVIEW') {
      throw new ConflictException({
        code: 'OVERRIDE_WINDOW_CLOSED',
        message:
          `Submission ${submissionId} is in status ${context.status}; the AI score ` +
          'can only be overridden before it reaches GRADED.',
      });
    }

    if (dto.score < 0 || dto.score > context.totalPoints) {
      throw new ConflictException({
        code: 'SCORE_OUT_OF_RANGE',
        message: `Score must be between 0 and ${context.totalPoints} (got ${dto.score})`,
        details: { score: dto.score, totalPoints: context.totalPoints },
      });
    }

    const overridePayload: Prisma.InputJsonValue = {
      kind: 'SPEAKING_SCORE_OVERRIDE',
      source: 'TEACHER',
      overridesAuthorType: SPEAKING_AI_DRAFT_AUTHOR_TYPE,
      score: dto.score,
      ...(dto.pronunciation !== undefined && { pronunciation: dto.pronunciation }),
      ...(dto.fluency !== undefined && { fluency: dto.fluency }),
      ...(dto.comment !== undefined && { comment: dto.comment }),
      overriddenAt: new Date().toISOString(),
      overriddenBy: actor.userId,
    };

    await this.submissions.runInTransaction(async (tx) => {
      const moved = await this.submissions.overrideScore(
        submissionId,
        dto.score,
        tx,
      );
      if (moved === 0) {
        // A concurrent grade transition closed the window between our
        // read and the write.
        throw new ConflictException({
          code: 'OVERRIDE_WINDOW_CLOSED',
          message: `Submission ${submissionId} was graded by a concurrent caller`,
        });
      }
      await this.submissions.createFeedback(
        {
          submissionId,
          authorType: SPEAKING_TEACHER_AUTHOR_TYPE,
          authorId: actor.userId,
          payload: overridePayload,
          isFinal: false,
        },
        tx,
      );
    });

    this.logger.log(
      `overrideScore: submission ${submissionId} score overridden to ` +
        `${dto.score}/${context.totalPoints} by ${actor.role} ${actor.userId}`,
    );

    return {
      submissionId,
      feedbackCreated: true,
      skipped: false,
      score: dto.score,
    };
  }

  // ==================================================================
  // 4. Terminal scoring failure → mark failed + notify instructor (Req 7.5)
  // ==================================================================

  /**
   * Mark a submission's AI scoring as terminally FAILED after the
   * `speaking-scoring` queue exhausts its retries, and notify the owning
   * instructor so they can grade the recording manually (Task 4.3,
   * Req 7.5).
   *
   * Called by `SpeakingScoringProcessor` only on the FINAL failed attempt
   * (`job.attemptsMade + 1 >= attempts`). `SubmissionStatus` has no
   * FAILED member and the schema is frozen for this task, so the failure
   * is recorded as a dedicated Feedback row
   * (`authorType = AI_SCORING_FAILED`). That row is the durable failed
   * marker — the submission is never left silently stuck waiting for an
   * AI draft that will never arrive (Property 4: a speaking submission
   * always ends with either an AI score or a manual-review flag).
   *
   * Idempotent: a re-delivered terminal failure is a no-op once the
   * failure marker exists, so the instructor is notified exactly once.
   * If a previous attempt actually produced an AI_DRAFT, or the teacher
   * already graded the submission, this is also a no-op.
   */
  async markScoringFailed(
    submissionId: string,
    reason?: string,
  ): Promise<SpeakingScoreOutcome> {
    const context = await this.submissions.findScoringContext(submissionId);
    if (!context) {
      this.logger.warn(
        `markScoringFailed: submission ${submissionId} not found; skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    // If scoring actually succeeded on an earlier attempt there is a
    // draft and nothing failed — never overwrite a success with a failure.
    const existingDraft = await this.submissions.findAiDraftFeedback(
      submissionId,
      SPEAKING_AI_DRAFT_AUTHOR_TYPE,
    );
    if (existingDraft) {
      this.logger.debug(
        `markScoringFailed: submission ${submissionId} already has an AI_DRAFT; skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    // Idempotency — already marked failed (instructor already notified).
    const existingFailure = await this.submissions.findAiDraftFeedback(
      submissionId,
      SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
    );
    if (existingFailure) {
      this.logger.debug(
        `markScoringFailed: submission ${submissionId} already marked failed; skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    // A teacher may have graded manually while retries were in flight —
    // no manual-review prompt needed any more.
    if (context.status === 'GRADED') {
      this.logger.debug(
        `markScoringFailed: submission ${submissionId} already GRADED; skipping`,
      );
      return { submissionId, feedbackCreated: false, skipped: true, score: null };
    }

    const failurePayload: Prisma.InputJsonValue = {
      kind: 'SPEAKING_SCORE_FAILED',
      source: 'AI_SCORING',
      reason: reason ?? 'AI scoring failed after the configured retries',
      manualReviewRequired: true,
      failedAt: new Date().toISOString(),
      idempotencyTag: `speaking-score-failed:${submissionId}`,
    };

    const result = await this.submissions.runInTransaction(async (tx) => {
      // Race re-check inside the transaction (concurrent terminal failure).
      const race = await this.submissions.findAiDraftFeedback(
        submissionId,
        SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
        tx,
      );
      if (race) {
        return { feedbackCreated: false } as const;
      }

      await this.submissions.createFeedback(
        {
          submissionId,
          authorType: SPEAKING_SCORING_FAILED_AUTHOR_TYPE,
          authorId: null,
          payload: failurePayload,
          isFinal: false,
        },
        tx,
      );

      // Notify the instructor for manual review (Req 7.5) through the
      // transactional outbox — committed atomically with the failure
      // marker. The fan-out worker translates this into a single
      // instructor notification; the idempotency key keeps it once.
      await this.outbox.create(tx, {
        topic: SPEAKING_SCORING_FAILED_TOPIC,
        payload: {
          submissionId,
          assignmentId: context.assignmentId,
          studentId: context.studentId,
          teacherId: context.teacherId,
          reason: reason ?? null,
        },
        idempotencyKey: `${SPEAKING_SCORING_FAILED_TOPIC}:${submissionId}`,
      });

      return { feedbackCreated: true } as const;
    });

    this.logger.warn(
      `markScoringFailed: submission ${submissionId} marked FAILED; ` +
        `instructor ${context.teacherId} notified for manual review` +
        (reason ? ` (reason: ${reason})` : ''),
    );

    return {
      submissionId,
      feedbackCreated: result.feedbackCreated,
      skipped: !result.feedbackCreated,
      score: null,
    };
  }

  // ==================================================================
  // 5. Finalize grade → GRADED + homework-graded notification (Req 15.3)
  // ==================================================================

  /**
   * Apply the instructor's FINAL grade to a speaking/pronunciation
   * submission and move it to GRADED (Task 4.3, Req 15.3). This is the
   * terminal transition the pre-GRADED override (`overrideScore`)
   * deliberately stops short of — it works whether the grade is the
   * AI draft confirmed by the instructor or a fully manual grade.
   *
   * On the GRADED transition it emits the existing `homework.graded`
   * outbox topic (idempotency key `homework.graded:{submissionId}`),
   * REUSING the homework module's notification path so the learner gets
   * the same single HOMEWORK_GRADED notification (Req 15.3). Re-emitting
   * the same key (e.g. via the generic homework grade path) is deduped
   * by the outbox.
   */
  async finalizeGrade(
    actor: SpeakingScoringActor,
    submissionId: string,
    dto: GradeSpeakingSubmissionDto,
  ): Promise<SpeakingScoreOutcome> {
    const context = await this.submissions.findScoringContext(submissionId);
    if (!context) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: `Submission ${submissionId} not found`,
      });
    }

    // Authorise the owning instructor (ADMIN bypasses).
    if (actor.role === 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Only an instructor can grade a speaking submission',
      });
    }
    if (actor.role === 'TEACHER' && context.teacherId !== actor.userId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only grade submissions for your own lessons',
      });
    }

    // Grade only a pre-GRADED submission (SUBMITTED / IN_REVIEW).
    if (context.status !== 'SUBMITTED' && context.status !== 'IN_REVIEW') {
      throw new ConflictException({
        code: 'INVALID_SUBMISSION_TRANSITION',
        message: `Cannot grade a submission in status ${context.status}`,
      });
    }

    if (dto.score < 0 || dto.score > context.totalPoints) {
      throw new ConflictException({
        code: 'SCORE_OUT_OF_RANGE',
        message: `Score must be between 0 and ${context.totalPoints} (got ${dto.score})`,
        details: { score: dto.score, totalPoints: context.totalPoints },
      });
    }

    await this.submissions.runInTransaction(async (tx) => {
      const moved = await this.submissions.transitionToGraded(
        submissionId,
        dto.score,
        tx,
      );
      if (moved === 0) {
        // A concurrent caller graded the submission between read and write.
        throw new ConflictException({
          code: 'INVALID_SUBMISSION_TRANSITION',
          message: `Submission ${submissionId} was already graded by a concurrent caller`,
        });
      }

      if (dto.comment !== undefined) {
        await this.submissions.createFeedback(
          {
            submissionId,
            authorType: SPEAKING_TEACHER_AUTHOR_TYPE,
            authorId: actor.userId,
            payload: {
              kind: 'SPEAKING_GRADE',
              source: 'TEACHER',
              score: dto.score,
              comment: dto.comment,
              gradedAt: new Date().toISOString(),
              gradedBy: actor.userId,
            } as Prisma.InputJsonValue,
            isFinal: true,
          },
          tx,
        );
      }

      // Notify the learner their work was graded (Req 15.3) — reuse the
      // homework module's topic + key so the existing fan-out produces a
      // single HOMEWORK_GRADED notification.
      await this.outbox.create(tx, {
        topic: SPEAKING_GRADED_TOPIC,
        payload: {
          submissionId,
          assignmentId: context.assignmentId,
          studentId: context.studentId,
          teacherId: actor.userId,
          score: dto.score,
          totalPoints: context.totalPoints,
        },
        idempotencyKey: `${SPEAKING_GRADED_TOPIC}:${submissionId}`,
      });
    });

    this.logger.log(
      `finalizeGrade: submission ${submissionId} → GRADED ` +
        `score=${dto.score}/${context.totalPoints} by ${actor.role} ${actor.userId}; ` +
        'learner notified (homework.graded)',
    );

    return {
      submissionId,
      feedbackCreated: dto.comment !== undefined,
      skipped: false,
      score: dto.score,
    };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Locate the first SPEAKING/PRONUNCIATION AUDIO answer slice stored on
   * the submission. `answersJson` is `{ [moduleId]: <module answer> }`;
   * an audio slice carries `{ kind: 'AUDIO', assetId, contentType }`
   * (see `SpeakingAudioAnswer`). Only module ids that map to a
   * SPEAKING/PRONUNCIATION assignment module are considered.
   */
  private locateAudioAnswer(
    context: SpeakingScoringContext,
  ): LocatedAudioAnswer | null {
    const answers = this.coerceAnswersObject(context.answersJson);
    const speakingModuleTypeById = new Map(
      context.modules
        .filter((m) => isSpeakingModuleType(m.type))
        .map((m) => [m.id, m.type as string]),
    );

    for (const [moduleId, raw] of Object.entries(answers)) {
      const moduleType = speakingModuleTypeById.get(moduleId);
      if (!moduleType) continue;
      if (!raw || typeof raw !== 'object') continue;
      const slice = raw as Partial<SpeakingAudioAnswer>;
      if (slice.kind !== 'AUDIO' || typeof slice.assetId !== 'string') continue;
      return {
        moduleId,
        moduleType,
        assetId: slice.assetId,
        contentType:
          typeof slice.contentType === 'string' ? slice.contentType : '',
      };
    }
    return null;
  }

  private coerceAnswersObject(
    value: Prisma.JsonValue | null,
  ): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
