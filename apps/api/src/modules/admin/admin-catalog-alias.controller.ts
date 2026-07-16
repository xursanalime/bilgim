import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { HomeworkModuleType } from '@prisma/client';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GLOBAL_ENGLISH_MODULE_CATALOG } from '../catalog/english-module-catalog';
import { JwtPayload } from '../auth/tokens.service';
import {
  CreateExamTrackDto,
  LanguageModuleTypeSchema,
  SetModuleCatalogEnabledSchema,
  type SetModuleCatalogEnabledDto,
} from './dto';
import { AdminEnglishCatalogService } from './english-catalog.service';

/**
 * Web-client request bodies for exam-track create/update use Uzbek/English
 * name fields (`nameUz` / `nameEn`) while the persisted `ExamTrack` model has
 * a single `name`. These schemas accept either shape and the controller
 * collapses them to `name` (preferring `nameUz`) before delegating to the
 * service.
 */
const CreateExamTrackAliasSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
        message: 'slug must be kebab-case (lowercase, digits, single hyphens)',
      }),
    name: z.string().trim().min(1).max(120).optional(),
    nameUz: z.string().trim().min(1).max(120).optional(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.name || v.nameUz || v.nameEn), {
    message: 'One of name, nameUz or nameEn is required',
  });
type CreateExamTrackAliasDto = z.infer<typeof CreateExamTrackAliasSchema>;

const UpdateExamTrackAliasSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    nameUz: z.string().trim().min(1).max(120).optional(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.nameUz !== undefined ||
      v.nameEn !== undefined ||
      v.isActive !== undefined,
    { message: 'At least one field must be provided' },
  );
type UpdateExamTrackAliasDto = z.infer<typeof UpdateExamTrackAliasSchema>;

/**
 * AdminCatalogAliasController — compatibility routes that match the web
 * admin client's expected paths/shapes.
 *
 * The canonical English-config endpoints live under `/admin/english/*`
 * (see {@link AdminEnglishCatalogController}). The web console, however,
 * calls the flatter `/admin/english-modules` and `/admin/exam-tracks`
 * paths and expects slightly different field names (`nameUz`/`nameEn`,
 * `defaultEnabled`). This controller bridges the two by reusing
 * `AdminEnglishCatalogService` and reshaping the payloads — no business
 * logic is duplicated. It also exposes a small CMS-pages stub the web
 * console queries (degrades to an empty list until a real CMS lands).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class AdminCatalogAliasController {
  /** moduleType → platform-wide default enabled state (fixed catalog). */
  private static readonly DEFAULT_ENABLED: ReadonlyMap<string, boolean> =
    new Map(
      GLOBAL_ENGLISH_MODULE_CATALOG.map((c) => [c.moduleType, c.defaultEnabled]),
    );

  constructor(
    private readonly englishCatalogService: AdminEnglishCatalogService,
  ) {}

  // ==================================================================
  // English module catalog (web: /admin/english-modules)
  // ==================================================================

  /** GET /admin/english-modules — eight skills + default/current enabled. */
  @Get('english-modules')
  @HttpCode(HttpStatus.OK)
  async listEnglishModules() {
    const catalog = await this.englishCatalogService.listModuleCatalog();
    return catalog.map((entry) => ({
      moduleType: entry.moduleType,
      defaultEnabled:
        AdminCatalogAliasController.DEFAULT_ENABLED.get(entry.moduleType) ??
        true,
      enabled: entry.enabled,
    }));
  }

  /** PATCH /admin/english-modules/:moduleType — toggle platform-wide. */
  @Patch('english-modules/:moduleType')
  @HttpCode(HttpStatus.OK)
  async setEnglishModuleEnabled(
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
    const result = await this.englishCatalogService.setModuleEnabled(
      user.sub,
      parsed.data as HomeworkModuleType,
      dto.enabled,
      { ip },
    );
    return {
      moduleType: result.moduleType,
      defaultEnabled:
        AdminCatalogAliasController.DEFAULT_ENABLED.get(result.moduleType) ??
        true,
      enabled: result.enabled,
    };
  }

  // ==================================================================
  // Exam_Track options (web: /admin/exam-tracks)
  // ==================================================================

  /** GET /admin/exam-tracks — list with instructor counts. */
  @Get('exam-tracks')
  @HttpCode(HttpStatus.OK)
  async listExamTracks() {
    const tracks =
      await this.englishCatalogService.listExamTracksWithCounts();
    return tracks.map((t) => ({
      id: t.id,
      slug: t.slug,
      nameUz: t.name,
      nameEn: t.name,
      isActive: t.isActive,
      instructorCount: t.instructorCount,
    }));
  }

  /** POST /admin/exam-tracks — create an Exam_Track option. */
  @Post('exam-tracks')
  @HttpCode(HttpStatus.CREATED)
  async createExamTrack(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateExamTrackAliasSchema))
    dto: CreateExamTrackAliasDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    const name = (dto.nameUz ?? dto.nameEn ?? dto.name) as string;
    const serviceDto: CreateExamTrackDto = {
      slug: dto.slug,
      name,
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };
    const created = await this.englishCatalogService.createExamTrack(
      user.sub,
      serviceDto,
      { ip },
    );
    return {
      id: created.id,
      slug: created.slug,
      nameUz: created.name,
      nameEn: created.name,
      isActive: created.isActive,
      instructorCount: 0,
    };
  }

  /** PATCH /admin/exam-tracks/:id — rename / (de)activate. */
  @Patch('exam-tracks/:id')
  @HttpCode(HttpStatus.OK)
  async updateExamTrack(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateExamTrackAliasSchema))
    dto: UpdateExamTrackAliasDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    const name = dto.nameUz ?? dto.nameEn ?? dto.name;
    const updated = await this.englishCatalogService.updateExamTrack(
      user.sub,
      id,
      {
        ...(name !== undefined && { name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      { ip },
    );
    return {
      id: updated.id,
      slug: updated.slug,
      nameUz: updated.name,
      nameEn: updated.name,
      isActive: updated.isActive,
    };
  }

  /** DELETE /admin/exam-tracks/:id — permanently remove the track. */
  @Delete('exam-tracks/:id')
  @HttpCode(HttpStatus.OK)
  async deleteExamTrack(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.englishCatalogService.deleteExamTrack(user.sub, id, { ip });
  }

  // ==================================================================
  // CMS pages (web: /admin/cms/pages) — stub until a real CMS lands
  // ==================================================================

  /** GET /admin/cms/pages — empty list stub (no CMS backend yet). */
  @Get('cms/pages')
  @HttpCode(HttpStatus.OK)
  async listCmsPages() {
    return [];
  }

  /** DELETE /admin/cms/pages/:id — stub no-op. */
  @Delete('cms/pages/:id')
  @HttpCode(HttpStatus.OK)
  async deleteCmsPage(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return { ok: true };
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
