import { Injectable } from '@nestjs/common';
import {
  GroupModule,
  HomeworkModuleType,
  Prisma,
  PrismaClient,
  SpecialtyModule,
} from '@prisma/client';

export interface SeedGroupModulesInput {
  groupId: string;
  modules: Array<Pick<SpecialtyModule, 'moduleType' | 'defaultEnabled'>>;
}

/**
 * GroupModuleRepository — manages the per-group homework module toggle
 * catalog (Req 7.2, 7.3, 11.2).
 *
 * The catalog is seeded from `SpecialtyModule` rows when a Group is created
 * and is mutable thereafter via the per-Group toggle endpoints (Task 11
 * implements the toggle endpoint; this repo only provides seed + lookup).
 */
@Injectable()
export class GroupModuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Seed `GroupModule` rows for a freshly created group from the teacher's
   * specialty catalog. `isEnabled` mirrors `SpecialtyModule.defaultEnabled`
   * (Req 7.3).
   *
   * Idempotent: a re-seed is a no-op because of the `(groupId, moduleType)`
   * primary key — but in normal flows this is called exactly once inside the
   * group-creation transaction so duplicates should not happen.
   */
  async seedForGroup(
    input: SeedGroupModulesInput,
    tx: Prisma.TransactionClient,
  ): Promise<GroupModule[]> {
    if (input.modules.length === 0) return [];

    const now = new Date();
    await tx.groupModule.createMany({
      data: input.modules.map((m) => ({
        groupId: input.groupId,
        moduleType: m.moduleType,
        isEnabled: m.defaultEnabled,
        enabledAt: m.defaultEnabled ? now : null,
        disabledAt: m.defaultEnabled ? null : now,
      })),
      skipDuplicates: true,
    });

    return tx.groupModule.findMany({
      where: { groupId: input.groupId },
      orderBy: { moduleType: 'asc' },
    });
  }

  async listByGroup(groupId: string): Promise<GroupModule[]> {
    return this.prisma.groupModule.findMany({
      where: { groupId },
      orderBy: { moduleType: 'asc' },
    });
  }

  async findOne(
    groupId: string,
    moduleType: HomeworkModuleType,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupModule | null> {
    const client = tx ?? this.prisma;
    return client.groupModule.findUnique({
      where: { groupId_moduleType: { groupId, moduleType } },
    });
  }

  /**
   * Count `isEnabled = true` rows for a group. Used by the per-Group cap
   * guard before flipping a row to `isEnabled=true` (Task 17.2 mirrors
   * the per-Specialty cap of 10 active modules).
   */
  async countActiveByGroup(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.groupModule.count({
      where: { groupId, isEnabled: true },
    });
  }

  /**
   * Toggle a single `(groupId, moduleType)` row. Creates the row when it
   * does not yet exist (e.g. a `SpecialtyModule` activated after the Group
   * was seeded). Stamps `enabledAt` / `disabledAt` accordingly.
   *
   * Non-destructive: only the row's `isEnabled` flag is written; existing
   * `Assignment` / `AssignmentModule` rows are untouched (Req 11.4).
   */
  async upsertToggle(
    groupId: string,
    moduleType: HomeworkModuleType,
    isEnabled: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<GroupModule> {
    const now = new Date();
    return tx.groupModule.upsert({
      where: { groupId_moduleType: { groupId, moduleType } },
      create: {
        groupId,
        moduleType,
        isEnabled,
        enabledAt: isEnabled ? now : null,
        disabledAt: isEnabled ? null : now,
      },
      update: {
        isEnabled,
        ...(isEnabled
          ? { enabledAt: now, disabledAt: null }
          : { disabledAt: now }),
      },
    });
  }
}
