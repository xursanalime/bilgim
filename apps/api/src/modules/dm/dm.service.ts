import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, User, ChatRoom, ChatMessage, MediaKind } from '@prisma/client';

import {
  DM_DEFAULT_PAGE_SIZE,
  DM_MAX_ATTACHMENT_SIZE_BYTES,
  DM_MAX_PAGE_SIZE,
  DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT,
  DM_PRE_RECIPROCATION_WINDOW_SECONDS,
  MAX_DM_BODY_LENGTH,
  dmRateLimitKey,
} from './dm.constants';
import {
  DmRepository,
  DmThreadRow,
  DmMessageRow,
  peerFromScopeRef,
} from './repositories/dm.repository';
import { stripHtml } from '../../common/sanitization';
import { LiveChatGateway } from '../live/chat/live-chat.gateway';
import { MediaAccessService } from '../media/media-access.service';
import { R2Service } from '../../infra/r2/r2.service';
import { MEDIA_PLAYBACK_DEFAULT_TTL_SECONDS } from '../media/media.service';
import { RedisService } from '../../infra/redis/redis.service';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DmActor {
  userId: string;
  role: string;
}

export interface DmPeer {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
}

export interface DmThreadSummary {
  /** Thread (`ChatRoom`) id. */
  id: string;
  /** The peer user's id (the user that is *not* the caller). */
  peerId: string;
  /** Hydrated peer user details. */
  peer: DmPeer;
  /** True when both users have sent at least one message. */
  reciprocated: boolean;
  /** The most recent message in the thread, or `null` for empty threads. */
  lastMessage: DmMessage | null;
  /** Number of unread messages in this thread for the caller. */
  unreadCount: number;
  /** When the thread was created. */
  createdAt: Date;
}

export interface DmUnreadCount {
  count: number;
}

export interface DmMessage {
  id: string;
  threadId: string;
  authorId: string;
  text: string;
  assetId: string | null;
  assetUrl?: string | null;
  createdAt: Date;
}

export interface OpenThreadResult {
  thread: DmThreadSummary;
  /** True if the thread was created by this call (vs already existing). */
  created: boolean;
  /** True iff the recipient had already replied before this message. */
  reciprocated: boolean;
}

export interface SendMessageResult {
  message: DmMessage;
  /** True iff the recipient had already replied before this message. */
  reciprocated: boolean;
  /**
   * True iff this message is the very first reciprocation in the thread
   * (e.g. the first time the recipient replied to the initiator).
   */
  becameReciprocated: boolean;
}

@Injectable()
export class DmService {
  private readonly logger = new Logger(DmService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: DmRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly liveChatGateway: LiveChatGateway,
    private readonly mediaAccess: MediaAccessService,
    private readonly r2: R2Service,
  ) {}

  // ------------------------------------------------------------------
  // Threads (Inbox)
  // ------------------------------------------------------------------

  /**
   * Resolve (or lazily create) a DM thread with `recipientId` (Req 13.1).
   */
  async openThread(
    actor: DmActor,
    recipientId: string,
  ): Promise<OpenThreadResult> {
    this.assertActorAllowed(actor);

    if (actor.userId === recipientId) {
      throw new BadRequestException({
        code: 'DM_SELF_FORBIDDEN',
        message: 'You cannot message yourself',
      });
    }

    // Check if the two users are actually allowed to see each other.
    await this.assertMutuallyVisible(actor.userId, recipientId);

    const existing = await this.repo.findThreadByPair(
      actor.userId,
      recipientId,
    );
    if (existing) {
      const summary = await this.toThreadSummary(existing, actor.userId);
      return {
        thread: summary,
        created: false,
        reciprocated: summary.reciprocated,
      };
    }

    // Lazy creation.
    const created = await this.repo.upsertThreadForPair(
      actor.userId,
      recipientId,
    );
    const summary = await this.toThreadSummary(created, actor.userId);
    return {
      thread: summary,
      created: true,
      reciprocated: false,
    };
  }

