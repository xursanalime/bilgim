import { Injectable } from '@nestjs/common';
import {
  ChatMessage,
  ChatRoom,
  GroupChatMember,
  GroupChatRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { nextRoomSeq } from '../../../common/chat/next-seq';
import { GROUP_CHAT_SCOPE } from '../group-chat.constants';

export interface GroupChatRoomRow {
  id: string;
  /** The Group.id this room is bound to. */
  scopeRef: string;
  createdAt: Date;
}

export interface GroupChatMessageRow {
  id: string;
  roomId: string;
  seq: bigint;
  authorId: string;
  body: string;
  assetId: string | null;
  editedAt: Date | null;
  createdAt: Date;
}

const MESSAGE_SELECT = {
  id: true,
  roomId: true,
  seq: true,
  authorId: true,
  body: true,
  assetId: true,
  editedAt: true,
  createdAt: true,
} as const;

/**
 * `GroupChatRepository` — thin Prisma adapter for the group-chat
 * persistence model (Telegram-style groups tied 1:1 to a course
 * `Group`/cohort).
 *
 * Storage choices, mirroring `DmRepository`:
 *   - Each group's chat is a `ChatRoom` row with `scope = "GROUP"` and
 *     `scopeRef = Group.id`. The `(scope, scopeRef)` UNIQUE constraint
 *     guarantees one room per group.
 *   - Messages are `ChatMessage` rows attached to that room, same
 *     shape/soft-delete semantics as DM.
 *   - Membership + role (OWNER/ADMIN/MEMBER) lives in the new
 *     `GroupChatMember` join table — unlike DM's 2-party scopeRef
 *     trick, group membership is N-ary and needs a real table.
 *
 * Every mutating method accepts an optional `Prisma.TransactionClient`
 * so callers in other modules (CatalogService on Group creation,
 * EnrollmentService on enrollment approval) can compose these writes
 * inside their own `$transaction`.
 */
@Injectable()
export class GroupChatRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ------------------------------------------------------------------
  // Room
  // ------------------------------------------------------------------

  async upsertRoomForGroup(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatRoomRow> {
    const client = tx ?? this.prisma;
    return client.chatRoom.upsert({
      where: { scope_scopeRef: { scope: GROUP_CHAT_SCOPE, scopeRef: groupId } },
      create: { scope: GROUP_CHAT_SCOPE, scopeRef: groupId },
      update: {},
      select: { id: true, scopeRef: true, createdAt: true },
    });
  }

  async findRoomByGroupId(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatRoomRow | null> {
    const client = tx ?? this.prisma;
    return client.chatRoom.findUnique({
      where: { scope_scopeRef: { scope: GROUP_CHAT_SCOPE, scopeRef: groupId } },
      select: { id: true, scopeRef: true, createdAt: true },
    });
  }

  // ------------------------------------------------------------------
  // Membership
  // ------------------------------------------------------------------

  async addOwner(
    groupId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMember> {
    const client = tx ?? this.prisma;
    return client.groupChatMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, role: 'OWNER' },
      update: { role: 'OWNER', removedAt: null },
    });
  }

  /** Add (or re-instate) a member with the given role. */
  async upsertMember(
    groupId: string,
    userId: string,
    role: GroupChatRole,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMember> {
    const client = tx ?? this.prisma;
    return client.groupChatMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, role },
      update: { removedAt: null },
    });
  }

  async findMember(
    groupId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMember | null> {
    const client = tx ?? this.prisma;
    return client.groupChatMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  async findActiveMember(
    groupId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMember | null> {
    const client = tx ?? this.prisma;
    return client.groupChatMember.findFirst({
      where: { groupId, userId, removedAt: null },
    });
  }

  async listActiveMembers(
    groupId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMember[]> {
    const client = tx ?? this.prisma;
    return client.groupChatMember.findMany({
      where: { groupId, removedAt: null },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** Group ids the user is an active member of (drives the inbox list). */
  async listGroupIdsForUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.groupChatMember.findMany({
      where: { userId, removedAt: null },
      select: { groupId: true },
    });
    return rows.map((r) => r.groupId);
  }

  async removeMember(
    groupId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.groupChatMember.updateMany({
      where: { groupId, userId, removedAt: null },
      data: { removedAt: new Date() },
    });
  }

  async setRole(
    groupId: string,
    userId: string,
    role: GroupChatRole,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.groupChatMember.updateMany({
      where: { groupId, userId, removedAt: null },
      data: { role },
    });
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async createMessage(
    input: { roomId: string; authorId: string; body: string; assetId?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMessageRow> {
    const client = tx ?? this.prisma;
    const seq = await nextRoomSeq(client, input.roomId);
    return client.chatMessage.create({
      data: {
        roomId: input.roomId,
        seq,
        authorId: input.authorId,
        body: input.body,
        assetId: input.assetId ?? null,
      },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * List messages in a room, newest first. Pagination cursor is the
   * `seq` of the oldest already-seen message — see `ChatMessage.seq`
   * in `schema.prisma` for why `createdAt` can't serve this role.
   */
  async listMessages(
    roomId: string,
    opts: { cursor?: bigint | undefined; pageSize: number },
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMessageRow[]> {
    const client = tx ?? this.prisma;
    return client.chatMessage.findMany({
      where: {
        roomId,
        deletedAt: null,
        ...(opts.cursor !== undefined ? { seq: { lt: opts.cursor } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: opts.pageSize,
      select: MESSAGE_SELECT,
    });
  }

  async findLatestMessagesByRoom(
    roomIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, GroupChatMessageRow>> {
    if (roomIds.length === 0) return new Map();
    const client = tx ?? this.prisma;
    const rows = await client.chatMessage.findMany({
      where: { roomId: { in: roomIds }, deletedAt: null },
      orderBy: { seq: 'desc' },
      select: MESSAGE_SELECT,
    });
    const out = new Map<string, GroupChatMessageRow>();
    for (const row of rows) {
      if (!out.has(row.roomId)) {
        out.set(row.roomId, row);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Edit / delete
  // ------------------------------------------------------------------

  /** A single non-deleted message by id, or `null`. Used by edit/delete to load the row before authorizing the action. */
  async findMessageById(
    messageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMessageRow | null> {
    const client = tx ?? this.prisma;
    const row = await client.chatMessage.findFirst({
      where: { id: messageId, deletedAt: null },
      select: MESSAGE_SELECT,
    });
    return row ?? null;
  }

  /** Soft-delete: sets `deletedAt` so every read path (list/latest) excludes it, without losing the row for audit. */
  async softDeleteMessage(
    messageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
  }

  /** Update a message's body and stamp `editedAt`. Caller (service) has already authorized the edit. */
  async updateMessageBody(
    messageId: string,
    body: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GroupChatMessageRow> {
    const client = tx ?? this.prisma;
    return client.chatMessage.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      select: MESSAGE_SELECT,
    });
  }
}

export type { ChatMessage, ChatRoom, GroupChatMember, GroupChatRole };
