import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ExamTrack, HomeworkModuleType, Prisma, PrismaClient } from '@prisma/client';

import {
  LANGUAGE_MODULE_TYPES,
  LanguageModuleType,
  isLanguageModuleType,
} from '../homework/language-module-types';
import { AdminAuditService, AUDIT_ACTIONS } from './admin-audit.service';
import {
  CreateExamTrackDto,
  UpdateExamTrackDto,
} from './dto';

/**
 * `SystemSetting.key` under which the platform-wide English module
 * catalog enable/disable state is persisted (English-Only Platform
 * Refocus, Req 17.2 / 17.3).
 *
 * Why `SystemSetting` rather than a dedicated table? The global catalog
 * is a tiny, slowly-changing, single-row configuration (eight booleans).
 * The existing generic `SystemSetting` Json store is the idiomatic place
 * for it — no schema migration is needed, and the admin audit/read
 * surfaces already understand the table. Task 5.2 represented the
 * enable/disable state as a static default; this is the admin-managed
 * persistence layered on top.
 */
export const MODULE_CATALOG_SETTING_KEY = 'english.module-catalog';

/**
 * Shape stored in `SystemSetting.value` for {@link MODULE_CATALOG_SETTING_KEY}.
 * Only the *disabled* skills are stored; an absent key (or empty list)
 * means every skill is enabled, matching the Task 5.2 default of all
 * eight skills on.
 */
interface ModuleCatalogSettingValue {
  disabled: LanguageModuleType[];
}

/** A single global-catalog entry as exposed to admins. */
export interface ModuleCatalogEntry {
  moduleType: LanguageModuleType;
  enabled: boolean;
}

/**
 * AdminEnglishCatalogService — admin management of the English domain
 * configuration (English-Only Platform Refocus, Req 17.1 – 17.4).
 *
 * Two surfaces:
 *   1. **Exam_Track options** (Req 17.1) — create / list / activate /
 *      deactivate using the existing `ExamTrack` model (`isActive`
 *      toggles availability without deleting history).
 *   2. **Global 8-skill catalog** (Req 17.2 / 17.3) — enable / disable
 *      each of the eight `Language_Module_Type` skills platform-wide.
 *      Disabling is **non-destructive**: it only removes the skill from
 *      *new* assignment availability; existing Submissions and
 *      Assignments are never touched (Req 17.3).
 *
 * Every mutation writes an `AdminAuditLog` row through
 * `AdminAuditService` (Req 17.4), mirroring the rest of the admin module.
 */
