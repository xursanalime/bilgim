import { Injectable } from '@nestjs/common';
import {
  LiveSession,
  LiveSessionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

/** Statuses that mean "this session still owns an SFU room". */
const NON_TERMINAL_STATUSES: ReadonlyArray<LiveSessionStatus> = [
  'SCHEDULED',
  'STARTING',
  'LIVE',
];

export interface CreateActiveSessionInput {
  lessonId: string;
  /**
   * Stable id of the SFU router backing this session. Mapped to
   * `LiveSession.roomId` (which is `@unique` in the schema), so a
   * concurrent second `startSession` racing on the same lesson hits
   * a P2002 the caller can translate into 409.
   */
  roomId: string;
}

/**
 * LiveSessionRepository — thin Prisma wrapper for the LiveSession row
 * (Req 9.1, 9.5, 9.6, 9.8).
 *
 * Conventions match the rest of the codebase:
 *  - All mutating queries accept an optional `Prisma.TransactionClient`
 *    so the service can compose them with outbox writes inside a single
 *    `$transaction` (Req 18.1).
 *  - State transitions go through `updateMany` with a status
 *    precondition, so two callers can never both win — the loser sees
 *    `count === 0` and is responsible for raising the appropriate
 *    409 / 404.
 */
@Injectable()
export class LiveSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<LiveSession | null> {
    const client = tx ?? this.prisma;
    return client.liveSession.findUnique({ where: { id } });
  }

  /**
   * Return the most recent non-terminal session for a lesson, if any.
   * Used by `startSession` to detect an in-flight duplicate and by
   * `endSession`/`joinSession` to locate the row to mutate.
   */
  async findActiveByLessonId(
    lessonId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<LiveSession | null> {
    const client = tx ?? this.prisma;
    return client.liveSession.findFirst({
      where: {
        lessonId,
        status: { in: [...NON_TERMINAL_STATUSES] },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Latest LiveSession for a lesson regardless of status — used by
   * `endSession` to return an idempotent "already ended" result instead
   * of a 404 when the row has already moved to `ENDED`.
   */
  async findLatestByLessonId(
    lessonId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<LiveSession | null> {
    const client = tx ?? this.prisma;
    return client.liveSession.findFirst({
      where: { lessonId },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** All currently-LIVE sessions across the platform. */
  async listLive(
    tx?: Prisma.TransactionClient,
    opts: { take?: number; skip?: number } = {},
  ): Promise<LiveSession[]> {
    const client = tx ?? this.prisma;
    // Pagination cap (Task 24.2): the SFU mesh tops out at low
    // hundreds of concurrent rooms; capping at 100 keeps the teacher
    // "Live now" dashboard widget responsive even during peak periods.
    const take = Math.min(Math.max(1, opts.take ?? 100), 100);
    const skip = Math.max(0, opts.skip ?? 0);
    return client.liveSession.findMany({
      where: { status: 'LIVE' },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    });
  }

  /**
   * INSERT a new LiveSession in the LIVE state. The `roomId` carries the
   * SFU router id; relying on its `@unique` constraint means a concurrent
   * `startSession` racing for the same lesson short-circuits with a
   * P2002 instead of producing two LIVE rows.
   */
  async createActive(
    input: CreateActiveSessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<LiveSession> {
    const client = tx ?? this.prisma;
    return client.liveSession.create({
      data: {
        lessonId: input.lessonId,
        roomId: input.roomId,
        status: 'LIVE',
        startedAt: new Date(),
      },
    });
  }

  /**
   * INSERT a new LiveSession in the `SCHEDULED` state, with `startedAt`
   * left unset. Used when a STUDENT joins during the early-join window
   * (up to `EARLY_JOIN_MS` before `lesson.scheduledAt`) before the
   * teacher has pressed "start" — the room exists so the student can
   * wait in it, but the session isn't "live" yet so the duration timer
   * doesn't start counting.
   */
  async createPending(
    input: CreateActiveSessionInput,
    tx?: Prisma.TransactionClient,
  ): Promise<LiveSession> {
    const client = tx ?? this.prisma;
    return client.liveSession.create({
      data: {
        lessonId: input.lessonId,
        roomId: input.roomId,
        status: 'SCHEDULED',
      },
    });
  }

  /**
   * Optimistically transition a session out of `SCHEDULED` into `LIVE`,
   * stamping `startedAt` at the moment the teacher actually starts the
   * broadcast (not when the first student joined the waiting room).
   * Returns `true` only if exactly one row moved.
   */
  async transitionToLive(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.liveSession.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: {
        status: 'LIVE',
        startedAt: new Date(),
      },
    });
    return result.count > 0;
  }

  /**
   * Optimistically transition a session out of `STARTING|LIVE` into
   * `ENDED`. Returns `true` only if exactly one row moved — the loser
   * of a concurrent end-vs-end race sees `false` and treats the call as
   * idempotent.
   */
  async transitionToEnded(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const result = await client.liveSession.updateMany({
      where: {
        id,
        status: { in: ['STARTING', 'LIVE'] as LiveSessionStatus[] },
      },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });
    return result.count > 0;
  }
}
