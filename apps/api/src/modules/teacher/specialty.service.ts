import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, Specialty, SpecialtyModule } from '@prisma/client';

/**
 * SpecialtyService — read-only operations for the Specialty catalog.
 *
 * The admin module is the writer for specialties. The teacher module only
 * reads them (e.g. to look up a specialty by slug after rule-based
 * classification, or to load the full specialty for a redirect URL).
 */
@Injectable()
export class SpecialtyService {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<Specialty | null> {
    const client = tx ?? this.prisma;
    return client.specialty.findUnique({ where: { id } });
  }

  async findBySlug(
    slug: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Specialty | null> {
    const client = tx ?? this.prisma;
    return client.specialty.findUnique({ where: { slug } });
  }

  async getById(id: string, tx?: Prisma.TransactionClient): Promise<Specialty> {
    const specialty = await this.findById(id, tx);
    if (!specialty) {
      throw new NotFoundException({
        code: 'SPECIALTY_NOT_FOUND',
        message: `Specialty ${id} not found`,
      });
    }
    return specialty;
  }

  async listActive(tx?: Prisma.TransactionClient): Promise<Specialty[]> {
    const client = tx ?? this.prisma;
    return client.specialty.findMany({
      where: { isActive: true },
      orderBy: { slug: 'asc' },
    });
  }

  /**
   * List the active SpecialtyModule rows for a specialty — the admin-managed
   * homework module catalog used to seed `GroupModule` toggles when a Group
   * is created (Req 7.2, 7.3). Hard cap of 10 active rows per specialty is
   * enforced by the admin module / DB trigger; this read does not enforce
   * it.
   */
  async listActiveModules(
    specialtyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SpecialtyModule[]> {
    const client = tx ?? this.prisma;
    return client.specialtyModule.findMany({
      where: { specialtyId, isActive: true },
      orderBy: { moduleType: 'asc' },
    });
  }
}
