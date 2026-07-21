import { Injectable } from '@nestjs/common';
import {
  HomeworkModuleType,
  Prisma,
  PrismaClient,
  SpecialtyModule,
} from '@prisma/client';

export interface UpsertSpecialtyModuleInput {
  specialtyId: string;
  moduleType: HomeworkModuleType;
  isActive: boolean;
  defaultEnabled?: boolean;
}

/**
 * SpecialtyModuleRepository — owns the admin-managed `SpecialtyModule`
 * catalog (Req 11.1, 11.7).
 *
 * Read paths cover both the admin "full mapping" view (every row, including
 * `isActive=false`) and the teacher / catalog view (only `isActive=true`).
 * Writes are upserts so the bulk PUT endpoint can apply a sparse desired
 * state without first deleting rows.
 *
 * The hard cap of 10 active rows per specialty is enforced at two layers:
 *   1. Service-layer guard (`countActiveBySpecialty` + check) — fast fail
 *      with a friendly 409.
 *   2. DB-level deferred constraint trigger
 *      `enforce_specialty_module_cap()` — last line of defence under
 *      concurrent admin writes.
 */
@Injectable()
export class SpecialtyModuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Full row list for a specialty — used by the admin dashboard.
   * Ordered by `moduleType` ascending so the UI renders deterministically.
   */
  async listBySpecialty(
    specialtyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SpecialtyModule[]> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.findMany({
      where: { specialtyId },
      orderBy: { moduleType: 'asc' },
    });
  }

  /**
   * Active-only listing — used by the teacher catalog endpoint and by
   * `CatalogService.createGroup` to seed `GroupModule` rows. The same
   * predicate as `SpecialtyService.listActiveModules` (kept for a stable
   * homework-module-owned read path).
   */
  async listActiveBySpecialty(
    specialtyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SpecialtyModule[]> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.findMany({
      where: { specialtyId, isActive: true },
      orderBy: { moduleType: 'asc' },
    });
  }

  /**
   * Count active modules for a specialty — used by the service-layer cap
   * guard before an upsert that would flip a row to `isActive=true`.
   */
  async countActiveBySpecialty(
    specialtyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.count({
      where: { specialtyId, isActive: true },
    });
  }

  async findOne(
    specialtyId: string,
    moduleType: HomeworkModuleType,
    tx?: Prisma.TransactionClient,
  ): Promise<SpecialtyModule | null> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.findUnique({
      where: { specialtyId_moduleType: { specialtyId, moduleType } },
    });
  }

  /**
   * Upsert a single (specialtyId, moduleType) row.
   *
   * Update path leaves `defaultEnabled` untouched when the input did not
   * provide a value — admins frequently flip `isActive` without touching
   * the seed default.
   */
  async upsert(
    input: UpsertSpecialtyModuleInput,
    tx?: Prisma.TransactionClient,
  ): Promise<SpecialtyModule> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.upsert({
      where: {
        specialtyId_moduleType: {
          specialtyId: input.specialtyId,
          moduleType: input.moduleType,
        },
      },
      create: {
        specialtyId: input.specialtyId,
        moduleType: input.moduleType,
        isActive: input.isActive,
        defaultEnabled: input.defaultEnabled ?? false,
      },
      update: {
        isActive: input.isActive,
        ...(input.defaultEnabled !== undefined && {
          defaultEnabled: input.defaultEnabled,
        }),
      },
    });
  }
}
