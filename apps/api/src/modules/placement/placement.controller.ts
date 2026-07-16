import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { SubmitAnswerDto, SubmitAnswerSchema } from './dto/submit-answer.dto';
import {
  PlacementAssessmentView,
  PlacementResultView,
  PlacementService,
} from './placement.service';

/**
 * PlacementController — placement assessment endpoints (Req 5.1, 5.4).
 *
 * Route layout (all scoped to the authenticated STUDENT/learner):
 *   - POST /placement/start        → start or resume an assessment
 *   - POST /placement/:id/answer   → persist one answer incrementally (resumable)
 *   - GET  /placement/:id          → resume (questions + saved answers)
 *   - POST /placement/:id/submit   → submit + score → compute CEFR (Task 3.2)
 */
@Controller('placement')
export class PlacementController {
  constructor(private readonly placementService: PlacementService) {}

  /**
   * POST /placement/start — Start a placement assessment for the calling
   * learner, returning the READING/GRAMMAR/VOCABULARY question sequence. If an
   * IN_PROGRESS assessment already exists it is resumed instead (Req 5.1, 5.4).
   */
  @Roles('STUDENT')
  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentUser() user: JwtPayload,
  ): Promise<PlacementAssessmentView> {
    return this.placementService.start(user.sub);
  }

  /**
   * POST /placement/:id/answer — Persist a single answer. Idempotent on
   * questionRef so the learner can revise answers and resume later (Req 5.4).
   */
  @Roles('STUDENT')
  @Post(':id/answer')
  @HttpCode(HttpStatus.OK)
  async saveAnswer(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assessmentId: string,
    @Body(new ZodValidationPipe(SubmitAnswerSchema)) dto: SubmitAnswerDto,
  ): Promise<PlacementAssessmentView> {
    return this.placementService.saveAnswer(user.sub, assessmentId, dto);
  }

  /**
   * GET /placement/:id — Resume an assessment: returns the question sequence
   * and any answers already saved (Req 5.4). Enforces learner ownership.
   */
  @Roles('STUDENT')
  @Get(':id')
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assessmentId: string,
  ): Promise<PlacementAssessmentView> {
    return this.placementService.getById(user.sub, assessmentId);
  }

  /**
   * POST /placement/:id/submit — Submit + score the assessment (Task 3.2).
   *
   * When every question has been answered, scores the responses → an overall
   * CEFR level, sets the learner's proficiency via the leveling service, and
   * emits a placement-result notification (Req 5.2, 5.3, 5.5, 15.1).
   *
   * Idempotent (Req 5.2): re-submitting an already-completed assessment
   * returns the stored result without re-writing proficiency or re-notifying,
   * so a `200 OK` (not `201`) is returned for both first submit and replay.
   */
  @Roles('STUDENT')
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assessmentId: string,
  ): Promise<PlacementResultView> {
    return this.placementService.submit(user.sub, assessmentId);
  }
}
