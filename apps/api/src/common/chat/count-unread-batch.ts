import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Batched unread-message count across many `ChatRoom`s in a single
 * query, each keyed by its own `lastReadAt` cutoff.
 *
 * Both `DmService.listThreads` and `GroupChatService.listMyGroups`
 * used to call `prisma.chatMessage.count()` once per room inside a
 * `Promise.all` — an inbox of 50 threads issued 50+ round-trips just
 * to render unread badges. Since every room has a *different*
 * `lastReadAt` cutoff, a plain `count({ where: { roomId: { in } } })`
 * can't replace the loop (it can't express "newer than X for room A,
 * newer than Y for room B" in one `WHERE`); this joins the room/cutoff
 * pairs in via a `VALUES` list instead, so Postgres does the
 * per-room filtering itself in one pass over `(roomId, createdAt)`.
 *
 * Rooms with zero unread messages are simply absent from the
 * returned map — callers should default to 0 on lookup miss.
 */
export async function countUnreadBatch(
  prisma: PrismaClient,
  entries: { roomId: string; lastReadAt: Date }[],
  excludeUserId: string,
): Promise<Map<string, number>> {
  if (entries.length === 0) return new Map();

  const values = Prisma.join(
    entries.map(
      (e) => Prisma.sql`(${e.roomId}::uuid, ${e.lastReadAt}::timestamptz)`,
    ),
    ', ',
  );

  const rows = await prisma.$queryRaw<{ roomId: string; unreadCount: bigint }[]>(
    Prisma.sql`
      SELECT cm."roomId" AS "roomId", COUNT(*)::bigint AS "unreadCount"
      FROM "ChatMessage" cm
      JOIN (VALUES ${values}) AS cutoffs("roomId", "lastReadAt")
        ON cm."roomId" = cutoffs."roomId"
      WHERE cm."authorId" != ${excludeUserId}::uuid
        AND cm."deletedAt" IS NULL
        AND cm."createdAt" > cutoffs."lastReadAt"
      GROUP BY cm."roomId"
    `,
  );

  const out = new Map<string, number>();
  for (const row of rows) out.set(row.roomId, Number(row.unreadCount));
  return out;
}
