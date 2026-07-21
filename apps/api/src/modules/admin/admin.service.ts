import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAuditLog,
  AiPromptTemplate,
  OnboardingQuestion,
  Plan,
  Prisma,
  PrismaClient,
  Specialty,
  SpecialtyModule,
  SystemSetting,
  User,
  UserStatus,
} from '@prisma/client';

import { HomeworkService } from '../homework/homework.service';
import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import {
  BanUserDto,
  BulkUpsertSpecialtyModulesAdminDto,
  CreateAiPromptTemplateDto,
  CreatePlanDto,
  CreateOnboardingQuestionDto,
  CreateSpecialtyDto,
  ListAuditLogsQueryDto,
  ListUsersQueryDto,
  UnbanUserDto,
  UpdateAiPromptTemplateDto,
  UpdatePlanDto,
  UpdateOnboardingQuestionDto,
  UpdateSpecialtyDto,
  UpdateSystemSettingDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto';

/** Default and maximum page sizes for paginated admin reads. */
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_AUDIT_PAGE_SIZE = 50;

/**
 * Public summary projection of `User` returned by the admin list/read
 * endpoints. Excludes `passwordHash` and other auth-only columns so the
 * payload never leaks credential data even on log dumps.
 */
export type AdminUserSummary = Pick<
  User,
  | 'id'
  | 'email'
  | 'username'
  | 'phone'
  | 'role'
  | 'status'
  | 'fullName'
  | 'avatarUrl'
  | 'locale'
  | 'createdAt'
  | 'updatedAt'
>;

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * AdminService — owns admin moderation and catalog management endpoints
 * (Req 24.1 – 24.5, 21.9).
 *
 * Every mutation:
 *   1. Validates the input and any cross-row invariants.
 *   2. Performs the write inside a Prisma transaction.
 *   3. Appends an `AdminAuditLog` row in the same transaction so the
 *      audit trail and the data it describes commit atomically.
 *
 * The SpecialtyModule bulk-upsert delegates to `HomeworkService.
 * bulkUpsertSpecialtyModules` so the per-Specialty active cap of 10 is
 * enforced exactly once (service-layer guard + DB trigger). The audit
 * row for that path is written here on success — the homework module
 * already emits the corresponding outbox event, so no outbox emission
 * happens at the admin layer.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly homeworkService: HomeworkService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  // ==================================================================
  // Users (Req 24.4)
  // ==================================================================

  /**
   * Page through users for the admin moderation surface. The `q` filter
   * does a case-insensitive substring match against email, username and
   * full name; the dataset is small enough today that ILIKE is plenty.
   */
  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<PaginatedResult<AdminUserSummary>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.UserWhereInput = {
      ...(query.role && { role: query.role }),
      ...(query.status && { status: query.status }),
      ...(query.q && {
        OR: [
          { email: { contains: query.q, mode: 'insensitive' } },
          { username: { contains: query.q, mode: 'insensitive' } },
          { fullName: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          role: true,
          status: true,
          fullName: true,
          avatarUrl: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }

  /**
   * Update a user's status (Req 24.4).
   *
   * When the new status is `SUSPENDED` or `DELETED`, every active session
   * for the user is revoked in the same transaction so the moderation
   * action takes effect immediately.
   *
   * Idempotent: setting `status=SUSPENDED` on an already-suspended user
   * is a no-op at the data layer, but still produces a fresh audit log
   * entry — admins routinely double-suspend after follow-up reviews and
   * the timeline matters more than the diff.
   */
  async updateUserStatus(
    actorId: string,
    targetUserId: string,
    dto: UpdateUserStatusDto,
    context: { ip?: string | null } = {},
  ): Promise<AdminUserSummary> {
    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true, role: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: `User ${targetUserId} not found`,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.update({
        where: { id: targetUserId },
        data: { status: dto.status },
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          role: true,
          status: true,
          fullName: true,
          avatarUrl: true,
          locale: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Revoke active sessions on suspend / delete so the user is
      // logged out across every device immediately (Req 24.4).
      if (dto.status === 'SUSPENDED' || dto.status === 'DELETED') {
        await tx.session.updateMany({
          where: { userId: targetUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.USER_STATUS_CHANGED,
        `User/${targetUserId}`,
        {
          targetUserId,
          previousStatus: existing.status,
          newStatus: dto.status as UserStatus,
          ...(dto.reason && { reason: dto.reason }),
        },
        { ip: context.ip ?? null },
        tx,
      );

      return newUser;
    });

    this.logger.log(
      `User ${targetUserId} status: ${existing.status} → ${dto.status} by admin ${actorId}`,
    );
    return updated;
  }

  // ==================================================================
  // Specialty CRUD (Req 24.1)
  // ==================================================================

  /**
   * Admin "all specialties" view — includes inactive rows so admins can
   * re-enable retired catalogs. Public discovery uses
   * `SpecialtyService.listActive` and never sees this surface.
   */
  async listSpecialties(): Promise<Specialty[]> {
    return this.prisma.specialty.findMany({
      orderBy: [{ isActive: 'desc' }, { slug: 'asc' }],
    });
  }

  async createSpecialty(
    actorId: string,
    dto: CreateSpecialtyDto,
    context: { ip?: string | null } = {},
  ): Promise<Specialty> {
    // Pre-check the slug so we can return a clean 409 without wrapping
    // the raw Prisma unique-constraint error.
    const slugClash = await this.prisma.specialty.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (slugClash) {
      throw new ConflictException({
        code: 'SPECIALTY_SLUG_TAKEN',
        message: `Specialty with slug "${dto.slug}" already exists`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.specialty.create({
        data: {
          slug: dto.slug,
          nameUz: dto.nameUz,
          nameRu: dto.nameRu,
          nameEn: dto.nameEn,
          dashboardKey: dto.dashboardKey,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.SPECIALTY_CREATED,
        `Specialty/${created.id}`,
        {
          specialtyId: created.id,
          slug: created.slug,
          isActive: created.isActive,
        },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(
        `Specialty created: id=${created.id} slug=${created.slug} by admin ${actorId}`,
      );
      return created;
    });
  }

  async updateSpecialty(
    actorId: string,
    specialtyId: string,
    dto: UpdateSpecialtyDto,
    context: { ip?: string | null } = {},
  ): Promise<Specialty> {
    const existing = await this.prisma.specialty.findUnique({
      where: { id: specialtyId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'SPECIALTY_NOT_FOUND',
        message: `Specialty ${specialtyId} not found`,
      });
    }

    if (this.isEmptySpecialtyUpdate(dto)) {
      // Nothing to change — short-circuit so we don't write a misleading
      // audit row for a no-op request.
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.specialty.update({
        where: { id: specialtyId },
        data: {
          ...(dto.nameUz !== undefined && { nameUz: dto.nameUz }),
          ...(dto.nameRu !== undefined && { nameRu: dto.nameRu }),
          ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
          ...(dto.dashboardKey !== undefined && {
            dashboardKey: dto.dashboardKey,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.SPECIALTY_UPDATED,
        `Specialty/${specialtyId}`,
        {
          specialtyId,
          changes: this.diffSpecialty(existing, updated),
        },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(
        `Specialty ${specialtyId} updated by admin ${actorId}`,
      );
      return updated;
    });
  }

  // ==================================================================
  // SpecialtyModule (Req 24.2, 24.3)
  // ==================================================================

  /**
   * Read the admin "full mapping" view of a specialty's module catalog.
   * Delegates straight through to the homework module so admins see the
   * same row set the cap-enforced bulk-upsert operates on.
   */
  async listSpecialtyModules(specialtyId: string): Promise<SpecialtyModule[]> {
    return this.homeworkService.listSpecialtyModulesForAdmin(specialtyId);
  }

  /**
   * Bulk-upsert a specialty's module catalog. Cap enforcement and outbox
   * emission live in `HomeworkService.bulkUpsertSpecialtyModules`; the
   * admin layer adds the audit-log entry on success so the trail is
   * consistent with the other admin mutations.
   */
  async bulkUpsertSpecialtyModules(
    actorId: string,
    specialtyId: string,
    dto: BulkUpsertSpecialtyModulesAdminDto,
    context: { ip?: string | null } = {},
  ): Promise<SpecialtyModule[]> {
    const result = await this.homeworkService.bulkUpsertSpecialtyModules(
      specialtyId,
      dto,
      actorId,
    );

    // Audit-log the request payload (not the post-write state) so the
    // entry mirrors the admin's intent. The full effective set is still
    // recoverable from the table at any time.
    await this.adminAuditService.log(
      actorId,
      AUDIT_ACTIONS.SPECIALTY_MODULES_UPDATED,
      `Specialty/${specialtyId}`,
      {
        specialtyId,
        modules: dto.modules.map((m) => ({
          moduleType: m.moduleType,
          isActive: m.isActive,
          ...(m.defaultEnabled !== undefined && {
            defaultEnabled: m.defaultEnabled,
          }),
        })),
      },
      { ip: context.ip ?? null },
    );

    return result;
  }

  // ==================================================================
  // Plans (Req 24.x — billing plan administration)
  // ==================================================================

  async listPlans(): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      orderBy: [{ isActive: 'desc' }, { priceUzs: 'asc' }],
    });
  }

  async createPlan(
    actorId: string,
    dto: CreatePlanDto,
    context: { ip?: string | null } = {},
  ): Promise<Plan> {
    const slugClash = await this.prisma.plan.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (slugClash) {
      throw new ConflictException({
        code: 'PLAN_SLUG_TAKEN',
        message: `Plan with slug "${dto.slug}" already exists`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          slug: dto.slug,
          nameUz: dto.nameUz,
          priceUzs: dto.priceUzs,
          intervalDays: dto.intervalDays,
          ...(dto.maxStudents !== undefined && { maxStudents: dto.maxStudents }),
          features: (dto.features ?? {}) as Prisma.InputJsonValue,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.PLAN_CREATED,
        `Plan/${created.id}`,
        {
          planId: created.id,
          slug: created.slug,
          priceUzs: created.priceUzs,
          intervalDays: created.intervalDays,
        },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(
        `Plan created: id=${created.id} slug=${created.slug} by admin ${actorId}`,
      );
      return created;
    });
  }

  async updatePlan(
    actorId: string,
    planId: string,
    dto: UpdatePlanDto,
    context: { ip?: string | null } = {},
  ): Promise<Plan> {
    const existing = await this.prisma.plan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PLAN_NOT_FOUND',
        message: `Plan ${planId} not found`,
      });
    }

    if (this.isEmptyPlanUpdate(dto)) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.plan.update({
        where: { id: planId },
        data: {
          ...(dto.nameUz !== undefined && { nameUz: dto.nameUz }),
          ...(dto.priceUzs !== undefined && { priceUzs: dto.priceUzs }),
          ...(dto.intervalDays !== undefined && {
            intervalDays: dto.intervalDays,
          }),
          ...(dto.maxStudents !== undefined && {
            maxStudents: dto.maxStudents,
          }),
          ...(dto.features !== undefined && {
            features: dto.features as Prisma.InputJsonValue,
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.PLAN_UPDATED,
        `Plan/${planId}`,
        {
          planId,
          changes: this.diffPlan(existing, updated),
        },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(`Plan ${planId} updated by admin ${actorId}`);
      return updated;
    });
  }

  // ============ System Settings ============

  async listSystemSettings(): Promise<SystemSetting[]> {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async updateSystemSetting(
    actorId: string,
    key: string,
    dto: UpdateSystemSettingDto,
    context: { ip?: string | null } = {},
  ): Promise<SystemSetting> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value: dto.value as Prisma.InputJsonValue,
          description: dto.description ?? null,
        },
        update: {
          value: dto.value as Prisma.InputJsonValue,
          ...(dto.description !== undefined && { description: dto.description ?? null }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        'SYSTEM_SETTING_UPDATED',
        `SystemSetting/${key}`,
        { key, value: dto.value },
        { ip: context.ip ?? null },
        tx,
      );

      return updated;
    });
  }

  // ============ AI Prompt Templates ============

  async listAiPromptTemplates(): Promise<AiPromptTemplate[]> {
    return this.prisma.aiPromptTemplate.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async createAiPromptTemplate(
    actorId: string,
    dto: CreateAiPromptTemplateDto,
    context: { ip?: string | null } = {},
  ): Promise<AiPromptTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.aiPromptTemplate.create({
        data: {
          key: dto.key,
          intent: dto.intent,
          systemText: dto.systemText,
          userTemplate: dto.userTemplate,
          modelName: dto.modelName ?? 'claude-3-5-sonnet-latest',
          maxTokens: dto.maxTokens ?? 2000,
          isActive: dto.isActive ?? true,
        },
      });

      await this.adminAuditService.log(
        actorId,
        'AI_PROMPT_CREATED',
        `AiPromptTemplate/${created.id}`,
        { key: created.key, intent: created.intent },
        { ip: context.ip ?? null },
        tx,
      );

      return created;
    });
  }

  async updateAiPromptTemplate(
    actorId: string,
    id: string,
    dto: UpdateAiPromptTemplateDto,
    context: { ip?: string | null } = {},
  ): Promise<AiPromptTemplate> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.aiPromptTemplate.update({
        where: { id },
        data: {
          ...(dto.intent !== undefined && { intent: dto.intent }),
          ...(dto.systemText !== undefined && { systemText: dto.systemText }),
          ...(dto.userTemplate !== undefined && { userTemplate: dto.userTemplate }),
          ...(dto.modelName !== undefined && { modelName: dto.modelName }),
          ...(dto.maxTokens !== undefined && { maxTokens: dto.maxTokens }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        'AI_PROMPT_UPDATED',
        `AiPromptTemplate/${id}`,
        { id, key: updated.key },
        { ip: context.ip ?? null },
        tx,
      );

      return updated;
    });
  }

  // ============ Onboarding Questions ============

  async listOnboardingQuestions(): Promise<OnboardingQuestion[]> {
    return this.prisma.onboardingQuestion.findMany({
      orderBy: [{ specialtyId: 'asc' }, { order: 'asc' }],
    });
  }

  async createOnboardingQuestion(
    actorId: string,
    dto: CreateOnboardingQuestionDto,
    context: { ip?: string | null } = {},
  ): Promise<OnboardingQuestion> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.onboardingQuestion.create({
        data: {
          specialtyId: dto.specialtyId ?? null,
          order: dto.order,
          textUz: dto.textUz,
          textRu: dto.textRu,
          textEn: dto.textEn,
          optionsJson: dto.optionsJson as Prisma.InputJsonValue,
          isActive: dto.isActive ?? true,
        },
      });

      await this.adminAuditService.log(
        actorId,
        'ONBOARDING_QUESTION_CREATED',
        `OnboardingQuestion/${created.id}`,
        { id: created.id, order: created.order },
        { ip: context.ip ?? null },
        tx,
      );

      return created;
    });
  }

  async updateOnboardingQuestion(
    actorId: string,
    id: string,
    dto: UpdateOnboardingQuestionDto,
    context: { ip?: string | null } = {},
  ): Promise<OnboardingQuestion> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.onboardingQuestion.update({
        where: { id },
        data: {
          ...(dto.specialtyId !== undefined && { specialtyId: dto.specialtyId ?? null }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.textUz !== undefined && { textUz: dto.textUz }),
          ...(dto.textRu !== undefined && { textRu: dto.textRu }),
          ...(dto.textEn !== undefined && { textEn: dto.textEn }),
          ...(dto.optionsJson !== undefined && { optionsJson: dto.optionsJson as Prisma.InputJsonValue }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        'ONBOARDING_QUESTION_UPDATED',
        `OnboardingQuestion/${id}`,
        { id },
        { ip: context.ip ?? null },
        tx,
      );

      return updated;
    });
  }

  // ==================================================================
  // Audit log read (Req 24.5, 21.9)
  // ==================================================================

  /**
   * Page through `AdminAuditLog` rows for the security review surface.
   * The result includes the full payload — admins reviewing an incident
   * need it as captured. PII redaction is the writer's responsibility.
   */
  async listAuditLogs(
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResult<any>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_AUDIT_PAGE_SIZE;

    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.action && { action: query.action }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);

    const mappedItems = items.map((item) => ({
      ...item,
      adminEmail: item.actor?.email ?? null,
      adminId: item.actorId,
    }));

    return { items: mappedItems, page, pageSize, total };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private isEmptySpecialtyUpdate(dto: UpdateSpecialtyDto): boolean {
    return (
      dto.nameUz === undefined &&
      dto.nameRu === undefined &&
      dto.nameEn === undefined &&
      dto.dashboardKey === undefined &&
      dto.isActive === undefined
    );
  }

  private isEmptyPlanUpdate(dto: UpdatePlanDto): boolean {
    return (
      dto.nameUz === undefined &&
      dto.priceUzs === undefined &&
      dto.intervalDays === undefined &&
      dto.maxStudents === undefined &&
      dto.features === undefined &&
      dto.isActive === undefined
    );
  }

  private diffSpecialty(
    before: Specialty,
    after: Specialty,
  ): Record<string, { from: unknown; to: unknown }> {
    const fields: (keyof Specialty)[] = [
      'nameUz',
      'nameRu',
      'nameEn',
      'dashboardKey',
      'isActive',
    ];
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fields) {
      if (before[f] !== after[f]) {
        out[f as string] = { from: before[f], to: after[f] };
      }
    }
    return out;
  }

  private diffPlan(
    before: Plan,
    after: Plan,
  ): Record<string, { from: unknown; to: unknown }> {
    const fields: (keyof Plan)[] = [
      'nameUz',
      'priceUzs',
      'intervalDays',
      'maxStudents',
      'isActive',
    ];
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fields) {
      if (before[f] !== after[f]) {
        out[f as string] = { from: before[f], to: after[f] };
      }
    }
    // `features` is a JSON object — compare via JSON.stringify so we record
    // changes without claiming arrays/objects are unequal when they're not.
    if (JSON.stringify(before.features) !== JSON.stringify(after.features)) {
      out.features = { from: before.features, to: after.features };
    }
    return out;
  }

  async listRecentInvoices(opts: { limit?: number; status?: string } = {}) {
    const limit = Math.min(50, opts.limit ?? 10);
    const where: Record<string, any> = {};
    if (opts.status) where['status'] = opts.status;

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        take: limit,
        include: {
          teacher: {
            include: { user: { select: { id: true, fullName: true, email: true } } },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total };
  }

  async listSpecialtiesWithCounts(): Promise<(Specialty & { teacherCount: number })[]> {
    const specialties = await this.prisma.specialty.findMany({
      orderBy: [{ isActive: 'desc' }, { slug: 'asc' }],
      include: { _count: { select: { teachers: { where: {} } } } },
    });

    return specialties.map((s) => ({
      ...s,
      teacherCount: s._count.teachers,
    }));
  }
}