  async listThreads(
    actor: DmActor,
    opts: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<CursorPage<DmThreadSummary>> {
    this.assertActorAllowed(actor);

    const pageSize = this.normalizePageSize(opts.pageSize);
    const cursorDate = this.normalizeCursor(opts.cursor);
    const rooms = await this.repo.listThreadsForUser(actor.userId);

    // N+1 fix (Task 24.2): one `findMany` over every thread's id
    // returns the latest message for the whole inbox, instead of
    // calling `findLatestMessage` per row.
    const latestByThread = await this.repo.findLatestMessagesByThread(
      rooms.map((r) => r.id),
    );
    const enriched = rooms.map((room) => ({
      room,
      last: latestByThread.get(room.id) ?? null,
    }));

    enriched.sort((a, b) => {
      const aTs = a.last?.createdAt.getTime() ?? a.room.createdAt.getTime();
      const bTs = b.last?.createdAt.getTime() ?? b.room.createdAt.getTime();
      return bTs - aTs;
    });

    const filtered = cursorDate
      ? enriched.filter(({ last, room }) => {
          const ts = (last?.createdAt ?? room.createdAt).getTime();
          return ts < cursorDate.getTime();
        })
      : enriched;

    const sliced = filtered.slice(0, pageSize + 1);
    const hasMore = sliced.length > pageSize;
    const kept = hasMore ? sliced.slice(0, pageSize) : sliced;

    const peerIds = kept.map(({ room }) => peerFromScopeRef(room.scopeRef, actor.userId));
    const peers = await this.prisma.user.findMany({
      where: { id: { in: peerIds } },
      select: { id: true, username: true, fullName: true, avatarUrl: true, role: true },
    });
    const peerMap = new Map(peers.map(p => [p.id, p]));

    const readReceipts = await this.prisma.dmReadReceipt.findMany({
      where: {
        userId: actor.userId,
        roomId: { in: kept.map(k => k.room.id) }
      }
    });
    const readReceiptMap = new Map(readReceipts.map(r => [r.roomId, r.lastReadAt]));

    const items: DmThreadSummary[] = await Promise.all(
      kept.map(async ({ room, last }) => {
        const peerId = peerFromScopeRef(room.scopeRef, actor.userId);
        const peer = peerMap.get(peerId);
        const reciprocated = await this.computeReciprocated(
          room.id,
          actor.userId,
          peerId,
        );

        const lastReadAt = readReceiptMap.get(room.id) ?? new Date(0);
        const unreadCount = await this.prisma.chatMessage.count({
          where: {
            roomId: room.id,
            authorId: { not: actor.userId },
            createdAt: { gt: lastReadAt },
            deletedAt: null,
          }
        });

        return {
          id: room.id,
          peerId,
          peer: {
            id: peer?.id ?? peerId,
            username: peer?.username ?? '',
            fullName: peer?.fullName ?? 'Unknown User',
            avatarUrl: peer?.avatarUrl ?? null,
            role: peer?.role ?? 'STUDENT',
          },
          reciprocated,
          lastMessage: last ? this.toDmMessage(last) : null,
          unreadCount,
          createdAt: room.createdAt,
        };
      }),
    );

    const lastKept = kept[kept.length - 1];
    const nextCursor =
      hasMore && lastKept
        ? (lastKept.last?.createdAt ?? lastKept.room.createdAt).toISOString()
        : null;

    return { items, nextCursor };
  }

  /**
   * Get total unread message count for a user across all DM threads.
   */
  async getUnreadCount(actor: DmActor): Promise<DmUnreadCount> {
    this.assertActorAllowed(actor);

    const rooms = await this.repo.listThreadsForUser(actor.userId);
    const readReceipts = await this.prisma.dmReadReceipt.findMany({
      where: { userId: actor.userId },
    });
    const readReceiptMap = new Map(
      readReceipts.map((r) => [r.roomId, r.lastReadAt]),
    );

    let totalUnread = 0;
    const unreadCounts = await Promise.all(
      rooms.map(async (room) => {
        const lastReadAt = readReceiptMap.get(room.id) ?? new Date(0);
        return this.prisma.chatMessage.count({
          where: {
            roomId: room.id,
            authorId: { not: actor.userId },
            createdAt: { gt: lastReadAt },
            deletedAt: null,
          },
        });
      }),
    );

    totalUnread = unreadCounts.reduce((a, b) => a + b, 0);
    return { count: totalUnread };
  }

  /**
   * Mark all messages in a thread as read.
   */
  async markRead(actor: DmActor, threadId: string): Promise<void> {
    this.assertActorAllowed(actor);
    const { thread } = await this.resolveParticipantThread(
      actor.userId,
      threadId,
    );

    await this.prisma.dmReadReceipt.upsert({
      where: {
        roomId_userId: {
          roomId: thread.id,
          userId: actor.userId,
        },
      },
      update: { lastReadAt: new Date() },
      create: {
        roomId: thread.id,
        userId: actor.userId,
        lastReadAt: new Date(),
      },
    });
  }

  /**
   * Get a single DM thread by id.
   */
  async getThread(actor: DmActor, threadId: string): Promise<DmThreadSummary> {
    this.assertActorAllowed(actor);
    const { thread } = await this.resolveParticipantThread(
      actor.userId,
      threadId,
    );
    return this.toThreadSummary(thread, actor.userId);
  }

  /**
   * List messages in a thread the caller participates in (Req 13.2).
   */
  async listMessages(
    actor: DmActor,
    threadId: string,
    opts: { cursor?: string | undefined; pageSize?: number | undefined },
  ): Promise<CursorPage<DmMessage>> {
    this.assertActorAllowed(actor);
    const { thread } = await this.resolveParticipantThread(
      actor.userId,
      threadId,
    );

    const pageSize = this.normalizePageSize(opts.pageSize);
    const cursorDate = this.normalizeCursor(opts.cursor);

    const rows = await this.repo.listMessages(thread.id, {
      cursor: cursorDate,
      pageSize,
    });

    const items = rows.map((row) => this.toDmMessage(row));
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === pageSize && last ? last.createdAt.toISOString() : null;

    return { items, nextCursor };
  }

  // ------------------------------------------------------------------
  // Sending (Req 13.3)
  // ------------------------------------------------------------------

  /**
   * Send a DM to an existing thread (Req 13.3). Enforces the pre-
   * reciprocation rate limit (Property 11).
   */
  async sendMessage(
    actor: DmActor,
    threadId: string,
    text: string,
    assetId?: string,
  ): Promise<SendMessageResult> {
    this.assertActorAllowed(actor);
    const body = this.normalizeBody(text, !!assetId);
    const { thread, peerId } = await this.resolveParticipantThread(
      actor.userId,
      threadId,
    );

    // Re-confirm visibility on every send. The student might have
    // unenrolled and the teacher might have hidden their profile —
    // we don't want to keep the DM channel open after that.
    await this.assertMutuallyVisible(actor.userId, peerId);

    if (assetId !== undefined) {
      await this.assertAttachmentAllowed(actor.userId, assetId);
    }

    const peerHasReplied = await this.repo.hasMessageFrom(thread.id, peerId);
    const callerHasSent = await this.repo.hasMessageFrom(
      thread.id,
      actor.userId,
    );

    if (!peerHasReplied) {
      await this.assertWithinPreReciprocationLimit(actor.userId, peerId);
    } else {
      // Reciprocated: clear the directional Redis counter so the
      // peer's quota also resets next time they initiate. Best-
      // effort; failure is logged but not fatal.
      await this.bestEffortClearRateCounter(actor.userId, peerId);
      await this.bestEffortClearRateCounter(peerId, actor.userId);
    }

    const created = await this.repo.createMessage({
      threadId: thread.id,
      authorId: actor.userId,
      body,
      ...(assetId !== undefined ? { assetId } : {}),
    });

    if (!peerHasReplied) {
      // Increment *after* successful insert so a failed write does not
      // erode the caller's quota.
      await this.bumpPreReciprocationCounter(actor.userId, peerId);
    }

    const becameReciprocated = peerHasReplied && !callerHasSent;
    if (becameReciprocated) {
      // First reply: drop the *peer's* counter so the relaxed limit
      // takes effect immediately.
      await this.bestEffortClearRateCounter(peerId, actor.userId);
    }

    this.logger.log(
      `dm.message.sent thread=${thread.id} from=${actor.userId} to=${peerId} reciprocated=${peerHasReplied}`,
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
        this.logger.error(`Failed to sign asset ${created.assetId} for emission: ${(err as Error).message}`);
      }
    }

    // Emit real-time signal via the live gateway.
    this.liveChatGateway.server
      .to(`lesson:dm:${thread.id}`)
      .emit('chat:message', {
        lessonId: `dm:${thread.id}`,
        senderId: actor.userId,
        text: body,
        assetId: created.assetId,
        assetUrl,
        ts: created.createdAt.getTime(),
        messageId: created.id,
      });

    return {
      message: this.toDmMessage(created, assetUrl),
      reciprocated: peerHasReplied,
      becameReciprocated,
    };
  }

