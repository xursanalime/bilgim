import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  AssignmentModule,
  Prisma,
  PrismaClient,
  Submission,
  SubmissionStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { ZodError } from 'zod';

import { EnvConfig } from '../../config/env.schema';
import { QUEUE_NAMES } from '../../infra/bullmq/queue.constants';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { withTraceJobOptions } from '../../common/observability';
import { AiTextDetectService } from '../ai/ai-text-detect.service';
import { AI_LIKELIHOOD_FLAG_THRESHOLD } from '../ai/ai.constants';
import {
  FeedbackEntryDto,
  GradeSubmissionDto,
  ReturnSubmissionDto,
  SubmitSubmissionDto,
  UpdateSubmissionAnswersDto,
} from './dto';
import {
  SubmissionRepository,
  SubmissionWithContext,
} from './repositories/submission.repository';
import { HomeworkModuleRuntimeRegistry } from './runtimes/registry';
import { HomeworkRuntimeError } from './runtimes/types';
import {
  AI_GRADING_JOB_NAME,
  AiGradingJob,
} from './workers/ai-grading.processor';

/** JWT roles relevant for the submission lifecycle. */
type SubmissionActorRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface SubmissionActor {
  userId: string;
  role: SubmissionActorRole;
  /**
   * Originating request's trace id (Task 24.3). Threaded through
   * the controller via `attachTraceIdToRequest` so any BullMQ
   * enqueue done from this actor's HTTP handler can carry the same
   * id forward via `withTraceJobOptions`. `null` for non-HTTP
   * call sites — the helper is then a no-op.
   */
  traceId?: string | null;
}

/**
 * Public Submission shape returned by the service. Stripped of the
 * `assignment.lesson.group.course.teacherId` chain that is only used
 * internally for authorization decisions.
 */
export type SubmissionView = Submission;

/**
 * SubmissionService — owns the Submission lifecycle and the teacher
 * grading flow (Task 18.1, Req 12.1, 12.2, 12.5, 12.6, 12.7, 12.8).
 *
 * State machine (Req 12.7):
 *
 *   DRAFT ──submit──▶ SUBMITTED ──grade──▶ GRADED ──return──▶ RETURNED ──submit──▶ SUBMITTED
 *                          │                  │
 *                          └─(AI precheck)──▶ IN_REVIEW ──grade──▶ GRADED
 *                                                  │
 *                                                  └──return──▶ RETURNED
 *
 * Authorization model:
 *   - STUDENT: must have an APPROVED Enrollment in the lesson's parent
 *     group (Req 17 / Req 6.x). Cross-student access raises 403.
 *   - TEACHER: must own `lesson.group.course.teacherId`. Cross-teacher
 *     access raises 403 NOT_OWNING_TEACHER.
 *   - ADMIN: bypasses both checks for moderation.
 *
 * Outbox emissions (Req 12.6, 16.2):
 *   - DRAFT → SUBMITTED  →  `submission.submitted` (teacher fan-out)
 *   - GRADED transition  →  `homework.graded` with idempotency key
 *     `homework.graded:{submissionId}` — the notification fan-out
 *     processor expands that into a single HOMEWORK_GRADED notification
 *     for the submission's student.
 *
 * AI grading enqueue (Req 12.3, Task 18.2):
 *   On every DRAFT/RETURNED → SUBMITTED transition, the service ALSO
 *   pushes an `AiGradingJob` onto the dedicated `ai-grading` BullMQ
 *   queue. The job snapshot carries `{ submissionId, assignmentId,
 *   studentId, modules: [{type, configJson, answer}] }` so the worker
 *   can grade against a stable view even if the assignment is edited
 *   after submission. The processor is idempotent: re-delivery for the
 *   same `submissionId` is a no-op (see `AiGradingService.precheck`).
 *   The enqueue runs AFTER the transaction commits — we don't want to
 *   leak a job for a submission whose flip rolled back.
 */
