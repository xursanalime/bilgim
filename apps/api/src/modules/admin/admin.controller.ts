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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { AdminService } from './admin.service';
import {
  BulkUpsertSpecialtyModulesAdminDto,
  BulkUpsertSpecialtyModulesAdminSchema,
  CreatePlanDto,
  CreatePlanSchema,
  CreateSpecialtyDto,
  CreateSpecialtySchema,
  ListAuditLogsQueryDto,
  ListAuditLogsQuerySchema,
  ListUsersQueryDto,
  ListUsersQuerySchema,
  UpdatePlanDto,
  UpdatePlanSchema,
  UpdateSpecialtyDto,
  UpdateSpecialtySchema,
  UpdateUserStatusDto,
  UpdateUserStatusSchema,
  UpdateSystemSettingDto,
  UpdateSystemSettingDtoSchema,
  CreateAiPromptTemplateDto,
  CreateAiPromptTemplateDtoSchema,
  UpdateAiPromptTemplateDto,
  UpdateAiPromptTemplateDtoSchema,
  CreateOnboardingQuestionDto,
  CreateOnboardingQuestionDtoSchema,
  UpdateOnboardingQuestionDto,
  UpdateOnboardingQuestionDtoSchema,
} from './dto';

/**
 * AdminController — REST endpoints for the admin moderation and catalog
 * management surfaces (Req 24.1 – 24.5, 21.9).
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by `JwtAuthGuard`.
 * The global guards in `AppModule` enforce JWT + RBAC; the explicit
 * `@UseGuards(JwtAuthGuard)` annotation here makes the requirement
 * self-documenting on the controller (and satisfies the auth-completeness
 * scanner without relying solely on the global wiring).
 *
 * Idempotency: the global `IdempotencyInterceptor` already caches POST /
 * PUT / PATCH / DELETE responses by `Idempotency-Key`. Mutation routes
 * additionally require the header — the assertion is implemented in
 * `requireIdempotencyKey()` so misuse fails with a clean 400 instead of
 * silently degrading into a non-idempotent call.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ==================================================================
  // Users (Req 24.4)
  // ==================================================================

  /** GET /admin/users — paginated, filterable user list. */
  @Get('users')
  @HttpCode(HttpStatus.OK)
  async listUsers(
    @Query(new ZodValidationPipe(ListUsersQuerySchema))
    query: ListUsersQueryDto,
  ) {
    return this.adminService.listUsers(query);
  }

  /**
   * PATCH /admin/users/:id/status — change user status (Req 24.4).
   *
   * Requires `Idempotency-Key` so the same suspend/unsuspend command from
   * a flaky admin client cannot accidentally produce two audit-log
   * entries.
   */
  @Patch('users/:id/status')
  @HttpCode(HttpStatus.OK)
  async updateUserStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateUserStatusSchema))
    dto: UpdateUserStatusDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updateUserStatus(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // Specialties (Req 24.1)
  // ==================================================================

  /** GET /admin/specialties — full admin view, includes inactive rows. */
  @Get('specialties')
  @HttpCode(HttpStatus.OK)
  async listSpecialties(
    @Query('withCounts') withCounts?: string,
  ) {
    if (withCounts === 'true' || withCounts === '1') {
      return this.adminService.listSpecialtiesWithCounts();
    }
    return this.adminService.listSpecialties();
  }

  /** POST /admin/specialties — create a specialty. */
  @Post('specialties')
  @HttpCode(HttpStatus.CREATED)
  async createSpecialty(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateSpecialtySchema))
    dto: CreateSpecialtyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.createSpecialty(user.sub, dto, { ip });
  }

  /** PATCH /admin/specialties/:id — partial update. */
  @Patch('specialties/:id')
  @HttpCode(HttpStatus.OK)
  async updateSpecialty(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateSpecialtySchema))
    dto: UpdateSpecialtyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updateSpecialty(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // SpecialtyModule (Req 24.2, 24.3)
  // ==================================================================

  /**
   * GET /admin/specialties/:id/modules — full mapping (active + inactive).
   *
   * Mirrors the view that powers the cap-enforced bulk-upsert below so
   * admins see exactly the rows they will touch.
   */
  @Get('specialties/:id/modules')
  @HttpCode(HttpStatus.OK)
  async listSpecialtyModules(
    @Param('id', new ParseUUIDPipe()) specialtyId: string,
  ) {
    return this.adminService.listSpecialtyModules(specialtyId);
  }

  /**
   * PUT /admin/specialties/:id/modules — bulk upsert.
   *
   * The per-Specialty active cap of 10 is enforced by HomeworkService
   * (service-layer guard + DB trigger) — this controller only forwards
   * the call and lets the audit-log entry land on success.
   */
  @Put('specialties/:id/modules')
  @HttpCode(HttpStatus.OK)
  async bulkUpsertSpecialtyModules(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) specialtyId: string,
    @Body(new ZodValidationPipe(BulkUpsertSpecialtyModulesAdminSchema))
    dto: BulkUpsertSpecialtyModulesAdminDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.bulkUpsertSpecialtyModules(
      user.sub,
      specialtyId,
      dto,
      { ip },
    );
  }

  // ==================================================================
  // Audit logs (Req 24.5, 21.9)
  // ==================================================================

  /** GET /admin/audit-logs — paginated audit log read with filters. */
  @Get('audit-logs')
  @HttpCode(HttpStatus.OK)
  async listAuditLogs(
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema))
    query: ListAuditLogsQueryDto,
  ) {
    return this.adminService.listAuditLogs(query);
  }

  // ==================================================================
  // Plans (Req 24.x — billing plan administration)
  // ==================================================================

  /** GET /admin/invoices — recent invoices for admin dashboard. */
  @Get('invoices')
  @HttpCode(HttpStatus.OK)
  async listRecentInvoices(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.listRecentInvoices({
      limit: limit ? parseInt(limit, 10) : 10,
      ...(status ? { status } : {}),
    });
  }

  /** GET /admin/plans — full list of plans (active + inactive). */
  @Get('plans')
  @HttpCode(HttpStatus.OK)
  async listPlans() {
    return this.adminService.listPlans();
  }

  /** POST /admin/plans — create a billing plan. */
  @Post('plans')
  @HttpCode(HttpStatus.CREATED)
  async createPlan(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreatePlanSchema)) dto: CreatePlanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.createPlan(user.sub, dto, { ip });
  }

  /** PATCH /admin/plans/:id — sparse update. */
  @Patch('plans/:id')
  @HttpCode(HttpStatus.OK)
  async updatePlan(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdatePlanSchema)) dto: UpdatePlanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updatePlan(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // System Settings
  // ==================================================================

  @Get('system-settings')
  @HttpCode(HttpStatus.OK)
  async listSystemSettings() {
    return this.adminService.listSystemSettings();
  }

  @Put('system-settings/:key')
  @HttpCode(HttpStatus.OK)
  async updateSystemSetting(
    @CurrentUser() user: JwtPayload,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateSystemSettingDtoSchema))
    dto: UpdateSystemSettingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updateSystemSetting(user.sub, key, dto, { ip });
  }

  // ==================================================================
  // AI Prompt Templates
  // ==================================================================

  @Get('ai-prompts')
  @HttpCode(HttpStatus.OK)
  async listAiPromptTemplates() {
    return this.adminService.listAiPromptTemplates();
  }

  @Post('ai-prompts')
  @HttpCode(HttpStatus.CREATED)
  async createAiPromptTemplate(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateAiPromptTemplateDtoSchema))
    dto: CreateAiPromptTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.createAiPromptTemplate(user.sub, dto, { ip });
  }

  @Patch('ai-prompts/:id')
  @HttpCode(HttpStatus.OK)
  async updateAiPromptTemplate(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateAiPromptTemplateDtoSchema))
    dto: UpdateAiPromptTemplateDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updateAiPromptTemplate(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // Onboarding Questions
  // ==================================================================

  @Get('onboarding-questions')
  @HttpCode(HttpStatus.OK)
  async listOnboardingQuestions() {
    return this.adminService.listOnboardingQuestions();
  }

  @Post('onboarding-questions')
  @HttpCode(HttpStatus.CREATED)
  async createOnboardingQuestion(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateOnboardingQuestionDtoSchema))
    dto: CreateOnboardingQuestionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.createOnboardingQuestion(user.sub, dto, { ip });
  }

  @Patch('onboarding-questions/:id')
  @HttpCode(HttpStatus.OK)
  async updateOnboardingQuestion(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateOnboardingQuestionDtoSchema))
    dto: UpdateOnboardingQuestionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminService.updateOnboardingQuestion(user.sub, id, dto, { ip });
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Reject mutations missing an `Idempotency-Key`. The global
   * `IdempotencyInterceptor` already validates the key format and caches
   * the response — this guard makes the header *required* on admin
   * writes so a misconfigured client cannot accidentally double-fire a
   * suspension or a price change.
   */
  private requireIdempotencyKey(key: string | undefined): void {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for admin mutations',
      });
    }
  }
}