  // ------------------------------------------------------------------
  // Access control
  // ------------------------------------------------------------------

  private assertActorAllowed(actor: DmActor): void {
    if (actor.role !== 'TEACHER' && actor.role !== 'STUDENT') {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: `Role ${actor.role} cannot access the DM service`,
      });
    }
  }

  /**
   * Resolve a thread id to a thread row + peer id, ensuring the
   * caller is one of the participants.
   */
  private async resolveParticipantThread(
    callerId: string,
    threadId: string,
  ): Promise<{ thread: DmThreadRow; peerId: string }> {
    const thread = await this.repo.findThreadById(threadId);
    if (!thread) {
      throw new NotFoundException({
        code: 'DM_THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    let peerId: string;
    try {
      peerId = peerFromScopeRef(thread.scopeRef, callerId);
    } catch {
      throw new ForbiddenException({
        code: 'DM_ACCESS_DENIED',
        message: 'You are not a participant in this thread',
      });
    }

    return { thread, peerId };
  }

  /**
   * Verify that two users are allowed to interact.
   *  - TEACHER + STUDENT: only if teacher has a public profile (Req 15.3).
   *  - STUDENT + STUDENT: never allowed.
   *  - TEACHER + TEACHER: never allowed (reserved for future Phase 6).
   */
  private async assertMutuallyVisible(
    userIdA: string,
    userIdB: string,
  ): Promise<void> {
    const [userA, userB] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userIdA },
        select: { id: true, role: true, status: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userIdB },
        select: { id: true, role: true, status: true },
      }),
    ]);

    if (!userA || !userB) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'One of the participants no longer exists',
      });
    }

    if (userA.status !== 'ACTIVE' || userB.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'DM_VISIBILITY_FAILED',
        message: 'Both users must be active to exchange messages',
      });
    }

    // Role-based visibility (Req 15.3)
    const roles = new Set([userA.role, userB.role]);
    
    // ADMIN is never allowed in DMs
    if (roles.has('ADMIN')) {
      throw new ForbiddenException({
        code: 'DM_VISIBILITY_FAILED',
        message: 'Administrators cannot participate in direct messages',
      });
    }

    // STUDENT + STUDENT is forbidden
    if (userA.role === 'STUDENT' && userB.role === 'STUDENT') {
      throw new ForbiddenException({
        code: 'DM_VISIBILITY_FAILED',
        message: 'Students cannot message other students directly',
      });
    }

    // TEACHER + TEACHER is forbidden
    if (userA.role === 'TEACHER' && userB.role === 'TEACHER') {
      throw new ForbiddenException({
        code: 'DM_VISIBILITY_FAILED',
        message: 'Teachers cannot message other teachers directly',
      });
    }

    // TEACHER + STUDENT: require teacher public profile OR existing enrollment
    const teacherId = userA.role === 'TEACHER' ? userA.id : userB.id;
    const studentId = userA.role === 'STUDENT' ? userA.id : userB.id;

    const [profile, enrollment] = await Promise.all([
      this.prisma.teacherProfile.findUnique({
        where: { userId: teacherId },
        select: { publicSlug: true },
      }),
      this.prisma.enrollment.findFirst({
        where: {
          studentId,
          group: { course: { teacherId } },
          status: 'APPROVED',
        },
        select: { id: true },
      }),
    ]);

    if (!profile?.publicSlug && !enrollment) {
      // Visibility requirement: students can only message teachers
      // with a public profile OR if they are enrolled in the teacher's course.
      throw new ForbiddenException({
        code: 'DM_VISIBILITY_FAILED',
        message: 'This teacher does not accept direct messages',
      });
    }
  }

  // ------------------------------------------------------------------
  // Rate limiting (Pre-reciprocation)
  // ------------------------------------------------------------------

  private async assertWithinPreReciprocationLimit(
    senderId: string,
    recipientId: string,
  ): Promise<void> {
    const key = dmRateLimitKey(senderId, recipientId);
    const raw = await this.redis.get(key);
    const count = Number(raw ?? '0');

    if (!this.config) {
       this.logger.error(`config is NULL! this keys=${Object.keys(this)}`);
    }

    const limit = this.config.get<number>(
      'DM_PRE_RECIPROCATION_LIMIT',
      DM_PRE_RECIPROCATION_DAILY_LIMIT_DEFAULT,
    );

    if (count >= limit) {
      throw new HttpException(
        {
          code: 'DM_RATE_LIMITED',
          message: `You have reached the limit of ${limit} unreciprocated messages to this user today.`,
          limit,
          windowSeconds: DM_PRE_RECIPROCATION_WINDOW_SECONDS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async bumpPreReciprocationCounter(
    senderId: string,
    recipientId: string,
  ): Promise<void> {
    const key = dmRateLimitKey(senderId, recipientId);
    await this.redis.incr(key);
    await this.redis.expire(key, DM_PRE_RECIPROCATION_WINDOW_SECONDS);
  }

  private async bestEffortClearRateCounter(
    senderId: string,
    recipientId: string,
  ): Promise<void> {
    const key = dmRateLimitKey(senderId, recipientId);
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(
        `Failed to clear DM rate counter ${key}: ${(err as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Hydration helpers
  // ------------------------------------------------------------------

  /**
   * Hydrate a thread row with its peer / latest message metadata for
   * inclusion in `OpenThreadResult`.
   */
  private async toThreadSummary(
    thread: DmThreadRow,
    callerId: string,
  ): Promise<DmThreadSummary> {
    const peerId = peerFromScopeRef(thread.scopeRef, callerId);
    const [last, reciprocated, peer, unreadCount] = await Promise.all([
      this.repo.findLatestMessage(thread.id),
      this.computeReciprocated(thread.id, callerId, peerId),
      this.prisma.user.findUnique({
        where: { id: peerId },
        select: { id: true, username: true, fullName: true, avatarUrl: true, role: true },
      }),
      this.prisma.dmReadReceipt.findUnique({
        where: { roomId_userId: { roomId: thread.id, userId: callerId } }
      }).then(async (r) => {
        const lastReadAt = r?.lastReadAt ?? new Date(0);
        return this.prisma.chatMessage.count({
          where: {
            roomId: thread.id,
            authorId: { not: callerId },
            createdAt: { gt: lastReadAt },
            deletedAt: null,
          }
        });
      })
    ]);
    return {
      id: thread.id,
      peerId,
      peer: {
        id: peer?.id ?? peerId,
        username: peer?.username ?? '',
        fullName: peer?.fullName ?? 'Unknown User',
        avatarUrl: peer?.avatarUrl ?? null,
        role: peer?.role ?? 'STUDENT',
      },
      reciprocated,
      lastMessage: last ? this.toDmMessage(last) : null,
      unreadCount,
      createdAt: thread.createdAt,
    };
  }

  private toDmMessage(row: DmMessageRow, assetUrl?: string | null): DmMessage {
    return {
      id: row.id,
      threadId: row.roomId,
      authorId: row.authorId,
      text: row.body,
      assetId: row.assetId,
      assetUrl: assetUrl ?? null,
      createdAt: row.createdAt,
    };
  }

  private async computeReciprocated(
    threadId: string,
    userIdA: string,
    userIdB: string,
  ): Promise<boolean> {
    const [sentA, sentB] = await Promise.all([
      this.repo.hasMessageFrom(threadId, userIdA),
      this.repo.hasMessageFrom(threadId, userIdB),
    ]);
    return sentA && sentB;
  }

  private normalizeBody(text: string, allowEmpty = false): string {
    const s = stripHtml(text).trim();
    if (s.length === 0 && !allowEmpty) {
      throw new BadRequestException({
        code: 'DM_BODY_EMPTY',
        message: 'Message body cannot be empty',
      });
    }
    if (s.length > MAX_DM_BODY_LENGTH) {
      throw new BadRequestException({
        code: 'DM_BODY_TOO_LONG',
        message: `Body exceeds ${MAX_DM_BODY_LENGTH} chars`,
      });
    }
    return s;
  }

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
        code: 'DM_ASSET_NOT_FOUND',
        message: 'Attachment was not found',
      });
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({
        code: 'DM_ASSET_NOT_OWNER',
        message: 'You can only send your own attachments',
      });
    }
    if (
      asset.bytes !== null &&
      asset.bytes > BigInt(DM_MAX_ATTACHMENT_SIZE_BYTES)
    ) {
      throw new BadRequestException({
        code: 'DM_ATTACHMENT_TOO_LARGE',
        message: 'Chat attachments must be 1 GB or smaller',
        maxBytes: DM_MAX_ATTACHMENT_SIZE_BYTES,
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
        code: 'DM_ASSET_NOT_READY',
        message: 'Attachment upload is not complete',
      });
    }
  }

  private normalizePageSize(size?: number): number {
    const n = Number(size);
    if (!Number.isFinite(n)) return DM_DEFAULT_PAGE_SIZE;
    return Math.min(Math.max(1, n), DM_MAX_PAGE_SIZE);
  }

  private normalizeCursor(cursor?: string): Date | undefined {
    if (!cursor) return undefined;
    const d = new Date(cursor);
    return isNaN(d.getTime()) ? undefined : d;
  }
}

export { buildDmScopeRef, peerFromScopeRef } from './repositories/dm.repository';
