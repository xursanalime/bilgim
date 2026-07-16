import { Injectable } from '@nestjs/common';
import { PlaybackSession, Prisma, PrismaClient } from '@prisma/client';

/**
 * Data the caller supplies to persist a single playback session
 * (one row per issued Playback_Ticket). Mirrors the `PlaybackSession`
 * model in `packages/db/prisma/schema.prisma`.
 *
 * SECURITY (Req 3.1, 6.1): `viewerUserId`, `enrollmentId`, `viewerTag`
 * and the masked label are all derived SERVER-SIDE from the authenticated
 * session by {@link WatermarkIdentityService} — never from client input.
 * The row keeps the un-masked `viewerUserId`/`enrollmentId` so an admin
 * can trace a watermark/session marker back to a concrete learner
 * (Req 6.1, 6.4), while the visible overlay label stays PII-masked.
 */
export interface CreatePlaybackSessionInput {
  /**
   * Explicit primary key. The watermark identity is derived from this id
   * (it is the `{sessionId}` embedded in the overlay label and the
   * binding tag), so the caller generates it up front and reuses it here
   * to keep the label, tag, and row id consistent.
   */
  id: string;
  assetId: string;
  lessonId?: string | undefined;
  viewerUserId: string;
  enrollmentId?: string | undefined;
  /** Stable, opaque per-viewer binding tag (forensic marker). */
  viewerTag: string;
  drmKeySystem?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Ticket / session expiry — owned by the caller (PlaybackTicketService). */
  expiresAt: Date;
}

/**
 * PlaybackSessionRepository — Prisma-backed persistence for the
 * viewer↔session↔asset mapping (`PlaybackSession`) used for forensic
 * leak tracing (content-protection-backend, Req 6.1, 6.2, 6.4).
 *
 * The repository is intentionally thin: it owns row I/O only. Watermark
 * identity derivation and PII masking live in
 * {@link WatermarkIdentityService}; ticket lifetime / expiry is owned by
 * the `PlaybackTicketService` (Task 2.1). Retention pruning (Req 6.2)
 * uses `deleteIssuedBefore`.
 */
@Injectable()
export class PlaybackSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Persist the viewer↔session↔asset mapping for an issued ticket
   * (Req 6.1). `undefined` optional fields are normalized to `null` so
   * the row shape is explicit.
   */
  async create(input: CreatePlaybackSessionInput): Promise<PlaybackSession> {
    const data: Prisma.PlaybackSessionUncheckedCreateInput = {
      id: input.id,
      assetId: input.assetId,
      lessonId: input.lessonId ?? null,
      viewerUserId: input.viewerUserId,
      enrollmentId: input.enrollmentId ?? null,
      viewerTag: input.viewerTag,
      drmKeySystem: input.drmKeySystem ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: input.expiresAt,
    };

    return this.prisma.playbackSession.create({ data });
  }

  /** Look up a single session by its id (the `{sessionId}` marker). */
  async findById(id: string): Promise<PlaybackSession | null> {
    return this.prisma.playbackSession.findUnique({ where: { id } });
  }

  /**
   * Admin trace-back (Req 6.4): resolve which learner identity corresponds
   * to a forensic watermark/session marker. Ordered newest-first and
   * capped so a broad marker can never return an unbounded result set.
   */
  async findByViewerTag(
    viewerTag: string,
    opts: { take?: number } = {},
  ): Promise<PlaybackSession[]> {
    const take = Math.min(Math.max(1, opts.take ?? 50), 200);
    return this.prisma.playbackSession.findMany({
      where: { viewerTag },
      orderBy: { issuedAt: 'desc' },
      take,
    });
  }

  /**
   * Retention pruning (Req 6.2): delete session rows issued before the
   * cutoff. Returns the number of rows removed.
   */
  async deleteIssuedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.playbackSession.deleteMany({
      where: { issuedAt: { lt: cutoff } },
    });
    return count;
  }
}
