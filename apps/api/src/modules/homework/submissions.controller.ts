import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  CreateSubmissionDto,
  CreateSubmissionSchema,
  GetMySubmissionQueryDto,
  GetMySubmissionQuerySchema,
  GradeSubmissionDto,
  GradeSubmissionSchema,
  ReturnSubmissionDto,
  ReturnSubmissionSchema,
  SubmitSubmissionDto,
  SubmitSubmissionSchema,
  UpdateSubmissionAnswersDto,
  UpdateSubmissionAnswersSchema,
} from './dto';
import { SubmissionActor, SubmissionService } from './submission.service';

/**
 * SubmissionsController — REST endpoints for the Submission lifecycle
 * (Task 18.1, Req 12.1, 12.2, 12.5, 12.6, 12.7).
 *
 * Routes (mounted under the global `api/v1` prefix):
 *
 *   STUDENT
 *     POST   /assignments/:assignmentId/submissions     create / get DRAFT (idempotent)
 *     GET    /submissions/me?assignmentId=...           own submission for an assignment
 *     PATCH  /submissions/:id                           autosave answers (DRAFT or RETURNED)
 *     POST   /submissions/:id/submit                    DRAFT/RETURNED → SUBMITTED
 *
 *   TEACHER (owning lesson) / ADMIN
 *     GET    /assignments/:assignmentId/submissions     list every submission for the assignment
 *     GET    /submissions/:id                           single submission (also for owning student)
 *     POST   /submissions/:id/grade                     SUBMITTED/IN_REVIEW → GRADED + Feedback
 *     POST   /submissions/:id/return                    IN_REVIEW/GRADED → RETURNED
 *
 * Authorization is enforced inside the service layer, not on the route
 * itself, because each endpoint mixes role rules (student-or-teacher
 * read, teacher-only mutation) and ownership rules (matching student id
 * vs matching teacher id) that don't map cleanly onto a single
 * `@Roles()` decorator. The controller still tags each handler with the
 * minimal allowed role set so the production-side
 * `auth-completeness.production.spec.ts` invariant passes.
 */
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionService: SubmissionService) {}

  // ==================================================================
  // STUDENT — DRAFT lifecycle
  // ==================================================================

  /**
   * `POST /assignments/:assignmentId/submissions` — student creates a
   * DRAFT submission. Re-calling for the same `(assignmentId, studentId)`
   * pair returns the existing row (idempotent), regardless of status.
   * Empty body is accepted; clients may pass an initial `answersJson`
   * for parity with the autosave UX.
   */
  @Roles('STUDENT', 'ADMIN')
  @Post('assignments/:assignmentId/submissions')
  @HttpCode(HttpStatus.CREATED)
  async createDraft(
    @CurrentUser() user: JwtPayload,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body(new ZodValidationPipe(CreateSubmissionSchema))
    dto: CreateSubmissionDto,
  ) {
    return this.submissionService.createDraft(
      this.toActor(user),
      assignmentId,
      dto.answersJson,
    );
  }

  /**
   * `GET /submissions/me?assignmentId=...` — student looks up their own
   * submission for a given assignment. Returns `null` when none exists.
   */
  @Roles('STUDENT')
  @Get('submissions/me')
  async getMyForAssignment(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(GetMySubmissionQuerySchema))
    query: GetMySubmissionQueryDto,
  ) {
    return this.submissionService.getMyForAssignment(
      this.toActor(user),
      query.assignmentId,
    );
  }

  /**
   * `PATCH /submissions/:id` — student autosaves answers. Allowed only
   * in DRAFT or RETURNED status; service raises 409 otherwise.
   */
  @Roles('STUDENT', 'ADMIN')
  @Patch('submissions/:id')
  async updateAnswers(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateSubmissionAnswersSchema))
    dto: UpdateSubmissionAnswersDto,
  ) {
    return this.submissionService.updateAnswers(this.toActor(user), id, dto);
  }

  /**
   * `POST /submissions/:id/submit` — DRAFT/RETURNED → SUBMITTED. Sets
   * `submittedAt`, blocks further student edits, and emits a
   * `submission.submitted` outbox event for the teacher fan-out (delivery
   * worker is wired in a follow-up task).
   */
  @Roles('STUDENT', 'ADMIN')
  @Post('submissions/:id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SubmitSubmissionSchema))
    dto: SubmitSubmissionDto,
    @Req() req: { traceId?: string | null },
  ) {
    return this.submissionService.submit(this.toActor(user, req), id, dto);
  }

  // ==================================================================
  // TEACHER — review / grading
  // ==================================================================

  /**
   * `GET /assignments/:assignmentId/submissions` — teacher lists every
   * submission for an assignment they own. ADMIN bypasses for moderation.
   */
  @Roles('TEACHER', 'ADMIN')
  @Get('assignments/:assignmentId/submissions')
  async listForAssignment(
    @CurrentUser() user: JwtPayload,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
  ) {
    return this.submissionService.listForAssignment(
      this.toActor(user),
      assignmentId,
    );
  }

  /**
   * `GET /submissions/:id` — teacher (owning the lesson), the owning
   * student, or any ADMIN may read a submission.
   */
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('submissions/:id')
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.submissionService.getById(this.toActor(user), id);
  }

  /**
   * `POST /submissions/:id/grade` — SUBMITTED/IN_REVIEW → GRADED, with
   * `score` (validated against `assignment.totalPoints`) and optional
   * `Feedback` rows. Emits `homework.graded` to the outbox with
   * idempotency key `homework.graded:{submissionId}` so the notification
   * fan-out worker creates exactly one HOMEWORK_GRADED for the student.
   */
  @Roles('TEACHER', 'ADMIN')
  @Post('submissions/:id/grade')
  @HttpCode(HttpStatus.OK)
  async grade(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(GradeSubmissionSchema))
    dto: GradeSubmissionDto,
  ) {
    return this.submissionService.grade(this.toActor(user), id, dto);
  }

  /**
   * `POST /submissions/:id/return` — IN_REVIEW/GRADED → RETURNED. Resets
   * `submittedAt`, keeps existing answers, lets the student revise and
   * re-submit. Optional `comment` is stored as Feedback.
   */
  @Roles('TEACHER', 'ADMIN')
  @Post('submissions/:id/return')
  @HttpCode(HttpStatus.OK)
  async returnToStudent(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ReturnSubmissionSchema))
    dto: ReturnSubmissionDto,
  ) {
    return this.submissionService.returnToStudent(
      this.toActor(user),
      id,
      dto,
    );
  }

  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('homework/pending-count')
  async getPendingCount(@CurrentUser() user: JwtPayload) {
    return this.submissionService.getPendingCount(this.toActor(user));
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private toActor(
    user: JwtPayload,
    req?: { traceId?: string | null },
  ): SubmissionActor {
    return {
      userId: user.sub,
      role: user.role as SubmissionActor['role'],
      // Trace id is stamped onto the request by `LoggingInterceptor`
      // (`attachTraceIdToRequest`); when this is called outside an
      // HTTP context the field is just absent and the BullMQ trace
      // helper short-circuits.
      traceId: req?.traceId ?? null,
    };
  }
}
