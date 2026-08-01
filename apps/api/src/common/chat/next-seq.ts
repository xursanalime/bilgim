import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Atomically allocate the next per-room message sequence number (see
 * `ChatRoom.lastSeq` / `ChatMessage.seq` doc comments in `schema.prisma`).
 *
 * `UPDATE ... SET "lastSeq" = "lastSeq" + 1 ... RETURNING "lastSeq"` is a
 * single statement, so Postgres serializes concurrent callers on the
 * row's lock — two sends racing for the same room can never be handed
 * the same seq, with no separate `$transaction` needed. If the caller's
 * subsequent `chatMessage.create` then fails, the allocated number is
 * simply never used (a gap, not a collision) — `seq` only needs to be
 * strictly increasing and unique, not contiguous.
 */
export async function nextRoomSeq(
  client: PrismaClient | Prisma.TransactionClient,
  roomId: string,
): Promise<bigint> {
  const rows = await client.$queryRaw<{ lastSeq: bigint }[]>(
    Prisma.sql`UPDATE "ChatRoom" SET "lastSeq" = "lastSeq" + 1 WHERE "id" = ${roomId}::uuid RETURNING "lastSeq"`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`ChatRoom ${roomId} not found while allocating a seq`);
  }
  return row.lastSeq;
}
