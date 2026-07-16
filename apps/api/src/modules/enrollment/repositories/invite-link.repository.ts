import { Injectable } from '@nestjs/common';
import { InviteLink, Prisma, PrismaClient } from '@prisma/client';

export interface CreateInviteLinkInput {
  token: string;
  groupId: string;
  createdById: string;
  expiresAt: Date | null;
  usesLimit: number | null;
}

/**
 * InviteLinkRepository — Prisma-based CRUD for the InviteLink table.
 *
 * Owned by the enrollment module. The `(token)` column has a UNIQUE index
 * (see schema.prisma) so any race on token generation manifests as a
 * Prisma `P2002` and is retried by the caller.
 */
@Injectable()
export class InviteLinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateInviteLinkInput,
    tx?: Prisma.TransactionClient,
  ): Promise<InviteLink> {
    const client = tx ?? this.prisma;
    return client.inviteLink.create({
      data: {
        token: input.token,
        groupId: input.groupId,
        createdById: input.createdById,
        expiresAt: input.expiresAt,
        usesLimit: input.usesLimit,
        usesCount: 0,
        isActive: true,
      },
    });
  }

  async findById(id: string): Promise<InviteLink | null> {
    return this.prisma.inviteLink.findUnique({ where: { id } });
  }

  async findByToken(token: string): Promise<InviteLink | null> {
    return this.prisma.inviteLink.findUnique({ where: { token } });
  }

  /**
   * List active invites for a group. Used by the teacher UI to show /
   * revoke existing links.
   */
  /** Atomically increment usesCount for an invite link. */
  async incrementUsesCount(id: string, tx?: Prisma.TransactionClient): Promise<InviteLink> {
    const client = tx ?? this.prisma;
    return client.inviteLink.update({
      where: { id },
      data: { usesCount: { increment: 1 } },
    });
  }

  /** Deactivate (soft-delete) an invite link. */
  async deactivate(id: string): Promise<InviteLink> {
    return this.prisma.inviteLink.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listActiveByGroup(
    groupId: string,
    opts: { take?: number; skip?: number } = {},
  ): Promise<InviteLink[]> {
    // Pagination cap (Task 24.2): teachers occasionally generate dozens
    // of invite links per cohort; cap the listing so the management UI
    // never loads thousands at once.
    const take = Math.min(Math.max(1, opts.take ?? 50), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return this.prisma.inviteLink.findMany({
      where: { groupId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}
