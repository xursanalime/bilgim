import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, Schedule } from '@prisma/client';

export interface CreateScheduleInput {
  groupId: string;
  rrule: string;
  timezone: string;
  durationMin: number;
}

export interface UpdateScheduleInput {
  rrule?: string;
  timezone?: string;
  durationMin?: number;
}

/**
 * ScheduleRepository — Prisma-backed CRUD for the `Schedule` row, which is
 * the per-group recurring event spec (Req 10.1).
 *
 * Versioning contract:
 *   - `create` always sets `version = 1`.
 *   - `incrementAndUpdate` is a single SQL statement that bumps `version`
 *     by 1 atomically with the field updates. Two concurrent writes can
 *     never produce the same version because the increment happens
 *     server-side under the row lock.
 *   - `incrementVersionForDelete` performs the same atomic bump in
 *     preparation for emitting `schedule.changed` before the row is
 *     dropped, so subscribers see a fresh `version` value.
 */
@Injectable()
export class ScheduleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Schedule | null> {
    const client = tx ?? this.prisma;
    return client.schedule.findUnique({ where: { id } });
  }

  async findByIdWithOwnership(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<
    | (Schedule & { group: { courseId: string; course: { teacherId: string } } })
    | null
  > {
    const client = tx ?? this.prisma;
    return client.schedule.findUnique({
      where: { id },
      include: {
        group: {
          select: {
            courseId: true,
            course: { select: { teacherId: true } },
          },
        },
      },
    }) as any;
  }

  async findByGroupId(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Schedule | null> {
    const client = tx ?? this.prisma;
    return client.schedule.findUnique({ where: { groupId } });
  }

  async create(
    input: CreateScheduleInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Schedule> {
    const client = tx ?? this.prisma;
    return client.schedule.create({
      data: {
        groupId: input.groupId,
        rrule: input.rrule,
        timezone: input.timezone,
        durationMin: input.durationMin,
        // Hard-coded — first version per group is always 1 (Property 8 anchor).
        version: 1,
      },
    });
  }

  /**
   * Atomically apply `data` and bump `version = version + 1` in a single
   * UPDATE. Returns the updated row, or `null` if no row matches `id`.
   * Throws Prisma's not-found error otherwise — the service layer maps it.
   */
  async incrementAndUpdate(
    id: string,
    data: UpdateScheduleInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Schedule> {
    const client = tx ?? this.prisma;
    return client.schedule.update({
      where: { id },
      data: {
        ...(data.rrule !== undefined && { rrule: data.rrule }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.durationMin !== undefined && {
          durationMin: data.durationMin,
        }),
        version: { increment: 1 },
      },
    });
  }

  /**
   * Bump `version` without touching the rest of the row. Used in the
   * delete path so the outbox event records a fresh version before the
   * row goes away.
   */
  async incrementVersionForDelete(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Schedule> {
    const client = tx ?? this.prisma;
    return client.schedule.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
  }

  async delete(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.schedule.deleteMany({ where: { id } });
  }
}
