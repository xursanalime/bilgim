import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, Recording } from '@prisma/client';

/**
 * Recording status string values stored in `Recording.status`. The
 * Prisma schema declares the column as `String` (not enum) for
 * forward-compat, so we pin them here.
 */
export const RECORDING_STATUS = {
  RECORDING: 'RECORDING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;

export type RecordingStatus =
  (typeof RECORDING_STATUS)[keyof typeof RECORDING_STATUS];

export interface CreateRecordingInput {
  lessonId: string;
  sessionId: string;
  status: RecordingStatus;
  /** Set when a MediaAsset has been linked (READY case). */
  assetId?: string | null;
  durationMs?: number | null;
}

/**
 * RecordingRepository — thin Prisma wrapper for the `Recording` table.
 *
 * Conventions:
 *  - `Recording.sessionId` is `@unique` in the schema, so the unique
 *    constraint guarantees we never produce two Recording rows for the
 *    same LiveSession even if the finalize processor retries. The
 *    service catches `P2002` and treats it as idempotent.
 *  - Mutating queries accept an optional `Prisma.TransactionClient` so
 *    they can be composed with the LiveSession transition in a single
 *    `$transaction`.
 */
@Injectable()
export class RecordingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySessionId(
    sessionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Recording | null> {
    const client = tx ?? this.prisma;
    return client.recording.findUnique({ where: { sessionId } });
  }

  /**
   * Insert a Recording row. Throws `P2002` if a row already exists for
   * `sessionId` — callers translate that into the idempotent path.
   */
  async create(
    input: CreateRecordingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Recording> {
    const client = tx ?? this.prisma;
    return client.recording.create({
      data: {
        lessonId: input.lessonId,
        sessionId: input.sessionId,
        status: input.status,
        assetId: input.assetId ?? null,
        durationMs: input.durationMs ?? null,
      },
    });
  }
}
