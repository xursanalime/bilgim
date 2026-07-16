import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HomeworkModuleType } from '@prisma/client';
import { JwtPayload } from '../auth/tokens.service';
import {
  CreateExamTrackDto,
  CreateExamTrackSchema,
  LanguageModuleTypeSchema,
  SetModuleCatalogEnabledDto,
  SetModuleCatalogEnabledSchema,
  UpdateExamTrackDto,
  UpdateExamTrackSchema,
} from './dto';
import { AdminEnglishCatalogService } from './english-catalog.service';

/**
 * AdminEnglishCatalogController — admin English-config management
 * (English-Only Platform Refocus, Req 17.1 – 17.4).
 *
 * Surfaces the Exam_Track CRUD and the global 8-skill catalog
 * enable/disable controls that replace the retired Specialty catalog
 * screens.
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by
 * `JwtAuthGuard`, mirroring `AdminController` / `AdminOpsController`.
 * Mutations require an `Idempotency-Key` header so a flaky admin client
 * cannot double-fire a config change.
 */
@Controller('admin/english')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class AdminEnglishCatalogController {
  constructor(
    private readonly englishCatalogService: AdminEnglishCatalogService,
  ) {}

  // ==================================================================
  // Exam_Track options (Req 17.1)
  // ==================================================================

  /** GET /admin/english/exam-tracks — full list (active + inactive). */
  @Get('exam-tracks')
  @HttpCode(HttpStatus.OK)
  async listExamTracks() {
    return this.englishCatalogService.listExamTracks();
  }

  /** POST /admin/english/exam-tracks — create an Exam_Track option. */
  @Post('exam-tracks')
  @HttpCode(HttpStatus.CREATED)
  async createExamTrack(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateExamTrackSchema))
    dto: CreateExamTrackDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.englishCatalogService.createExamTrack(user.sub, dto, { ip });
  }

  /**
   * PATCH /admin/english/exam-tracks/:id — rename and/or
   * activate/deactivate an Exam_Track option.
   */
  @Patch('exam-tracks/:id')
  @HttpCode(HttpStatus.OK)
  async updateExamTrack(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateExamTrackSchema))
    dto: UpdateExamTrackDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.englishCatalogService.updateExamTrack(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // Global 8-skill catalog enable/disable (Req 17.2, 17.3)
  // ==================================================================

  /**
   * GET /admin/english/module-catalog — the eight global English skills
   * with their platform-wide enabled state.
   */
  @Get('module-catalog')
  @HttpCode(HttpStatus.OK)
  async listModuleCatalog() {
    return this.englishCatalogService.listModuleCatalog();
  }

  /**
   * PATCH /admin/english/module-catalog/:moduleType — enable/disable a
   * single global skill platform-wide. Disabling preserves existing
   * Submissions (Req 17.3); it only affects new assignment availability.
   *
   * `:moduleType` is validated against the eight-skill Zod enum so a
   * Legacy_Module_Type request fails closed with a clean 400.
   */
  @Patch('module-catalog/:moduleType')
  @HttpCode(HttpStatus.OK)
  async setModuleEnabled(
    @CurrentUser() user: JwtPayload,
    @Param('moduleType') moduleType: string,
    @Body(new ZodValidationPipe(SetModuleCatalogEnabledSchema))
    dto: SetModuleCatalogEnabledDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    const parsed = LanguageModuleTypeSchema.safeParse(moduleType);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'MODULE_TYPE_NOT_SUPPORTED',
        message: `"${moduleType}" is not one of the eight English skills`,
      });
    }
    return this.englishCatalogService.setModuleEnabled(
      user.sub,
      parsed.data as HomeworkModuleType,
      dto.enabled,
      { ip },
    );
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private requireIdempotencyKey(key: string | undefined): void {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for admin mutations',
      });
    }
  }
}