@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly submissionRepository: SubmissionRepository,
    private readonly outboxService: OutboxService,
    private readonly runtimeRegistry: HomeworkModuleRuntimeRegistry,
    @InjectQueue(QUEUE_NAMES.AI_GRADING)
    private readonly aiGradingQueue: Queue,
    @Optional() private readonly aiTextDetect?: AiTextDetectService,
    @Optional() private readonly configService?: ConfigService<EnvConfig, true>,
  ) {}

  // ==================================================================
  // Create / DRAFT lifecycle (Req 12.1, 12.8)
  // ==================================================================

  /**
   * Idempotently create a DRAFT submission for `(assignmentId, studentId)`.
   *
   * Flow:
   *   1. Resolve the assignment + ownership context. The assignment must
   *      exist and be `isPublished = true`; otherwise raise 404 / 409.
   *   2. Verify the caller has an APPROVED Enrollment in the parent
   *      group. ADMIN bypasses; TEACHER is rejected (the endpoint is
   *      student-only — teachers cannot create submissions on behalf
   *      of students).
   *   3. Re-call returns the existing DRAFT (or whatever status) row so
   *      the endpoint is safe under retries — the unique constraint
   *      `(assignmentId, studentId)` guarantees a single row.
   */
  async createDraft(
    actor: SubmissionActor,
    assignmentId: string,
    initialAnswers?: Record<string, unknown>,
  ): Promise<SubmissionView> {
    if (actor.role === 'TEACHER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Teachers cannot create submissions on behalf of students',
      });
    }

    const assignment =
      await this.submissionRepository.findAssignmentContext(assignmentId);
    if (!assignment) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${assignmentId} not found`,
      });
    }
    if (!assignment.isPublished) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_PUBLISHED',
        message:
          'Submissions are only accepted for published assignments. Wait for the teacher to publish.',
      });
    }

    // Idempotent path — return the existing row when one is present.
    const existing = await this.submissionRepository.findByAssignmentAndStudent(
      assignmentId,
      actor.userId,
    );
    if (existing) {
      this.assertStudentOwnsSubmission(actor, existing);
      this.logger.debug(
        `createDraft idempotent — returning existing submission ${existing.id} (status=${existing.status})`,
      );
      return this.stripContext(existing);
    }

    // Enrollment check (STUDENT only — ADMIN already short-circuits but
    // the endpoint is student-only so this is the only branch we expect).
    if (actor.role === 'STUDENT') {
      const enrollment = await this.submissionRepository.findApprovedEnrollment(
        assignment.groupId,
        actor.userId,
      );
      if (!enrollment) {
        throw new ForbiddenException({
          code: 'LESSON_ACCESS_DENIED',
          message:
            'You must be APPROVED in this group to create a submission. Pay and wait for teacher approval.',
        });
      }
      try {
        const created = await this.submissionRepository.createDraft({
          assignmentId,
          studentId: actor.userId,
          enrollmentId: enrollment.id,
          ...(initialAnswers !== undefined && {
            answersJson: initialAnswers as Prisma.InputJsonValue,
          }),
        });
        this.logger.log(
          `Submission ${created.id} created (DRAFT) for student ${actor.userId} on assignment ${assignmentId}`,
        );
        return this.stripContext(created);
      } catch (error) {
        // Race: a concurrent createDraft inserted the row between our
        // findByAssignmentAndStudent and createDraft. Re-fetch and return.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const refetched =
            await this.submissionRepository.findByAssignmentAndStudent(
              assignmentId,
              actor.userId,
            );
          if (refetched) return this.stripContext(refetched);
        }
        throw error;
      }
    }

    // ADMIN reaching this branch means we tried to "create" a submission
    // for a student that does not exist. We refuse — admins read submissions
    // for moderation, they don't fabricate them.
    throw new ForbiddenException({
      code: 'FORBIDDEN_ROLE',
      message: 'Admins cannot create submissions',
    });
  }

  // ==================================================================
  // Update — DRAFT autosave (Req 12.1)
  // ==================================================================

  /**
   * Replace `answersJson` on a DRAFT or RETURNED submission. Other
   * statuses (SUBMITTED, IN_REVIEW, GRADED) are read-only for the
   * student.
   *
   * Authorization: the caller must be the owning student. Teachers and
   * admins are not allowed to overwrite student answers — they go
   * through `grade` / `return` instead.
   *
   * Each module-keyed slice of `answersJson` is validated through the
   * registered runtime (Task 18.3). Modules without a runtime are
   * accepted as opaque JSON so a forward-compat module can still
   * autosave before its runtime ships.
   */
  async updateAnswers(
    actor: SubmissionActor,
    id: string,
    dto: UpdateSubmissionAnswersDto,
  ): Promise<SubmissionView> {
    const submission = await this.loadOrThrow(id);
    this.assertStudentOwnsSubmission(actor, submission);

    if (
      submission.status !== 'DRAFT' &&
      submission.status !== 'RETURNED'
    ) {
      throw new ConflictException({
        code: 'SUBMISSION_NOT_EDITABLE',
        message: `Submission ${id} is in status ${submission.status} and cannot be edited`,
      });
    }

    await this.validateAnswersJson(
      submission.assignmentId,
      dto.answersJson,
    );

    const updated = await this.submissionRepository.updateAnswers(id, {
      answersJson: dto.answersJson as Prisma.InputJsonValue,
    });
    return this.stripContext(updated);
  }

  // ==================================================================
  // Submit — DRAFT/RETURNED → SUBMITTED (Req 12.2, 12.3, 12.6)
  // ==================================================================

  /**
   * Move the submission to SUBMITTED, set `submittedAt`, and emit a
   * `submission.submitted` outbox event so the teacher receives an
   * in-app heads-up. After the transaction commits, the service also
   * enqueues an `AiGradingJob` onto the dedicated `ai-grading` BullMQ
   * queue (Req 12.3, Task 18.2). The processor is idempotent so the
   * enqueue is safe under retries.
   */
  async submit(
    actor: SubmissionActor,
    id: string,
    dto: SubmitSubmissionDto,
  ): Promise<SubmissionView> {
    const submission = await this.loadOrThrow(id);
    this.assertStudentOwnsSubmission(actor, submission);

    if (
      submission.status !== 'DRAFT' &&
      submission.status !== 'RETURNED'
    ) {
      throw new ConflictException({
        code: 'INVALID_SUBMISSION_TRANSITION',
        message: `Cannot submit a submission in status ${submission.status}`,
      });
    }

    const teacherId = submission.assignment.lesson.group.course.teacherId;
    const groupId = submission.assignment.lesson.groupId;

    // Validate the final answersJson — either the freshly supplied
    // payload or the row already on disk — through the runtime registry
    // before we flip the status. This guards against a malicious client
    // pushing 0-word writing answers straight into SUBMITTED.
    const finalAnswers =
      dto.answersJson !== undefined
        ? (dto.answersJson as Record<string, unknown>)
        : (submission.answersJson as unknown as Record<string, unknown>);
    await this.validateAnswersJson(submission.assignmentId, finalAnswers);

    // Run AI-text detection on the concatenated student text BEFORE
    // the transaction commits so we can stamp `aiFlagged` /
    // `aiLikelihood` atomically with the SUBMITTED transition.
    // Failure here is non-fatal — the gateway, BullMQ-driven precheck
    // (`AiGradingService.precheck`) will recompute the flag later, so
    // a transient AI hiccup at submit time does not block the student.
    const aiTextSignal = await this.runAiTextDetection(
      submission.studentId,
      finalAnswers,
    );

    const refreshed = await this.prisma.$transaction(async (tx) => {
      if (dto.answersJson !== undefined) {
        await this.submissionRepository.updateAnswers(
          id,
          { answersJson: dto.answersJson as Prisma.InputJsonValue },
          tx,
        );
      }

      const moved = await this.submissionRepository.transitionToSubmitted(id, tx);
      if (moved === 0) {
        throw new ConflictException({
          code: 'INVALID_SUBMISSION_TRANSITION',
          message: `Submission ${id} was already moved by a concurrent caller`,
        });
      }

      // Stamp AI-text-detection signal on the row when we got one.
      // We use updateMany guarded by the freshly-flipped SUBMITTED
      // status so a concurrent grade transition can't be overwritten.
      if (aiTextSignal) {
        await tx.submission.updateMany({
          where: { id, status: 'SUBMITTED' },
          data: {
            aiLikelihood: aiTextSignal.likelihood,
            aiFlagged: aiTextSignal.flagged,
          },
        });
      }

      await this.outboxService.create(tx, {
        topic: 'submission.submitted',
        payload: {
          submissionId: id,
          assignmentId: submission.assignmentId,
          studentId: submission.studentId,
          teacherId,
          groupId,
          lessonId: submission.assignment.lessonId,
        },
        idempotencyKey: `submission.submitted:${id}`,
      });

      const refreshedRow =
        await this.submissionRepository.findByIdWithContext(id, tx);
      if (!refreshedRow) {
        throw new NotFoundException({
          code: 'SUBMISSION_NOT_FOUND',
          message: `Submission ${id} not found after submit`,
        });
      }
      this.logger.log(
        `Submission ${id} → SUBMITTED (teacher=${teacherId} student=${submission.studentId}` +
          (aiTextSignal
            ? ` aiLikelihood=${aiTextSignal.likelihood.toFixed(3)} aiFlagged=${aiTextSignal.flagged}`
            : '') +
          ')',
      );
      return refreshedRow;
    });

    // Enqueue the AI grading precheck job AFTER the transaction commits
    // so the worker never picks up work for a rolled-back submission.
    // Best-effort: a failed enqueue logs but does not unwind the
    // submission — the OutboxDispatcher already routes
    // `submission.submitted` to AI_GRADING as a backup path (see
    // outbox.dispatcher.ts), so the worker will still be triggered
    // through the outbox if the direct enqueue fails.
    await this.enqueueAiGradingJob(refreshed, finalAnswers, actor).catch((error) => {
      this.logger.error(
        `Submission ${id}: failed to enqueue AI grading job — ${(error as Error).message}. ` +
          `Falling back to outbox-driven dispatch.`,
        (error as Error).stack,
      );
    });

    return this.stripContext(refreshed);
  }

  // ==================================================================
  // Teacher grade — SUBMITTED/IN_REVIEW → GRADED (Req 12.5, 12.6, 16.2)
  // ==================================================================

  /**
   * Apply the teacher's final grade. Validates `score ∈ [0, totalPoints]`
   * (Req 12.5), inserts any teacher-authored Feedback rows, and emits
   * `homework.graded` to the outbox. The notification fan-out worker
   * translates that into a HOMEWORK_GRADED notification for the
   * student (Req 16.2).
   *
   * All writes (status flip, score, feedback rows, outbox) commit in a
   * single transaction so the student never sees a half-graded
   * submission.
   */
  async grade(
    actor: SubmissionActor,
    id: string,
    dto: GradeSubmissionDto,
  ): Promise<SubmissionView> {
    const submission = await this.loadOrThrow(id);
    this.assertTeacherOwnsSubmission(actor, submission);

    if (
      submission.status !== 'SUBMITTED' &&
      submission.status !== 'IN_REVIEW' &&
      submission.status !== 'GRADED'
    ) {
      throw new ConflictException({
        code: 'INVALID_SUBMISSION_TRANSITION',
        message: `Cannot grade a submission in status ${submission.status}`,
      });
    }

    const totalPoints = submission.assignment.totalPoints;
    if (dto.score < 0 || dto.score > totalPoints) {
      throw new ConflictException({
        code: 'SCORE_OUT_OF_RANGE',
        message: `Score must be between 0 and ${totalPoints} (got ${dto.score})`,
        details: { score: dto.score, totalPoints },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const moved = await this.submissionRepository.transitionToGraded(
        id,
        dto.score,
        tx,
      );
      if (moved === 0) {
        throw new ConflictException({
          code: 'INVALID_SUBMISSION_TRANSITION',
          message: `Submission ${id} was already moved by a concurrent caller`,
        });
      }

      if (dto.feedback && dto.feedback.length > 0) {
        for (const entry of dto.feedback) {
          await this.submissionRepository.addFeedback(
            {
              submissionId: id,
              authorType: 'TEACHER',
              authorId: actor.userId,
              payload: this.serializeFeedbackEntry(entry),
              isFinal: true,
            },
            tx,
          );
        }
      }

      await this.outboxService.create(tx, {
        topic: 'homework.graded',
        payload: {
          submissionId: id,
          assignmentId: submission.assignmentId,
          studentId: submission.studentId,
          teacherId: actor.userId,
          score: dto.score,
          totalPoints,
        },
        idempotencyKey: `homework.graded:${id}`,
      });

      const refreshed =
        await this.submissionRepository.findByIdWithContext(id, tx);
      if (!refreshed) {
        throw new NotFoundException({
          code: 'SUBMISSION_NOT_FOUND',
          message: `Submission ${id} not found after grade`,
        });
      }
      this.logger.log(
        `Submission ${id} → GRADED score=${dto.score}/${totalPoints} by teacher ${actor.userId}`,
      );
      return this.stripContext(refreshed);
    });
  }

  // ==================================================================
  // Teacher return — IN_REVIEW/GRADED → RETURNED (Req 12.7)
  // ==================================================================

  /**
   * Bounce the submission back to RETURNED so the student can revise and
   * re-submit. Existing answers are preserved; `submittedAt` is reset.
   * Optional teacher comment is recorded as a Feedback row.
   */
  async returnToStudent(
    actor: SubmissionActor,
    id: string,
    dto: ReturnSubmissionDto,
  ): Promise<SubmissionView> {
    const submission = await this.loadOrThrow(id);
    this.assertTeacherOwnsSubmission(actor, submission);

    if (
      submission.status !== 'IN_REVIEW' &&
      submission.status !== 'GRADED'
    ) {
      throw new ConflictException({
        code: 'INVALID_SUBMISSION_TRANSITION',
        message: `Cannot return a submission in status ${submission.status}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const moved = await this.submissionRepository.transitionToReturned(id, tx);
      if (moved === 0) {
        throw new ConflictException({
          code: 'INVALID_SUBMISSION_TRANSITION',
          message: `Submission ${id} was already moved by a concurrent caller`,
        });
      }

      if (dto.comment) {
        await this.submissionRepository.addFeedback(
          {
            submissionId: id,
            authorType: 'TEACHER',
            authorId: actor.userId,
            payload: { comment: dto.comment } as Prisma.InputJsonValue,
            isFinal: false,
          },
          tx,
        );
      }

      const refreshed =
        await this.submissionRepository.findByIdWithContext(id, tx);
      if (!refreshed) {
        throw new NotFoundException({
          code: 'SUBMISSION_NOT_FOUND',
          message: `Submission ${id} not found after return`,
        });
      }
      this.logger.log(
        `Submission ${id} → RETURNED by teacher ${actor.userId}`,
      );
      return this.stripContext(refreshed);
    });
  }

  // ==================================================================
  // Reads
  // ==================================================================

  async getById(actor: SubmissionActor, id: string): Promise<SubmissionView> {
    const submission = await this.loadOrThrow(id);
    this.authorizeRead(actor, submission);
    return this.stripContext(submission);
  }

  async listForAssignment(
    actor: SubmissionActor,
    assignmentId: string,
  ): Promise<Submission[]> {
    const ctx =
      await this.submissionRepository.findAssignmentContext(assignmentId);
    if (!ctx) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: `Assignment ${assignmentId} not found`,
      });
    }
    if (actor.role === 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Students cannot list other submissions for an assignment',
      });
    }
    if (actor.role === 'TEACHER' && ctx.teacherId !== actor.userId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message:
          'You can only list submissions for assignments on your own lessons',
      });
    }
    return this.submissionRepository.listByAssignment(assignmentId);
  }

  /**
   * Resolve the caller's own submission for a given assignment.
   * Returns `null` when none exists yet (the UI uses this to decide
   * between "Start" and "Continue" CTAs).
   */
  async getMyForAssignment(
    actor: SubmissionActor,
    assignmentId: string,
  ): Promise<SubmissionView | null> {
    if (actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: '/submissions/me is student-only',
      });
    }
    const submission =
      await this.submissionRepository.findByAssignmentAndStudent(
        assignmentId,
        actor.userId,
      );
    if (!submission) return null;
    return this.stripContext(submission);
  }

  /**
   * Get count of "pending" items.
   * - For TEACHER: assignments that have at least one submission awaiting
   *   review (status SUBMITTED or IN_REVIEW) — one badge per homework that
   *   needs attention, not one per student submission.
   * - For STUDENT: assignments that haven't been submitted yet.
   */
  async getPendingCount(actor: SubmissionActor): Promise<{ count: number }> {
    if (actor.role === 'TEACHER') {
      const count = await this.prisma.assignment.count({
        where: {
          lesson: { group: { course: { teacherId: actor.userId } } },
          submissions: { some: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } } },
        },
      });
      return { count };
    }

    if (actor.role === 'STUDENT') {
      // Find assignments in groups the student is enrolled in
      const assignments = await this.prisma.assignment.findMany({
        where: {
          isPublished: true,
          lesson: {
            group: {
              enrollments: {
                some: { studentId: actor.userId, status: 'APPROVED' },
              },
            },
          },
        },
        include: {
          submissions: {
            where: { studentId: actor.userId },
          },
        },
      });

      // Count assignments without a submission or with a DRAFT/RETURNED submission
      const pendingCount = assignments.filter((a) => {
        const sub = a.submissions[0];
        return !sub || sub.status === 'DRAFT' || sub.status === 'RETURNED';
      }).length;

      return { count: pendingCount };
    }

    return { count: 0 };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Snapshot the assignment modules + matching answer slices and push
   * an `AiGradingJob` onto the `ai-grading` queue (Task 18.2).
   *
   * Why we use `jobId = "ai-precheck:{submissionId}"`: BullMQ deduplicates
   * jobs by `jobId` while the job is still in the queue, so a retry
   * triggered by a transient submit() failure does not pile up parallel
   * grading runs for the same submission. The AiGradingService is also
   * idempotent end-to-end, but BullMQ-side dedup keeps the queue clean.
   */
  private async enqueueAiGradingJob(
    submission: SubmissionWithContext,
    finalAnswers: Record<string, unknown>,
    actor?: SubmissionActor,
  ): Promise<void> {
    const modules = await this.submissionRepository.listAssignmentModules(
      submission.assignmentId,
    );

    const modulesPayload: AiGradingJob['modules'] = modules.map((m) => ({
      type: m.type,
      configJson: m.configJson,
      answer: (finalAnswers ?? {})[m.id] ?? null,
    }));

    const job: AiGradingJob = {
      submissionId: submission.id,
      assignmentId: submission.assignmentId,
      studentId: submission.studentId,
      modules: modulesPayload,
      idempotencyKey: `ai-precheck:${submission.id}`,
    };

    // Carry the originating request's trace id forward into the
    // BullMQ job options (Task 24.3). `withTraceJobOptions` is a no-op
    // when the actor has no traceId — the call site can pass `null`
    // for non-HTTP-context invocations and the merge is safe.
    const opts = withTraceJobOptions(
      { jobId: `ai-precheck:${submission.id}` },
      actor?.traceId
        ? { traceId: actor.traceId, userId: actor.userId }
        : null,
    );

    await this.aiGradingQueue.add(AI_GRADING_JOB_NAME, job, opts);
  }

  /**
   * Run the configured AI-text detector against the concatenated
   * student text. Returns `null` when the detector is not wired (older
   * tests or when the operator has disabled AI). Errors are swallowed
   * and logged — the SUBMITTED transition must succeed even when the
   * detector fails so a transient AI hiccup never blocks the student.
   *
   * Threshold:
   *   `AI_TEXT_DETECT_THRESHOLD` env var → fallback to the platform
   *   default `AI_LIKELIHOOD_FLAG_THRESHOLD` (0.7). Bounded into
   *   `[0, 1]` defensively.
   */
  private async runAiTextDetection(
    studentId: string,
    answers: Record<string, unknown>,
  ): Promise<{ likelihood: number; flagged: boolean } | null> {
    if (!this.aiTextDetect) return null;

    const text = this.concatenateText(answers);
    if (text.trim().length === 0) {
      return { likelihood: 0, flagged: false };
    }

    const threshold = this.resolveAiTextThreshold();

    try {
      const result = await this.aiTextDetect.detect({
        userId: studentId,
        text,
        threshold,
      });
      return { likelihood: result.likelihood, flagged: result.flagged };
    } catch (error) {
      this.logger.warn(
        `runAiTextDetection: detector failed for student ${studentId}: ${(error as Error).message}; ` +
          `proceeding with submit and falling back to BullMQ-driven precheck`,
      );
      return null;
    }
  }

  /**
   * Concatenate every text-bearing module slice into a single string
   * for the AI-text detector. Modules without a text payload are
   * skipped — there is nothing to classify on a multiple-choice
   * answer.
   */
  private concatenateText(answers: Record<string, unknown>): string {
    if (!answers || typeof answers !== 'object') return '';
    const parts: string[] = [];
    for (const value of Object.values(answers)) {
      if (typeof value === 'string') {
        parts.push(value);
        continue;
      }
      if (value && typeof value === 'object') {
        const text = (value as Record<string, unknown>)['text'];
        if (typeof text === 'string') parts.push(text);
        const v = (value as Record<string, unknown>)['value'];
        if (typeof v === 'string') parts.push(v);
      }
    }
    return parts.join('\n\n');
  }

  /**
   * Resolve the AI-text-detection threshold. Reads the
   * `AI_TEXT_DETECT_THRESHOLD` env var when wired, defaulting to
   * `AI_LIKELIHOOD_FLAG_THRESHOLD` (0.7). Out-of-range values fall
   * back to the default so misconfiguration is safe.
   */
  private resolveAiTextThreshold(): number {
    const fallback = AI_LIKELIHOOD_FLAG_THRESHOLD;
    const raw = this.configService?.get('AI_TEXT_DETECT_THRESHOLD', {
      infer: true,
    } as never) as number | string | undefined;
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
    return parsed;
  }

  /**
   * Validate every module-keyed slice of `answersJson` through the
   * runtime registry (Task 18.3).
   *
   * Contract: `answersJson` is `{ [moduleId]: <module-specific shape> }`.
   * For each AssignmentModule whose `id` is present in the payload, we
   * resolve the registered runtime by `module.type` and ask it to
   * validate the slice. Modules without a runtime are skipped so a new
   * module type can ship before its runtime lands.
   *
   * Slice-level validation errors (Zod or `HomeworkRuntimeError`) bubble
   * up as a 400 with a stable error code so the writing/reading UI can
   * render the violation inline (e.g. ANSWER_TOO_SHORT next to the
   * word counter).
   */
  private async validateAnswersJson(
    assignmentId: string,
    answersJson: unknown,
  ): Promise<void> {
    if (!answersJson || typeof answersJson !== 'object') return;
    const slices = answersJson as Record<string, unknown>;
    const moduleIds = Object.keys(slices);
    if (moduleIds.length === 0) return;

    const modules =
      await this.submissionRepository.listAssignmentModules(assignmentId);
    if (modules.length === 0) return;

    const byId = new Map(modules.map((m) => [m.id, m]));

    for (const moduleId of moduleIds) {
      const module = byId.get(moduleId);
      // Unknown module ids are ignored — autosave may carry stale
      // entries across an assignment edit. The teacher's authoritative
      // module list lives on the AssignmentModule rows; orphan slices
      // are simply not graded.
      if (!module) continue;

      const runtime = this.runtimeRegistry.get(module.type);
      if (!runtime) continue; // forward-compat opaque path

      try {
        const config = runtime.validateConfig(module.configJson);
        runtime.validateAnswer(config, slices[moduleId]);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new BadRequestException({
            code: 'INVALID_MODULE_ANSWER',
            message: `Module ${moduleId} (${module.type}) answer is invalid`,
            details: {
              moduleId,
              type: module.type,
              issues: error.issues,
            },
          });
        }
        if (error instanceof HomeworkRuntimeError) {
          throw new BadRequestException({
            code: error.code,
            message: error.message,
            details: {
              moduleId,
              type: module.type,
              ...(error.details ?? {}),
            },
          });
        }
        throw error;
      }
    }
  }

  private async loadOrThrow(id: string): Promise<SubmissionWithContext> {
    const submission = await this.submissionRepository.findByIdWithContext(id);
    if (!submission) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: `Submission ${id} not found`,
      });
    }
    return submission;
  }

  /**
   * Read-side authorization: STUDENT must own the submission, TEACHER
   * must own the lesson, ADMIN bypasses both.
   */
  private authorizeRead(
    actor: SubmissionActor,
    submission: SubmissionWithContext,
  ): void {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'TEACHER') {
      if (
        submission.assignment.lesson.group.course.teacherId !== actor.userId
      ) {
        throw new ForbiddenException({
          code: 'NOT_OWNING_TEACHER',
          message: 'You can only read submissions for your own lessons',
        });
      }
      return;
    }
    if (actor.role === 'STUDENT') {
      if (submission.studentId !== actor.userId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You can only read your own submission',
        });
      }
      return;
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN_ROLE',
      message: `Role ${actor.role} cannot read submissions`,
    });
  }

  private assertStudentOwnsSubmission(
    actor: SubmissionActor,
    submission: SubmissionWithContext,
  ): void {
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Only students can mutate their own submission body',
      });
    }
    if (submission.studentId !== actor.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only edit your own submission',
      });
    }
  }

  private assertTeacherOwnsSubmission(
    actor: SubmissionActor,
    submission: SubmissionWithContext,
  ): void {
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'TEACHER') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Only teachers can grade or return a submission',
      });
    }
    if (submission.assignment.lesson.group.course.teacherId !== actor.userId) {
      throw new ForbiddenException({
        code: 'NOT_OWNING_TEACHER',
        message: 'You can only grade submissions on your own lessons',
      });
    }
  }

  /**
   * Drop the `assignment.lesson.group...` join from the row before
   * returning it to the controller — that join is a private
   * authorization artifact and should not leak through the HTTP
   * response.
   */
  private stripContext(submission: SubmissionWithContext): SubmissionView {
    const { assignment: _assignment, ...plain } = submission as any;
    return plain as SubmissionView;
  }

  private serializeFeedbackEntry(
    entry: FeedbackEntryDto,
  ): Prisma.InputJsonValue {
    return {
      ...(entry.moduleId !== undefined && { moduleId: entry.moduleId }),
      ...(entry.comment !== undefined && { comment: entry.comment }),
      ...(entry.payload !== undefined && {
        payload: entry.payload as Prisma.InputJsonValue,
      }),
    } as Prisma.InputJsonValue;
  }

  /** Exposed for tests — readable status enum for assertions. */
  static readonly STATUSES: SubmissionStatus[] = [
    'DRAFT',
    'SUBMITTED',
    'IN_REVIEW',
    'GRADED',
    'RETURNED',
  ];
}
