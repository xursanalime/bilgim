import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  GradeSpeakingSubmissionDto,
  GradeSpeakingSubmissionSchema,
  OverrideSpeakingScoreDto,
  OverrideSpeakingScoreSchema,
  SubmitSpeakingAudioDto,
  SubmitSpeakingAudioSchema,
} from './dto';
import {
  SpeakingScoringActor,
  SpeakingScoringService,
} from './speaking-scoring.service';
import { SpeakingActor, SpeakingService } from './speaking.service';

/**
 * SpeakingController — audio submission + AI-score override endpoints for
 * the Speaking_Assessment_Module (Task 4.1 + 4.2, Req 7.1, 7.2, 7.6, 7.7).
 *
 * Routes (mounted under the global `api/v1` prefix):
 *
 *   STUDENT
 *     POST /assignments/:assignmentId/modules/:moduleId/speaking-audio
 *       Register an audio recording for a SPEAKING/PRONUNCIATION module.
 *       Returns the created AUDIO MediaAsset id plus signed multipart
 *       upload handles (reused from the Media_Module) the client uses to
 *       PUT the recording to storage.
 *
 *   TEACHER / ADMIN
 *     PATCH /submissions/:submissionId/speaking-score
 *       Override the AI_DRAFT score + feedback before the submission
 *       reaches GRADED (Req 7.6).
 *     POST /submissions/:submissionId/speaking-grade
 *       Apply the final grade → GRADED and notify the learner via the
 *       reused homework-graded notification path (Task 4.3, Req 15.3).
 *
 * Authorization is enforced in the service layer (enrolled-learner /
 * owning-instructor + module-type checks) on top of the `@Roles(...)`
 * route guard.
 */
@Controller()
export class SpeakingController {
  constructor(
    private readonly speakingService: SpeakingService,
    private readonly scoringService: SpeakingScoringService,
  ) {}

  @Roles('STUDENT')
  @Post('assignments/:assignmentId/modules/:moduleId/speaking-audio')
  @HttpCode(HttpStatus.CREATED)
  async submitAudio(
    @CurrentUser() user: JwtPayload,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @Body(new ZodValidationPipe(SubmitSpeakingAudioSchema))
    dto: SubmitSpeakingAudioDto,
  ) {
    return this.speakingService.submitAudio(
      this.toActor(user),
      assignmentId,
      moduleId,
      dto,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Patch('submissions/:submissionId/speaking-score')
  @HttpCode(HttpStatus.OK)
  async overrideScore(
    @CurrentUser() user: JwtPayload,
    @Param('submissionId', new ParseUUIDPipe()) submissionId: string,
    @Body(new ZodValidationPipe(OverrideSpeakingScoreSchema))
    dto: OverrideSpeakingScoreDto,
  ) {
    return this.scoringService.overrideScore(
      this.toScoringActor(user),
      submissionId,
      dto,
    );
  }

  @Roles('TEACHER', 'ADMIN')
  @Post('submissions/:submissionId/speaking-grade')
  @HttpCode(HttpStatus.OK)
  async finalizeGrade(
    @CurrentUser() user: JwtPayload,
    @Param('submissionId', new ParseUUIDPipe()) submissionId: string,
    @Body(new ZodValidationPipe(GradeSpeakingSubmissionSchema))
    dto: GradeSpeakingSubmissionDto,
  ) {
    return this.scoringService.finalizeGrade(
      this.toScoringActor(user),
      submissionId,
      dto,
    );
  }

  private toActor(user: JwtPayload): SpeakingActor {
    return {
      userId: user.sub,
      role: user.role as SpeakingActor['role'],
    };
  }

  private toScoringActor(user: JwtPayload): SpeakingScoringActor {
    return {
      userId: user.sub,
      role: user.role as SpeakingScoringActor['role'],
    };
  }
}
