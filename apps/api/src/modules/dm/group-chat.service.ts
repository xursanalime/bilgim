import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import { stripHtml } from '../../common/sanitization';
import { LiveChatGateway } from '../live/chat/live-chat.gateway';
import { MAX_DM_BODY_LENGTH, DM_MAX_ATTACHMENT_SIZE_BYTES } from './dm.constants';

const GROUP_SCOPE = 'group';
const MAX_TITLE_LENGTH = 80;
const MAX_GROUP_MEMBERS = 200;
const USERNAME_RE = /^[a-z0-9_]{4,32}$/;

export interface GroupMember {
  id: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
  role: string; // OWNER | ADMIN | MEMBER
}

export interface GroupMessage {
  id: string;
  roomId: string;
  authorId: string;
  author: { id: string; fullName: string; avatarUrl: string | null } | null;
  text: string;
  assetId: string | null;
  createdAt: Date;
}

export interface GroupSummary {
  id: string;
  title: string;
  username: string | null;
  avatarAssetId: string | null;
  inviteToken: string | null;
  createdById: string | null;
  memberCount: number;
  myRole: string;
  lastMessage: GroupMessage | null;
  unreadCount: number;
  createdAt: Date;
}

interface Actor {
  userId: string;
  role: string;
}

/**
 * GroupChatService — Telegram-style group conversations layered on top of the
 * existing `ChatRoom` / `ChatMessage` tables. A group is a `ChatRoom` with
 * `scope = 'group'`, a `title`, an owner (`createdById`) and a set of
 * `ChatRoomMember` rows (OWNER / ADMIN / MEMBER). Messages and read receipts
 * reuse the same generic tables as DMs.
 */
@Injectable()
export class GroupChatService {
  private readonly logger = new Logger(GroupChatService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly liveChatGateway: LiveChatGateway,
  ) {}

  private assertAllowed(actor: Actor): void {
    if (actor.role !== 'TEACHER' && actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: `Role ${actor.role} cannot access group chat`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async createGroup(
    actor: Actor,
    title: string,
    memberIds: string[],
  ): Promise<GroupSummary> {
    this.assertAllowed(actor);
    const cleanTitle = stripHtml(title).trim();
    if (cleanTitle.length === 0) {
      throw new BadRequestException({ code: 'GROUP_TITLE_EMPTY', message: 'Guruh nomi bo‘sh bo‘lmasligi kerak' });
    }
    if (cleanTitle.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException({ code: 'GROUP_TITLE_TOO_LONG', message: `Guruh nomi ${MAX_TITLE_LENGTH} belgidan oshmasin` });
    }

    // De-dupe + drop the creator from the member list (added as OWNER below).
    const uniqueMembers = [...new Set(memberIds)].filter((id) => id !== actor.userId);
    if (uniqueMembers.length > MAX_GROUP_MEMBERS) {
      throw new BadRequestException({ code: 'GROUP_TOO_MANY_MEMBERS', message: `Guruhda ko‘pi bilan ${MAX_GROUP_MEMBERS} a’zo bo‘lishi mumkin` });
    }

    // Validate members exist and are active.
    const validMembers = await this.prisma.user.findMany({
      where: { id: { in: uniqueMembers }, status: 'ACTIVE' },
      select: { id: true },
    });
    const validIds = new Set(validMembers.map((u) => u.id));

    const room = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatRoom.create({
        data: {
          scope: GROUP_SCOPE,
          scopeRef: randomUUID(),
          title: cleanTitle,
          createdById: actor.userId,
        },
      });
      await tx.chatRoomMember.create({
        data: { roomId: created.id, userId: actor.userId, role: 'OWNER' },
      });
      const others = [...validIds].map((userId) => ({
        roomId: created.id,
        userId,
        role: 'MEMBER',
      }));
      if (others.length > 0) {
        await tx.chatRoomMember.createMany({ data: others, skipDuplicates: true });
      }
      return created;
    });

    this.logger.log(`group.created id=${room.id} owner=${actor.userId} members=${validIds.size + 1}`);
    return this.toSummary(room.id, actor.userId);
  }