@Injectable()
export class AdminEnglishCatalogService {
  private readonly logger = new Logger(AdminEnglishCatalogService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  // ==================================================================
  // Exam_Track options (Req 17.1)
  // ==================================================================

  /**
   * Admin "all exam tracks" view — includes inactive rows so admins can
   * re-activate retired tracks. Ordered active-first, then by slug.
   */
  async listExamTracks(): Promise<ExamTrack[]> {
    return this.prisma.examTrack.findMany({
      orderBy: [{ isActive: 'desc' }, { slug: 'asc' }],
    });
  }

  /**
   * Same as {@link listExamTracks} but augments each row with the number
   * of instructors currently focusing on the track (`TeacherProfile.
   * examTrackFocus` contains the slug). Powers the admin exam-tracks
   * table which surfaces the instructor count column.
   */
  async listExamTracksWithCounts(): Promise<
    (ExamTrack & { instructorCount: number })[]
  > {
    const tracks = await this.listExamTracks();
    const counts = await Promise.all(
      tracks.map((t) =>
        this.prisma.teacherProfile.count({
          where: { examTrackFocus: { has: t.slug } },
        }),
      ),
    );
    return tracks.map((t, i) => ({ ...t, instructorCount: counts[i] ?? 0 }));
  }

  /**
   * Permanently delete an Exam_Track option.
   *
   * `ExamTrack.slug` is referenced by `TeacherProfile.examTrackFocus` and
   * `Course.examTrack` as a *string* (no foreign key), so deletion never
   * cascades or orphans a row — existing references simply point at a slug
   * that is no longer in the catalog (treated as inactive). The mutation is
   * audit-logged like every other admin write.
   */
  async deleteExamTrack(
    actorId: string,
    examTrackId: string,
    context: { ip?: string | null } = {},
  ): Promise<{ id: string; slug: string }> {
    const existing = await this.prisma.examTrack.findUnique({
      where: { id: examTrackId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'EXAM_TRACK_NOT_FOUND',
        message: `Exam track ${examTrackId} not found`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.examTrack.delete({ where: { id: examTrackId } });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.EXAM_TRACK_DELETED,
        `ExamTrack/${examTrackId}`,
        { examTrackId, slug: existing.slug, name: existing.name },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(
        `Exam track ${examTrackId} (slug=${existing.slug}) deleted by admin ${actorId}`,
      );
      return { id: existing.id, slug: existing.slug };
    });
  }

  async createExamTrack(
    actorId: string,
    dto: CreateExamTrackDto,
    context: { ip?: string | null } = {},
  ): Promise<ExamTrack> {
    const slugClash = await this.prisma.examTrack.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (slugClash) {
      throw new ConflictException({
        code: 'EXAM_TRACK_SLUG_TAKEN',
        message: `Exam track with slug "${dto.slug}" already exists`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.examTrack.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.adminAuditService.log(
        actorId,
        AUDIT_ACTIONS.EXAM_TRACK_CREATED,
        `ExamTrack/${created.id}`,
        { examTrackId: created.id, slug: created.slug, isActive: created.isActive },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(
        `Exam track created: id=${created.id} slug=${created.slug} by admin ${actorId}`,
      );
      return created;
    });
  }

  /**
   * Update an Exam_Track — rename and/or (de)activate (Req 17.1).
   *
   * Deactivation hides the track from new course creation but leaves
   * every Course that already references its slug intact. The audit
   * action distinguishes activate vs. deactivate vs. a plain rename so
   * the timeline reads cleanly.
   */
  async updateExamTrack(
    actorId: string,
    examTrackId: string,
    dto: UpdateExamTrackDto,
    context: { ip?: string | null } = {},
  ): Promise<ExamTrack> {
    const existing = await this.prisma.examTrack.findUnique({
      where: { id: examTrackId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'EXAM_TRACK_NOT_FOUND',
        message: `Exam track ${examTrackId} not found`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.examTrack.update({
        where: { id: examTrackId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      const action =
        dto.isActive === true && existing.isActive === false
          ? AUDIT_ACTIONS.EXAM_TRACK_ACTIVATED
          : dto.isActive === false && existing.isActive === true
            ? AUDIT_ACTIONS.EXAM_TRACK_DEACTIVATED
            : AUDIT_ACTIONS.EXAM_TRACK_UPDATED;

      await this.adminAuditService.log(
        actorId,
        action,
        `ExamTrack/${examTrackId}`,
        {
          examTrackId,
          slug: existing.slug,
          changes: {
            ...(dto.name !== undefined &&
              existing.name !== updated.name && {
                name: { from: existing.name, to: updated.name },
              }),
            ...(dto.isActive !== undefined &&
              existing.isActive !== updated.isActive && {
                isActive: { from: existing.isActive, to: updated.isActive },
              }),
          },
        },
        { ip: context.ip ?? null },
        tx,
      );

      this.logger.log(`Exam track ${examTrackId} updated by admin ${actorId}`);
      return updated;
    });
  }

  // ==================================================================
  // Global 8-skill catalog enable/disable (Req 17.2, 17.3)
  // ==================================================================

  /**
   * The platform-wide enable/disable state of the eight English skills.
   * Always returns exactly the eight canonical skills, defaulting to
   * enabled when no override has been persisted.
   */
  async listModuleCatalog(): Promise<ModuleCatalogEntry[]> {
    const disabled = await this.readDisabledSet();
    return LANGUAGE_MODULE_TYPES.map((moduleType) => ({
      moduleType,
      enabled: !disabled.has(moduleType),
    }));
  }

  /**
   * Enable or disable a single global skill platform-wide (Req 17.2).
   *
   * Disabling is intentionally **non-destructive** (Req 17.3): the only
   * write this method performs is to the `SystemSetting` configuration
   * row. No `Submission`, `Assignment`, or `GroupModule` row is read or
   * modified, so historical work is preserved and only *new* assignment
   * availability is affected.
   *
   * Idempotent: setting a skill to its current state is a no-op on the
   * data but still records an audit entry — the admin's intent and the
   * timeline matter more than the diff.
   */
  async setModuleEnabled(
    actorId: string,
    moduleType: HomeworkModuleType,
    enabled: boolean,
    context: { ip?: string | null } = {},
  ): Promise<ModuleCatalogEntry> {
    if (!isLanguageModuleType(moduleType)) {
      // Defence in depth — the controller validates against the Zod enum,
      // but the service refuses to ever persist a Legacy_Module_Type.
      throw new NotFoundException({
        code: 'MODULE_TYPE_NOT_SUPPORTED',
        message: `"${moduleType}" is not one of the eight English skills`,
      });
    }

    const disabled = await this.readDisabledSet();
    if (enabled) {
      disabled.delete(moduleType);
    } else {
      disabled.add(moduleType);
    }
    // Persist in a stable, canonical order so the stored value is
    // deterministic regardless of toggle order.
    const nextDisabled = LANGUAGE_MODULE_TYPES.filter((t) => disabled.has(t));

    await this.prisma.$transaction(async (tx) => {
      const value: ModuleCatalogSettingValue = { disabled: nextDisabled };
      await tx.systemSetting.upsert({
        where: { key: MODULE_CATALOG_SETTING_KEY },
        create: {
          key: MODULE_CATALOG_SETTING_KEY,
          value: value as unknown as Prisma.InputJsonValue,
          description: 'Platform-wide English module catalog enable/disable state',
        },
        update: { value: value as unknown as Prisma.InputJsonValue },
      });

      await this.adminAuditService.log(
        actorId,
        enabled
          ? AUDIT_ACTIONS.MODULE_CATALOG_ENABLED
          : AUDIT_ACTIONS.MODULE_CATALOG_DISABLED,
        `EnglishModuleCatalog/${moduleType}`,
        { moduleType, enabled, disabled: nextDisabled },
        { ip: context.ip ?? null },
        tx,
      );
    });

    this.logger.log(
      `English module catalog: ${moduleType} ${enabled ? 'enabled' : 'disabled'} by admin ${actorId}`,
    );
    return { moduleType, enabled };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  /**
   * Read the persisted set of globally-disabled skills. An absent or
   * malformed setting is treated as "nothing disabled" — the Task 5.2
   * default of all eight skills enabled.
   */
  private async readDisabledSet(): Promise<Set<LanguageModuleType>> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MODULE_CATALOG_SETTING_KEY },
      select: { value: true },
    });
    const raw = (setting?.value ?? null) as ModuleCatalogSettingValue | null;
    const disabled = Array.isArray(raw?.disabled) ? raw!.disabled : [];
    return new Set(disabled.filter(isLanguageModuleType));
  }
}
