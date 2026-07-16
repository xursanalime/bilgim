import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { SetProficiencyDto, SetProficiencySchema } from './dto';
import { LevelingService } from './leveling.service';

/**
 * ProficiencyController — learner English-proficiency profile (Req 4.1 – 4.5).
 *
 * Mounted at `/leveling/learners/:id/proficiency`, distinct from the
 * catalog-scoped `LevelingController`. Authorization is role- + relationship-
 * based and enforced in the service:
 *   - GET  proficiency / history → STUDENT (own), TEACHER (learners they
 *     teach), ADMIN (any). Class-level `@Roles` admits the three roles; the
 *     service narrows to the specific record.
 *   - PATCH proficiency → TEACHER only, and only for learners they teach.
 */
@Controller('leveling/learners/:id/proficiency')
@Roles('STUDENT', 'TEACHER', 'ADMIN')
export class ProficiencyController {
  constructor(private readonly levelingService: LevelingService) {}

  /**
   * GET /leveling/learners/:id/proficiency — current CEFR level (or
   * UNASSESSED) for a learner (Req 4.1, 4.2).
   */
  @Get()
  async getProficiency(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.levelingService.getProficiency(
      { sub: user.sub, role: user.role },
      id,
    );
  }

  /**
   * GET /leveling/learners/:id/proficiency/history — append-only level change
   * history, newest first (Req 4.4).
   */
  @Get('history')
  async getProficiencyHistory(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.levelingService.getProficiencyHistory(
      { sub: user.sub, role: user.role },
      id,
    );
  }

  /**
   * PATCH /leveling/learners/:id/proficiency — an Instructor records a level
   * change for an enrolled learner (Req 4.4). Updates the current level and
   * appends a history row (`source = 'instructor'`).
   */
  @Patch()
  @Roles('TEACHER')
  @HttpCode(HttpStatus.OK)
  async setProficiency(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetProficiencySchema)) dto: SetProficiencyDto,
  ) {
    return this.levelingService.setProficiencyByInstructor(
      user.sub,
      id,
      dto.cefrLevel,
    );
  }
}
