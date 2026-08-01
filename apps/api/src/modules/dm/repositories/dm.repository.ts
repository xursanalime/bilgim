import { Injectable } from '@nestjs/common';
import {
  ChatMessage,
  ChatRoom,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { nextRoomSeq } from '../../../common/chat/next-seq';

/**
 * `ChatRoom.scope` value used by the DM module. Reserved here so the
 * repository / service / tests share a single source of truth.
 */
export const DM_SCOPE = 'DM' as const;

/**
 * Build the canonical `ChatRoom.scopeRef` value for an unordered pair
 * of users. Sorts the two ids lexicographically so both orderings of
 * the same pair collapse onto a single row via the `(scope, scopeRef)`
 * UNIQUE constraint (Req 15.2).
 */
export function buildDmScopeRef(userIdA: string, userIdB: string): string {
  if (userIdA === userIdB) {
    throw new Error('A DM thread requires two distinct users');
  }
  return userIdA < userIdB
    ? `${userIdA}:${userIdB}`
    : `${userIdB}:${userIdA}`;
}

/**
 * Inverse of {@link buildDmScopeRef}: given a thread's `scopeRef` and
 * one of the participants, return the *other* user id. Throws when
 * the supplied viewer is not part of the encoded pair (defensive — the
 * service filters threads by participant before calling this helper).
 */
export function peerFromScopeRef(scopeRef: string, viewerId: string): string {
  const idx = scopeRef.indexOf(':');
  if (idx <= 0 || idx === scopeRef.length - 1) {
    throw new Error(`Malformed DM scopeRef: "${scopeRef}"`);
  }
  const left = scopeRef.slice(0, idx);
  const right = scopeRef.slice(idx + 1);
  if (left === viewerId) return right;
  if (right === viewerId) return left;
  throw new Error('Viewer is not a participant in this DM thread');
}

export interface DmThreadRow {
  id: string;
  scopeRef: string;
  createdAt: Date;
}

export interface DmMessageRow {
  id: string;
  roomId: string;
  seq: bigint;
  authorId: string;
  body: string;
  assetId: string | null;
  createdAt: Date;
}

/**
 * `DmRepository` — thin Prisma adapter for the Direct-Messaging
 * persistence model (Req 13.1, 13.2).
 *
 * Storage choices:
 *   - Threads are `ChatRoom` rows with `scope = "DM"` and a
 *     canonical sorted-pair `scopeRef`. The `(scope, scopeRef)`
 *     UNIQUE constraint guarantees one thread per pair.
 *   - Messages are `ChatMessage` rows attached to that thread. Soft
 *     deletes (`deletedAt`) are honoured by every read path so an
 *     admin redaction never surfaces.
 *
 * Conventions match the rest of the codebase: every mutating method
 * accepts an optional `Prisma.TransactionClient` so the service can
 * compose them with outbox writes inside a single `$transaction`.
 */
@Injectable()
export class DmRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // Threads
  // ------------------------------------------------------------------

  /**
   * Lazily create the DM thread for an unordered pair of users
   * (Req 13.1). `upsert` collapses two concurrent first-message
   * writes onto a single row instead of racing on the unique
   * constraint.
   */
  async upsertThreadForPair(
    userIdA: string,
    userIdB: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DmThreadRow> {
    const client = tx ?? this.prisma;
    const scopeRef = buildDmScopeRef(userIdA, userIdB);
    const row = await client.chatRoom.upsert({
      where: { scope_scopeRef: { scope: DM_SCOPE, scopeRef } },
      create: { scope: DM_SCOPE, scopeRef },
      update: {},
      select: { id: true, scopeRef: true, createdAt: true },
    });
    return row;
  }

  /** Look up a thread by id; returns `null` if it doesn't exist or is not a DM thread. */
  async findThreadById(
    threadId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DmThreadRow | null> {
    const client = tx ?? this.prisma;
    const row = await client.chatRoom.findFirst({
      where: { id: threadId, scope: DM_SCOPE },
      select: { id: true, scopeRef: true, createdAt: true },
    });
    return row ?? null;
  }

  /** Look up a thread by its canonical sorted-pair scopeRef. */
  async findThreadByPair(
    userIdA: string,
    userIdB: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DmThreadRow | null> {
    const client = tx ?? this.prisma;
    const scopeRef = buildDmScopeRef(userIdA, userIdB);
    const row = await client.chatRoom.findUnique({
      where: { scope_scopeRef: { scope: DM_SCOPE, scopeRef } },
      select: { id: true, scopeRef: true, createdAt: true },
    });
    return row ?? null;
  }

  /**
   * List all DM threads `userId` participates in. The caller's id is
   * matched against either half of the canonical sorted-pair
   * scopeRef. Sorting / pagination is left to the caller because it
   * depends on the latest message timestamp (cheaper to compute once
   * we've already fetched the rooms).
   *
   * Pagination cap (Task 24.2): default 100 / max 200 — most users
   * will never approach this, but the cap protects the inbox endpoint
   * from a pathological account with thousands of threads. The DM
   * service paginates the result set further once it has materialised
   * `lastMessage` for sorting.
   */
  async listThreadsForUser(
    userId: string,
    tx?: Prisma.TransactionClient,
    opts: { take?: number; skip?: number } = {},
  ): Promise<ChatRoom[]> {
    const client = tx ?? this.prisma;
    const take = Math.min(Math.max(1, opts.take ?? 100), 200);
    const skip = Math.max(0, opts.skip ?? 0);
    return client.chatRoom.findMany({
      where: {
        scope: DM_SCOPE,
        OR: [
          { scopeRef: { startsWith: `${userId}:` } },
          { scopeRef: { endsWith: `:${userId}` } },
        ],
      },
      take,
      skip,
    });
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async createMessage(
    input: { threadId: string; authorId: string; body: string; assetId?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<DmMessageRow> {
    const client = tx ?? this.prisma;
    const seq = await nextRoomSeq(client, input.threadId);
    return client.chatMessage.create({
      data: {
        roomId: input.threadId,
        seq,
        authorId: input.authorId,
        body: input.body,
        assetId: input.assetId ?? null,
      },
      select: {
        id: true,
        roomId: true,
        seq: true,
        authorId: true,
        body: true,
        assetId: true,
        createdAt: true,
      },
    });
  }

  /**
   * List messages in a thread, newest first. Pagination cursor is the
   * `seq` of the oldest already-seen message — not `createdAt`, which
   * can't tell apart two messages landing in the same millisecond (see
   * `ChatMessage.seq` in `schema.prisma`).
   */
  async listMessages(
    threadId: string,
    opts: { cursor?: bigint | undefined; pageSize: number },
    tx?: Prisma.TransactionClient,
  ): Promise<DmMessageRow[]> {
    const client = tx ?? this.prisma;
    return client.chatMessage.findMany({
      where: {
        roomId: threadId,
        deletedAt: null,
        ...(opts.cursor !== undefined ? { seq: { lt: opts.cursor } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: opts.pageSize,
      select: {
        id: true,
        roomId: true,
        seq: true,
        authorId: true,
        body: true,
        assetId: true,
        createdAt: true,
      },
    });
  }

  /**
   * Latest non-deleted message in a thread, or `null` if the thread
   * is empty. Used by `listThreadsForUser` to surface the inbox
   * "preview" line.
   */
  async findLatestMessage(
    threadId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<DmMessageRow | null> {
    const client = tx ?? this.prisma;
    return client.chatMessage.findFirst({
      where: { roomId: threadId, deletedAt: null },
      orderBy: { seq: 'desc' },
      select: {
        id: true,
        roomId: true,
        seq: true,
        authorId: true,
        body: true,
        assetId: true,
        createdAt: true,
      },
    });
  }

  /**
   * Latest non-deleted message for each thread in `threadIds`, keyed
   * by `roomId`. Threads without a (non-deleted) message are simply
   * absent from the result map.
   *
   * N+1 fix (Task 24.2): the inbox endpoint used to call
   * `findLatestMessage` once per thread, issuing N round-trips on a
   * paginated thread list. This batches the fan-out into a single
   * `findMany` over the requested `threadIds`, then keeps the first
   * row per thread (the largest `createdAt`).
   *
   * The implementation reads with `orderBy: seq desc`, deduping in JS
   * rather than `distinct on (roomId)` so the same code path works
   * against the SQLite-backed unit tests. With Postgres the planner
   * uses the `(roomId, seq)` index already covering the existing
   * `findLatestMessage` query.
   */
  async findLatestMessagesByThread(
    threadIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, DmMessageRow>> {
    if (threadIds.length === 0) return new Map();
    const client = tx ?? this.prisma;
    const rows = await client.chatMessage.findMany({
      where: { roomId: { in: threadIds }, deletedAt: null },
      orderBy: { seq: 'desc' },
      select: {
        id: true,
        roomId: true,
        seq: true,
        authorId: true,
        body: true,
        assetId: true,
        createdAt: true,
      },
    });
    const out = new Map<string, DmMessageRow>();
    for (const row of rows) {
      // Sorted desc — first row per `roomId` wins.
      if (!out.has(row.roomId)) {
        out.set(row.roomId, row);
      }
    }
    return out;
  }

  /**
   * `true` when `authorId` has at least one non-deleted message in
   * the thread. Drives the "both sides have spoken" check that
   * lifts the pre-reciprocation rate limit (Req 13.3).
   */
  async hasMessageFrom(
    threadId: string,
    authorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prisma;
    const row = await client.chatMessage.findFirst({
      where: { roomId: threadId, authorId, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }
}

export type { ChatMessage, ChatRoom };