  // ------------------------------------------------------------------
  // List / get
  // ------------------------------------------------------------------

  async listGroups(actor: Actor): Promise<GroupSummary[]> {
    this.assertAllowed(actor);
    const memberships = await this.prisma.chatRoomMember.findMany({
      where: { userId: actor.userId, room: { scope: GROUP_SCOPE } },
      select: { roomId: true },
    });
    const summaries = await Promise.all(
      memberships.map((m) => this.toSummary(m.roomId, actor.userId)),
    );
    // Newest activity first.
    return summaries.sort((a, b) => {
      const at = a.lastMessage?.createdAt.getTime() ?? a.createdAt.getTime();
      const bt = b.lastMessage?.createdAt.getTime() ?? b.createdAt.getTime();
      return bt - at;
    });
  }

  async getGroup(actor: Actor, roomId: string): Promise<GroupSummary & { members: GroupMember[] }> {
    this.assertAllowed(actor);
    await this.assertMember(roomId, actor.userId);
    const summary = await this.toSummary(roomId, actor.userId);
    const members = await this.listMembers(roomId);
    return { ...summary, members };
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------

  async listMessages(
    actor: Actor,
    roomId: string,
    opts: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<{ items: GroupMessage[]; nextCursor: string | null }> {
    this.assertAllowed(actor);
    await this.assertMember(roomId, actor.userId);

    const pageSize = Math.min(Math.max(1, Number(opts.pageSize) || 30), 50);
    const cursor = opts.cursor ? new Date(opts.cursor) : undefined;

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        roomId,
        deletedAt: null,
        ...(cursor && !isNaN(cursor.getTime()) ? { createdAt: { lt: cursor } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
    });

    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const authors = await this.prisma.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, fullName: true, avatarUrl: true },
    });
    const authorMap = new Map(authors.map((a) => [a.id, a]));

