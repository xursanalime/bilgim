import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Per-(user, message) distinct-emoji cap. Without a limit, a single
 * user could react with every emoji on the keyboard on every message
 * — this bounds both the abuse surface and the render cost of a
 * message's reaction row.
 */
export const MAX_REACTIONS_PER_USER_PER_MESSAGE = 3;

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Whether the requesting user is among the reactors for this emoji. */
  reactedByMe: boolean;
}

/**
 * Toggle a user's reaction on a message: adds it if absent, removes it
 * if already present. Shared between `DmService` and `GroupChatService`
 * since both operate on the same `ChatMessage`/`MessageReaction` tables.
 *
 * Enforces {@link MAX_REACTIONS_PER_USER_PER_MESSAGE} only on the add
 * path — removing a reaction always succeeds regardless of how the cap
 * was reached (e.g. lowered after the fact).
 */
export async function toggleReaction(
  prisma: PrismaClient,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<{ added: boolean }> {
  const key = { messageId_userId_emoji: { messageId, userId, emoji } };
  const existing = await prisma.messageReaction.findUnique({ where: key });

  if (existing) {
    await prisma.messageReaction.delete({ where: key });
    return { added: false };
  }

  const distinctCount = await prisma.messageReaction.count({
    where: { messageId, userId },
  });
  if (distinctCount >= MAX_REACTIONS_PER_USER_PER_MESSAGE) {
    throw new BadRequestException({
      code: 'REACTION_LIMIT_REACHED',
      message: `You can only react with up to ${MAX_REACTIONS_PER_USER_PER_MESSAGE} different emoji per message`,
    });
  }

  await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
  return { added: true };
}

/**
 * Batched reaction summary for many messages in one query — a page of
 * 50 messages should cost one round-trip, not 50 (same principle as
 * `countUnreadBatch`). Messages with no reactions are simply absent
 * from the returned map; callers should default to `[]` on lookup miss.
 */
export async function getReactionsForMessages(
  prisma: PrismaClient,
  messageIds: string[],
  viewerId: string,
): Promise<Map<string, ReactionSummary[]>> {
  if (messageIds.length === 0) return new Map();

  const rows = await prisma.messageReaction.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, userId: true, emoji: true },
  });

  const byMessage = new Map<string, Map<string, ReactionSummary>>();
  for (const row of rows) {
    let byEmoji = byMessage.get(row.messageId);
    if (!byEmoji) {
      byEmoji = new Map();
      byMessage.set(row.messageId, byEmoji);
    }
    const entry = byEmoji.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      reactedByMe: false,
    };
    entry.count += 1;
    if (row.userId === viewerId) entry.reactedByMe = true;
    byEmoji.set(row.emoji, entry);
  }

  const out = new Map<string, ReactionSummary[]>();
  for (const [messageId, byEmoji] of byMessage) {
    out.set(messageId, Array.from(byEmoji.values()));
  }
  return out;
}
