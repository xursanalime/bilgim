import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GroupChatRole, PrismaClient } from '@prisma/client';

import {
  GROUP_CHAT_MAX_ATTACHMENT_SIZE_BYTES,
  GROUP_CHAT_DEFAULT_PAGE_SIZE,
  GROUP_CHAT_MAX_PAGE_SIZE,
  MAX_GROUP_MESSAGE_BODY_LENGTH,
} from './group-chat.constants';
import {
  GroupChatMessageRow,
  GroupChatRepository,
  GroupChatRoomRow,
} from './repositories/group-chat.repository';
import { countUnreadBatch } from '../../common/chat/count-unread-batch';
import { MESSAGE_EDIT_WINDOW_HOURS, isWithinEditWindow } from '../../common/chat/message-edit-window';
import { getReactionsForMessages, toggleReaction, type ReactionSummary } from '../../common/chat/reactions';
import { stripHtml } from '../../common/sanitization';
import { LiveChatGateway } from '../live/chat/live-chat.gateway';
import { R2Service } from '../../infra/r2/r2.service';
import { MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS } from '../media/media.service';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface GroupChatActor {
  userId: string;
  role: string;
}

export interface GroupChatMemberSummary {
  userId: string;
  role: GroupChatRole;
  joinedAt: Date;
  user: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    role: string;
  };
}

export interface GroupChatMessage {
  id: string;
  groupId: string;
  /** Per-room monotonic order, serialized as a string (JSON has no bigint). */
  seq: string;
  authorId: string;
  text: string;
  assetId: string | null;
  assetUrl?: string | null;
  /** Set when the author edited this message after sending; null otherwise. */
  editedAt: Date | null;
  /** Set while this message is pinned to the group; null otherwise. */
  pinnedAt: Date | null;
  /** Empty for messages returned outside `listMessages` (e.g. a fresh `sendMessage` result) — nothing has reacted yet. */
  reactions: ReactionSummary[];
  createdAt: Date;
}

export interface GroupChatSummary {
  groupId: string;
  name: string;
  hasAvatar: boolean;
  memberCount: number;
  myRole: GroupChatRole;
  lastMessage: GroupChatMessage | null;
  unreadCount: number;
  createdAt: Date;
}

export interface SendGroupMessageResult {
  message: GroupChatMessage;
}

@Injectable()
export class GroupChatService {
  private readonly logger = new Logger(GroupChatService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: GroupChatRepository,
    private readonly liveChatGateway: LiveChatGateway,
    private readonly r2: R2Service,
  ) {}

  // ------------------------------------------------------------------
  // Inbox
  // ------------------------------------------------------------------