    const items = rows.map((r) => this.toMessage(r, authorMap.get(r.authorId) ?? null));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === pageSize && last ? last.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async sendMessage(
    actor: Actor,
    roomId: string,
    text: string,
    assetId?: string,
  ): Promise<GroupMessage> {
    this.assertAllowed(actor);
    await this.assertMember(roomId, actor.userId);

    const body = stripHtml(text).trim();
    if (body.length === 0 && !assetId) {
      throw new BadRequestException({ code: 'GROUP_BODY_EMPTY', message: 'Xabar bo‘sh bo‘lmasligi kerak' });
    }
    if (body.length > MAX_DM_BODY_LENGTH) {
      throw new BadRequestException({ code: 'GROUP_BODY_TOO_LONG', message: `Xabar ${MAX_DM_BODY_LENGTH} belgidan oshmasin` });
    }

    if (assetId) {
      await this.assertAttachmentAllowed(actor.userId, assetId);
    }

    const created = await this.prisma.chatMessage.create({
      data: {
        roomId,
        authorId: actor.userId,
        body,
        ...(assetId ? { assetId } : {}),
      },
    });

    const author = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, fullName: true, avatarUrl: true },
    });

    // Real-time fan-out — reuse the live chat gateway room convention.
    this.liveChatGateway.server.to(`lesson:group:${roomId}`).emit('chat:message', {
      lessonId: `group:${roomId}`,
      senderId: actor.userId,
      text: body,
      assetId: created.assetId,
      ts: created.createdAt.getTime(),
      messageId: created.id,
    });

    return this.toMessage(created, author);
  }

  async markRead(actor: Actor, roomId: string): Promise<void> {
    this.assertAllowed(actor);
    await this.assertMember(roomId, actor.userId);
    await this.prisma.dmReadReceipt.upsert({
      where: { roomId_userId: { roomId, userId: actor.userId } },
      update: { lastReadAt: new Date() },
      create: { roomId, userId: actor.userId, lastReadAt: new Date() },
    });
  }

  // ------------------------------------------------------------------
  // Membership management
  // ------------------------------------------------------------------

  async addMembers(actor: Actor, roomId: string, userIds: string[]): Promise<GroupMember[]> {
    this.assertAllowed(actor);
    await this.assertManager(roomId, actor.userId);

    const unique = [...new Set(userIds)];
    const valid = await this.prisma.user.findMany({
      where: { id: { in: unique }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (valid.length > 0) {
      await this.prisma.chatRoomMember.createMany({
        data: valid.map((u) => ({ roomId, userId: u.id, role: 'MEMBER' })),
        skipDuplicates: true,
      });
    }
    return this.listMembers(roomId);
  }

  async removeMember(actor: Actor, roomId: string, targetUserId: string): Promise<void> {
    this.assertAllowed(actor);
    // Self-leave is always allowed; otherwise require manager rights.
    if (targetUserId !== actor.userId) {
      await this.assertManager(roomId, actor.userId);
    } else {
      await this.assertMember(roomId, actor.userId);
    }

    const target = await this.prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException({ code: 'GROUP_MEMBER_NOT_FOUND', message: 'A’zo topilmadi' });
    }
    if (target.role === 'OWNER') {
      throw new BadRequestException({ code: 'GROUP_OWNER_IMMUTABLE', message: 'Guruh egasini olib bo‘lmaydi' });
    }
    await this.prisma.chatRoomMember.delete({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
  }

  /** Promote/demote a member (OWNER only). Cannot change the owner. */
  async setMemberRole(actor: Actor, roomId: string, targetUserId: string, role: 'ADMIN' | 'MEMBER'): Promise<GroupMember[]> {
    this.assertAllowed(actor);
    const me = await this.prisma.chatRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: actor.userId } }, select: { role: true } });
    if (!me || me.role !== 'OWNER') {
      throw new ForbiddenException({ code: 'GROUP_OWNER_ONLY', message: 'Faqat guruh egasi rollarni o‘zgartira oladi' });
    }
    const target = await this.prisma.chatRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: targetUserId } } });
    if (!target) throw new NotFoundException({ code: 'GROUP_MEMBER_NOT_FOUND', message: 'A’zo topilmadi' });
    if (target.role === 'OWNER') throw new BadRequestException({ code: 'GROUP_OWNER_IMMUTABLE', message: 'Egasi rolini o‘zgartirib bo‘lmaydi' });
    await this.prisma.chatRoomMember.update({ where: { roomId_userId: { roomId, userId: targetUserId } }, data: { role } });
    return this.listMembers(roomId);
  }

  // ------------------------------------------------------------------
  // Group settings (title / username / avatar)
  // ------------------------------------------------------------------

  async updateSettings(
    actor: Actor,
    roomId: string,
    patch: { title?: string | undefined; username?: string | null | undefined; avatarAssetId?: string | null | undefined },
  ): Promise<GroupSummary> {
    this.assertAllowed(actor);
    await this.assertManager(roomId, actor.userId);

    const data: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      const t = stripHtml(patch.title).trim();
      if (t.length === 0 || t.length > MAX_TITLE_LENGTH) {
        throw new BadRequestException({ code: 'GROUP_TITLE_INVALID', message: `Guruh nomi 1–${MAX_TITLE_LENGTH} belgi bo‘lsin` });
      }
      data.title = t;
    }

    if (patch.username !== undefined) {
      if (patch.username === null || patch.username === '') {
        data.username = null;
      } else {
        const u = patch.username.trim().toLowerCase().replace(/^@/, '');
        if (!USERNAME_RE.test(u)) {
          throw new BadRequestException({ code: 'GROUP_USERNAME_INVALID', message: 'Username 4–32 ta kichik harf/raqam/_ bo‘lsin' });
        }
        const clash = await this.prisma.chatRoom.findFirst({ where: { username: u, id: { not: roomId } }, select: { id: true } });
        if (clash) {
          throw new BadRequestException({ code: 'GROUP_USERNAME_TAKEN', message: 'Bu username band' });
        }
        data.username = u;
      }
    }

    if (patch.avatarAssetId !== undefined) {
      if (patch.avatarAssetId === null) {
        data.avatarAssetId = null;
      } else {
        await this.assertAttachmentAllowed(actor.userId, patch.avatarAssetId, 'IMAGE');
        data.avatarAssetId = patch.avatarAssetId;
      }
    }

    await this.prisma.chatRoom.update({ where: { id: roomId }, data });
    return this.toSummary(roomId, actor.userId);
  }

  // ------------------------------------------------------------------
  // Invite links / join
  // ------------------------------------------------------------------

  async rotateInvite(actor: Actor, roomId: string): Promise<{ inviteToken: string }> {
    this.assertAllowed(actor);
    await this.assertManager(roomId, actor.userId);
    const token = randomUUID().replace(/-/g, '').slice(0, 22);
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { inviteToken: token } });
    return { inviteToken: token };
  }

  async revokeInvite(actor: Actor, roomId: string): Promise<void> {
    this.assertAllowed(actor);
    await this.assertManager(roomId, actor.userId);
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { inviteToken: null } });
  }

  /** Preview a group by invite token or @username (no membership required). */
  async preview(actor: Actor, opts: { token?: string; username?: string }): Promise<{ id: string; title: string; username: string | null; avatarAssetId: string | null; memberCount: number; isMember: boolean }> {
    this.assertAllowed(actor);
    const room = await this.findJoinable(opts);
    const [memberCount, mine] = await Promise.all([
      this.prisma.chatRoomMember.count({ where: { roomId: room.id } }),
      this.prisma.chatRoomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: actor.userId } }, select: { roomId: true } }),
    ]);
    return {
      id: room.id,
      title: room.title ?? 'Guruh',
      username: room.username,
      avatarAssetId: room.avatarAssetId,
      memberCount,
      isMember: Boolean(mine),
    };
  }

  /** Join a group via invite token or @username. */
  async join(actor: Actor, opts: { token?: string; username?: string }): Promise<GroupSummary> {
    this.assertAllowed(actor);
    const room = await this.findJoinable(opts);
    await this.prisma.chatRoomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: actor.userId } },
      update: {},
      create: { roomId: room.id, userId: actor.userId, role: 'MEMBER' },
    });
    return this.toSummary(room.id, actor.userId);
  }

  private async findJoinable(opts: { token?: string; username?: string }) {
    const where = opts.token
      ? { inviteToken: opts.token }
      : opts.username
        ? { username: opts.username.trim().toLowerCase().replace(/^@/, '') }
        : null;
    if (!where) {
      throw new BadRequestException({ code: 'GROUP_JOIN_BAD_REQUEST', message: 'Token yoki username kerak' });
    }
    const room = await this.prisma.chatRoom.findFirst({ where: { ...where, scope: GROUP_SCOPE } });
    if (!room) {
      throw new NotFoundException({ code: 'GROUP_NOT_FOUND', message: 'Guruh topilmadi yoki havola eskirgan' });
    }
    return room;
  }

  // ------------------------------------------------------------------
  // Attachment validation (shared with avatar)
  // ------------------------------------------------------------------

  private async assertAttachmentAllowed(ownerUserId: string, assetId: string, requireKind?: 'IMAGE'): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { ownerUserId: true, bytes: true, status: true, kind: true, originalKey: true },
    });
    if (!asset) {
      throw new BadRequestException({ code: 'GROUP_ASSET_NOT_FOUND', message: 'Fayl topilmadi' });
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: 'GROUP_ASSET_NOT_OWNER', message: 'Faqat o‘z faylingizni yuborishingiz mumkin' });
    }
    if (requireKind && asset.kind !== requireKind) {
      throw new BadRequestException({ code: 'GROUP_ASSET_WRONG_KIND', message: 'Rasm fayli kerak' });
    }
    if (asset.bytes !== null && asset.bytes > BigInt(DM_MAX_ATTACHMENT_SIZE_BYTES)) {
      throw new BadRequestException({ code: 'GROUP_ATTACHMENT_TOO_LARGE', message: 'Fayl 1 GB dan oshmasligi kerak', maxBytes: DM_MAX_ATTACHMENT_SIZE_BYTES });
    }
    const failedVideoWithOriginal = asset.status === 'FAILED' && asset.kind === 'VIDEO' && Boolean(asset.originalKey);
    const sendable = asset.status === 'UPLOADED' || asset.status === 'TRANSCODING' || asset.status === 'READY' || failedVideoWithOriginal;
    if (!sendable) {
      throw new BadRequestException({ code: 'GROUP_ASSET_NOT_READY', message: 'Fayl yuklash tugamagan' });
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async assertMember(roomId: string, userId: string): Promise<void> {
    const m = await this.prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    if (!m) {
      throw new ForbiddenException({ code: 'GROUP_NOT_MEMBER', message: 'Siz bu guruh a’zosi emassiz' });
    }
  }

  private async assertManager(roomId: string, userId: string): Promise<void> {
    const m = await this.prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    if (!m || (m.role !== 'OWNER' && m.role !== 'ADMIN')) {
      throw new ForbiddenException({ code: 'GROUP_NOT_MANAGER', message: 'Bu amal uchun ruxsat yo‘q' });
    }
  }

  private async listMembers(roomId: string): Promise<GroupMember[]> {
    const rows = await this.prisma.chatRoomMember.findMany({
      where: { roomId },
      include: { user: { select: { id: true, fullName: true, username: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({
      id: r.user.id,
      fullName: r.user.fullName,
      username: r.user.username ?? '',
      avatarUrl: r.user.avatarUrl,
      role: r.role,
    }));
  }

  private async toSummary(roomId: string, callerId: string): Promise<GroupSummary> {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({ code: 'GROUP_NOT_FOUND', message: 'Guruh topilmadi' });
    }
    const [memberCount, myMembership, lastRow, receipt] = await Promise.all([
      this.prisma.chatRoomMember.count({ where: { roomId } }),
      this.prisma.chatRoomMember.findUnique({ where: { roomId_userId: { roomId, userId: callerId } }, select: { role: true } }),
      this.prisma.chatMessage.findFirst({ where: { roomId, deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.dmReadReceipt.findUnique({ where: { roomId_userId: { roomId, userId: callerId } } }),
    ]);

    let lastMessage: GroupMessage | null = null;
    if (lastRow) {
      const author = await this.prisma.user.findUnique({
        where: { id: lastRow.authorId },
        select: { id: true, fullName: true, avatarUrl: true },
      });
      lastMessage = this.toMessage(lastRow, author);
    }

    const lastReadAt = receipt?.lastReadAt ?? new Date(0);
    const unreadCount = await this.prisma.chatMessage.count({
      where: { roomId, authorId: { not: callerId }, deletedAt: null, createdAt: { gt: lastReadAt } },
    });

    return {
      id: room.id,
      title: room.title ?? 'Guruh',
      username: room.username,
      avatarAssetId: room.avatarAssetId,
      // Invite token is only exposed to managers (owner/admin).
      inviteToken: myMembership?.role === 'OWNER' || myMembership?.role === 'ADMIN' ? room.inviteToken : null,
      createdById: room.createdById,
      memberCount,
      myRole: myMembership?.role ?? 'MEMBER',
      lastMessage,
      unreadCount,
      createdAt: room.createdAt,
    };
  }

  private toMessage(
    row: { id: string; roomId: string; authorId: string; body: string; assetId: string | null; createdAt: Date },
    author: { id: string; fullName: string; avatarUrl: string | null } | null,
  ): GroupMessage {
    return {
      id: row.id,
      roomId: row.roomId,
      authorId: row.authorId,
      author: author ? { id: author.id, fullName: author.fullName, avatarUrl: author.avatarUrl } : null,
      text: row.body,
      assetId: row.assetId,
      createdAt: row.createdAt,
    };
  }
}