  async listMyGroups(actor: GroupChatActor): Promise<GroupChatSummary[]> {
    this.assertActorAllowed(actor);

    const groupIds = await this.repo.listGroupIdsForUser(actor.userId);
    if (groupIds.length === 0) return [];

    const [groups, rooms] = await Promise.all([
      this.prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true, avatarAssetId: true },
      }),
      this.prisma.chatRoom.findMany({
        where: { scope: 'GROUP', scopeRef: { in: groupIds } },
        select: { id: true, scopeRef: true, createdAt: true },
      }),
    ]);
    const groupMap = new Map(groups.map((g) => [g.id, g]));
    const roomByGroup = new Map(rooms.map((r) => [r.scopeRef, r]));

    const memberRows = await this.prisma.groupChatMember.findMany({
      where: { groupId: { in: groupIds }, removedAt: null },
    });
    const myRoleByGroup = new Map(
      memberRows
        .filter((m) => m.userId === actor.userId)
        .map((m) => [m.groupId, m.role]),
    );
    const memberCountByGroup = new Map<string, number>();
    for (const m of memberRows) {
      memberCountByGroup.set(
        m.groupId,
        (memberCountByGroup.get(m.groupId) ?? 0) + 1,
      );
    }

    const roomIds = rooms.map((r) => r.id);
    const [latestByRoom, readReceipts] = await Promise.all([
      this.repo.findLatestMessagesByRoom(roomIds),
      this.prisma.dmReadReceipt.findMany({
        where: { userId: actor.userId, roomId: { in: roomIds } },
      }),
    ]);
    const readReceiptMap = new Map(readReceipts.map((r) => [r.roomId, r.lastReadAt]));

    // N+1 fix: one batched query for every group's unread count instead
    // of a `count()` per room — see `countUnreadBatch`.
    const unreadCountMap = await countUnreadBatch(
      this.prisma,
      roomIds.map((roomId) => ({
        roomId,
        lastReadAt: readReceiptMap.get(roomId) ?? new Date(0),
      })),
      actor.userId,
    );

    const summaries = groupIds.map((groupId) => {
      const group = groupMap.get(groupId);
      const room = roomByGroup.get(groupId);
      if (!group || !room) return null;

      const last = latestByRoom.get(room.id) ?? null;

      const summary: GroupChatSummary = {
        groupId,
        name: group.name,
        hasAvatar: !!group.avatarAssetId,
        memberCount: memberCountByGroup.get(groupId) ?? 0,
        myRole: myRoleByGroup.get(groupId) ?? 'MEMBER',
        lastMessage: last ? this.toGroupMessage(last, groupId) : null,
        unreadCount: unreadCountMap.get(room.id) ?? 0,
        createdAt: room.createdAt,
      };
      return summary;
    });

    return summaries
      .filter((s): s is GroupChatSummary => s !== null)
      .sort((a, b) => {
        const aTs = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
        const bTs = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
        return bTs - aTs;
      });
  }

  async getGroup(
    actor: GroupChatActor,
    groupId: string,
  ): Promise<GroupChatSummary> {
    this.assertActorAllowed(actor);
    const member = await this.assertMembership(groupId, actor.userId);

    const [group, room, activeMembers] = await Promise.all([
      this.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, avatarAssetId: true },
      }),
      this.repo.upsertRoomForGroup(groupId),
      this.repo.listActiveMembers(groupId),
    ]);
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }

    const last = (await this.repo.findLatestMessagesByRoom([room.id])).get(
      room.id,
    );
    const readReceipt = await this.prisma.dmReadReceipt.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: actor.userId } },
    });
    const lastReadAt = readReceipt?.lastReadAt ?? new Date(0);
    const unreadCount = await this.prisma.chatMessage.count({
      where: {
        roomId: room.id,
        authorId: { not: actor.userId },
        createdAt: { gt: lastReadAt },
        deletedAt: null,
      },
    });

    return {
      groupId,
      name: group.name,
      hasAvatar: !!group.avatarAssetId,
      memberCount: activeMembers.length,
      myRole: member.role,
      lastMessage: last ? this.toGroupMessage(last, groupId) : null,
      unreadCount,
      createdAt: room.createdAt,
    };
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async listMessages(
    actor: GroupChatActor,
    groupId: string,
    opts: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<CursorPage<GroupChatMessage>> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const room = await this.repo.upsertRoomForGroup(groupId);
    const pageSize = this.normalizePageSize(opts.pageSize);
    const seqCursor = this.normalizeSeqCursor(opts.cursor);

    const rows = await this.repo.listMessages(room.id, {
      cursor: seqCursor,
      pageSize,
    });

    // One batched query for the whole page's reactions instead of one
    // per message — see `getReactionsForMessages`.
    const reactionsByMessage = await getReactionsForMessages(
      this.prisma,
      rows.map((r) => r.id),
      actor.userId,
    );
    const items = rows.map((row) =>
      this.toGroupMessage(row, groupId, undefined, reactionsByMessage.get(row.id) ?? []),
    );
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === pageSize && last ? last.seq.toString() : null;

    return { items, nextCursor };
  }

  async sendMessage(
    actor: GroupChatActor,
    groupId: string,
    text: string,
    assetId?: string,
  ): Promise<SendGroupMessageResult> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const body = this.normalizeBody(text, !!assetId);
    if (assetId !== undefined) {
      await this.assertAttachmentAllowed(actor.userId, assetId);
    }

    const room = await this.repo.upsertRoomForGroup(groupId);
    const created = await this.repo.createMessage({
      roomId: room.id,
      authorId: actor.userId,
      body,
      ...(assetId !== undefined ? { assetId } : {}),
    });

    this.logger.log(
      `group-chat.message.sent group=${groupId} from=${actor.userId}`,
    );

    let assetUrl: string | null = null;
    if (created.assetId) {
      try {
        const asset = await this.prisma.mediaAsset.findUnique({
          where: { id: created.assetId },
        });
        if (asset?.originalKey) {
          assetUrl = await this.r2.signObjectGet(
            asset.originalKey,
            MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
          );
        }
      } catch (err) {
        this.logger.error(
          `Failed to sign asset ${created.assetId} for emission: ${(err as Error).message}`,
        );
      }
    }

    this.liveChatGateway.server
      .to(`lesson:group:${groupId}`)
      .emit('chat:message', {
        lessonId: `group:${groupId}`,
        senderId: actor.userId,
        text: body,
        assetId: created.assetId,
        assetUrl,
        ts: created.createdAt.getTime(),
        messageId: created.id,
      });

    return { message: this.toGroupMessage(created, groupId, assetUrl) };
  }

  // ------------------------------------------------------------------
  // Edit / delete
  // ------------------------------------------------------------------

  /**
   * Edit the text of a message the caller authored, within the 48h
   * edit window (Telegram parity). Unlike delete, editing is
   * author-only even for OWNER/ADMIN — moderators can remove abusive
   * content but shouldn't be able to put words in someone else's
   * mouth.
   */
  async editMessage(
    actor: GroupChatActor,
    groupId: string,
    messageId: string,
    text: string,
  ): Promise<GroupChatMessage> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const room = await this.repo.upsertRoomForGroup(groupId);
    const message = await this.repo.findMessageById(messageId);
    if (!message || message.roomId !== room.id) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }
    if (message.authorId !== actor.userId) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_EDIT_NOT_AUTHOR',
        message: 'You can only edit your own messages',
      });
    }
    if (!isWithinEditWindow(message.createdAt)) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_EDIT_WINDOW_EXPIRED',
        message: `Messages can only be edited within ${MESSAGE_EDIT_WINDOW_HOURS}h of sending`,
      });
    }

    const body = this.normalizeBody(text, !!message.assetId);
    const updated = await this.repo.updateMessageBody(messageId, body);
    const result = this.toGroupMessage(updated, groupId);

    this.liveChatGateway.server
      .to(`lesson:group:${groupId}`)
      .emit('chat:message-edited', {
        lessonId: `group:${groupId}`,
        messageId: updated.id,
        text: updated.body,
        editedAt: (updated.editedAt ?? new Date()).getTime(),
      });

    return result;
  }

  /**
   * Soft-delete a message. The author can always delete their own
   * message; OWNER/ADMIN can additionally delete any member's message
   * (moderation — Telegram-style admin takedown).
   */
  async deleteMessage(
    actor: GroupChatActor,
    groupId: string,
    messageId: string,
  ): Promise<void> {
    this.assertActorAllowed(actor);
    const member = await this.assertMembership(groupId, actor.userId);

    const room = await this.repo.upsertRoomForGroup(groupId);
    const message = await this.repo.findMessageById(messageId);
    if (!message || message.roomId !== room.id) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    const isModerator = member.role === 'OWNER' || member.role === 'ADMIN';
    if (message.authorId !== actor.userId && !isModerator) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_DELETE_FORBIDDEN',
        message: 'You can only delete your own messages',
      });
    }

    await this.repo.softDeleteMessage(messageId);

    this.liveChatGateway.server
      .to(`lesson:group:${groupId}`)
      .emit('chat:message-deleted', {
        lessonId: `group:${groupId}`,
        messageId,
      });
  }

  // ------------------------------------------------------------------
  // Reactions
  // ------------------------------------------------------------------

  /**
   * Toggle the caller's `emoji` reaction on a message: adds it if
   * absent, removes it if present. Any member may react to any
   * message — unlike edit/delete, reacting isn't author-restricted.
   */
  async toggleReaction(
    actor: GroupChatActor,
    groupId: string,
    messageId: string,
    emoji: string,
  ): Promise<{ added: boolean }> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const room = await this.repo.upsertRoomForGroup(groupId);
    const message = await this.repo.findMessageById(messageId);
    if (!message || message.roomId !== room.id) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    const result = await toggleReaction(
      this.prisma,
      messageId,
      actor.userId,
      emoji,
    );

    this.liveChatGateway.server
      .to(`lesson:group:${groupId}`)
      .emit('chat:reaction', {
        lessonId: `group:${groupId}`,
        messageId,
        emoji,
        userId: actor.userId,
        added: result.added,
      });

    return result;
  }

  // ------------------------------------------------------------------
  // Pin
  // ------------------------------------------------------------------

  /**
   * Toggle a message's pinned state. Restricted to OWNER/ADMIN
   * (moderation action) — unlike reactions, which any member can add.
   */
  async togglePin(
    actor: GroupChatActor,
    groupId: string,
    messageId: string,
  ): Promise<{ pinned: boolean; message: GroupChatMessage }> {
    this.assertActorAllowed(actor);
    await this.assertAdminOrOwner(groupId, actor.userId);

    const room = await this.repo.upsertRoomForGroup(groupId);
    const message = await this.repo.findMessageById(messageId);
    if (!message || message.roomId !== room.id) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    }

    const pinned = message.pinnedAt === null;
    const updated = pinned
      ? await this.repo.pinMessage(messageId, actor.userId)
      : await this.repo.unpinMessage(messageId);

    this.liveChatGateway.server
      .to(`lesson:group:${groupId}`)
      .emit('chat:message-pinned', {
        lessonId: `group:${groupId}`,
        messageId,
        pinned,
      });

    return { pinned, message: this.toGroupMessage(updated, groupId) };
  }

  /** Currently-pinned messages in a group, most recently pinned first. */
  async listPinnedMessages(
    actor: GroupChatActor,
    groupId: string,
  ): Promise<GroupChatMessage[]> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);
    const room = await this.repo.upsertRoomForGroup(groupId);
    const rows = await this.repo.listPinnedMessages(room.id);
    return rows.map((row) => this.toGroupMessage(row, groupId));
  }

  async markRead(actor: GroupChatActor, groupId: string): Promise<void> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);
    const room = await this.repo.upsertRoomForGroup(groupId);

    await this.prisma.dmReadReceipt.upsert({
      where: { roomId_userId: { roomId: room.id, userId: actor.userId } },
      update: { lastReadAt: new Date() },
      create: { roomId: room.id, userId: actor.userId, lastReadAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Membership management
  // ------------------------------------------------------------------

  async listMembers(
    actor: GroupChatActor,
    groupId: string,
  ): Promise<GroupChatMemberSummary[]> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const members = await this.repo.listActiveMembers(groupId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, username: true, fullName: true, avatarUrl: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return members.map((m) => {
      const u = userMap.get(m.userId);
      return {
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        user: {
          id: u?.id ?? m.userId,
          username: u?.username ?? '',
          fullName: u?.fullName ?? "Noma'lum foydalanuvchi",
          avatarUrl: u?.avatarUrl ?? null,
          role: u?.role ?? 'STUDENT',
        },
      };
    });
  }

  async addMember(
    actor: GroupChatActor,
    groupId: string,
    userId: string,
  ): Promise<void> {
    this.assertActorAllowed(actor);
    await this.assertAdminOrOwner(groupId, actor.userId);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (target.role !== 'TEACHER' && target.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ROLE_NOT_ALLOWED',
        message: 'Only teachers and students can join a group chat',
      });
    }

    await this.repo.upsertMember(groupId, userId, 'MEMBER');
  }

  async removeMember(
    actor: GroupChatActor,
    groupId: string,
    userId: string,
  ): Promise<void> {
    this.assertActorAllowed(actor);
    if (userId === actor.userId) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_USE_LEAVE',
        message: 'Use the leave endpoint to remove yourself from a group',
      });
    }
    const actorMember = await this.assertAdminOrOwner(groupId, actor.userId);
    const target = await this.repo.findActiveMember(groupId, userId);
    if (!target) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MEMBER_NOT_FOUND',
        message: 'This user is not a member of the group chat',
      });
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_CANNOT_REMOVE_OWNER',
        message: 'The group owner cannot be removed',
      });
    }
    if (target.role === 'ADMIN' && actorMember.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ADMIN_CANNOT_REMOVE_ADMIN',
        message: 'Only the owner can remove another admin',
      });
    }

    await this.repo.removeMember(groupId, userId);
  }

  async setRole(
    actor: GroupChatActor,
    groupId: string,
    userId: string,
    role: 'ADMIN' | 'MEMBER',
  ): Promise<void> {
    this.assertActorAllowed(actor);
    const actorMember = await this.assertMembership(groupId, actor.userId);
    if (actorMember.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_OWNER_ONLY',
        message: 'Only the group owner can change member roles',
      });
    }
    const target = await this.repo.findActiveMember(groupId, userId);
    if (!target) {
      throw new NotFoundException({
        code: 'GROUP_CHAT_MEMBER_NOT_FOUND',
        message: 'This user is not a member of the group chat',
      });
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_CANNOT_CHANGE_OWNER',
        message: 'Ownership transfer is not supported',
      });
    }

    await this.repo.setRole(groupId, userId, role);
  }

  async leaveGroup(actor: GroupChatActor, groupId: string): Promise<void> {
    this.assertActorAllowed(actor);
    const member = await this.assertMembership(groupId, actor.userId);
    if (member.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_OWNER_CANNOT_LEAVE',
        message: 'The group owner cannot leave the group chat',
      });
    }
    await this.repo.removeMember(groupId, actor.userId);
  }

  // ------------------------------------------------------------------
  // Avatar
  // ------------------------------------------------------------------

  async setAvatar(
    actor: GroupChatActor,
    groupId: string,
    assetId: string,
  ): Promise<void> {
    this.assertActorAllowed(actor);
    await this.assertAdminOrOwner(groupId, actor.userId);

    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { ownerUserId: true, kind: true, status: true },
    });
    if (!asset) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ASSET_NOT_FOUND',
        message: 'Uploaded image was not found',
      });
    }
    if (asset.ownerUserId !== actor.userId) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ASSET_NOT_OWNER',
        message: 'You can only use your own uploads as the group photo',
      });
    }
    if (asset.kind !== 'IMAGE') {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ASSET_NOT_IMAGE',
        message: 'Group photo must be an image',
      });
    }
    if (asset.status !== 'UPLOADED' && asset.status !== 'READY') {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ASSET_NOT_READY',
        message: 'Image upload is not complete',
      });
    }

    await this.prisma.group.update({
      where: { id: groupId },
      data: { avatarAssetId: assetId },
    });
  }

  async getAvatarUrl(
    actor: GroupChatActor,
    groupId: string,
  ): Promise<{ url: string | null }> {
    this.assertActorAllowed(actor);
    await this.assertMembership(groupId, actor.userId);

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { avatarAssetId: true },
    });
    if (!group?.avatarAssetId) return { url: null };

    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: group.avatarAssetId },
      select: { originalKey: true },
    });
    if (!asset?.originalKey) return { url: null };

    const url = await this.r2.signObjectGet(
      asset.originalKey,
      MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS,
    );
    return { url };
  }

  // ------------------------------------------------------------------
  // Access control
  // ------------------------------------------------------------------

  private assertActorAllowed(actor: GroupChatActor): void {
    if (actor.role !== 'TEACHER' && actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: `Role ${actor.role} cannot access the group chat service`,
      });
    }
  }

  private async assertMembership(groupId: string, userId: string) {
    const member = await this.repo.findActiveMember(groupId, userId);
    if (!member) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ACCESS_DENIED',
        message: 'You are not a member of this group chat',
      });
    }
    return member;
  }

  private async assertAdminOrOwner(groupId: string, userId: string) {
    const member = await this.assertMembership(groupId, userId);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ADMIN_REQUIRED',
        message: 'Only the group owner or an admin can do this',
      });
    }
    return member;
  }

  // ------------------------------------------------------------------
  // Attachments
  // ------------------------------------------------------------------

  private async assertAttachmentAllowed(
    ownerUserId: string,
    assetId: string,
  ): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        ownerUserId: true,
        bytes: true,
        status: true,
        kind: true,
        originalKey: true,
      },
    });

    if (!asset) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ASSET_NOT_FOUND',
        message: 'Attachment was not found',
      });
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({
        code: 'GROUP_CHAT_ASSET_NOT_OWNER',
        message: 'You can only send your own attachments',
      });
    }
    if (
      asset.bytes !== null &&
      asset.bytes > BigInt(GROUP_CHAT_MAX_ATTACHMENT_SIZE_BYTES)
    ) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ATTACHMENT_TOO_LARGE',
        message: 'Chat attachments must be 1 GB or smaller',
        maxBytes: GROUP_CHAT_MAX_ATTACHMENT_SIZE_BYTES,
      });
    }

    const failedVideoWithOriginal =
      asset.status === 'FAILED' &&
      asset.kind === 'VIDEO' &&
      Boolean(asset.originalKey);
    const sendable =
      asset.status === 'UPLOADED' ||
      asset.status === 'TRANSCODING' ||
      asset.status === 'READY' ||
      failedVideoWithOriginal;

    if (!sendable) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_ASSET_NOT_READY',
        message: 'Attachment upload is not complete',
      });
    }
  }

  // ------------------------------------------------------------------
  // Hydration / normalization helpers
  // ------------------------------------------------------------------

  private toGroupMessage(
    row: GroupChatMessageRow,
    groupId: string,
    assetUrl?: string | null,
    reactions: ReactionSummary[] = [],
  ): GroupChatMessage {
    return {
      id: row.id,
      groupId,
      seq: row.seq.toString(),
      authorId: row.authorId,
      text: row.body,
      assetId: row.assetId,
      assetUrl: assetUrl ?? null,
      editedAt: row.editedAt,
      pinnedAt: row.pinnedAt,
      reactions,
      createdAt: row.createdAt,
    };
  }

  private normalizeBody(text: string, allowEmpty = false): string {
    const s = stripHtml(text).trim();
    if (s.length === 0 && !allowEmpty) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_BODY_EMPTY',
        message: 'Message body cannot be empty',
      });
    }
    if (s.length > MAX_GROUP_MESSAGE_BODY_LENGTH) {
      throw new BadRequestException({
        code: 'GROUP_CHAT_BODY_TOO_LONG',
        message: `Body exceeds ${MAX_GROUP_MESSAGE_BODY_LENGTH} chars`,
      });
    }
    return s;
  }

  private normalizePageSize(size?: number): number {
    const n = Number(size);
    if (!Number.isFinite(n)) return GROUP_CHAT_DEFAULT_PAGE_SIZE;
    return Math.min(Math.max(1, n), GROUP_CHAT_MAX_PAGE_SIZE);
  }

  /** See `ChatMessage.seq` in `schema.prisma` for why message pagination is keyed on seq rather than `createdAt`. */
  private normalizeSeqCursor(cursor?: string): bigint | undefined {
    if (!cursor) return undefined;
    try {
      const n = BigInt(cursor);
      return n >= 0n ? n : undefined;
    } catch {
      return undefined;
    }
  }
}
