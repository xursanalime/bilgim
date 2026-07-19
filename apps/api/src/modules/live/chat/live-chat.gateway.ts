import {
  Logger,
  UseGuards,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { PrismaClient } from '@prisma/client';
import type { Server, Socket } from 'socket.io';

import { TokensService } from '../../auth/tokens.service';
import { authenticateSocket, WsJwtGuard, type WsAuthUser } from './ws-jwt.guard';

/** Maximum length of a chat message body (chars). Req 9.9. */
export const MAX_CHAT_MESSAGE_LENGTH = 1000;

/** Per-socket rate limit: 5 messages per second. */
export const CHAT_RATE_LIMIT_MAX = 5;
export const CHAT_RATE_LIMIT_WINDOW_MS = 1000;

/**
 * Payload shapes the gateway accepts/emits. Kept inline rather than in
 * a `dto/` folder because the gateway is the only consumer.
 */
export interface ChatJoinPayload {
  lessonId: string;
}

export interface ChatLeavePayload {
  lessonId: string;
}

export interface ChatMessagePayload {
  lessonId: string;
  text: string;
}

export interface ChatMessageBroadcast {
  lessonId: string;
  senderId: string;
  text: string;
  assetId?: string | null;
  ts: number;
  /** Persisted message id when DB write succeeded; otherwise undefined. */
  messageId?: string;
}

interface RateLimitState {
  count: number;
  windowStart: number;
}

/**
 * LiveChatGateway — Socket.io gateway that powers the chat panel
 * during a live efir (Requirement 9.9).
 *
 * Namespace `/live`. JWT auth is enforced both on connect (via
 * `authenticateSocket`) and on every `@SubscribeMessage` handler via
 * the global `WsJwtGuard` mirror so an unauthenticated client cannot
 * sneak past by skipping connect-time auth (e.g. by reusing a stale
 * cookie that was rotated client-side).
 *
 * Membership (`socket.data.lessons`) is tracked per-socket. Joining a
 * lesson room is gated on the same access rules used by the HTTP layer
 * (`LessonAccessGuard.loadLesson` + role/enrollment check) — see
 * `assertLessonAccess`. Disconnect cleanup leaves no rooms behind.
 *
 * Persistence: when a `ChatRoom(scope=LIVE_SESSION, scopeRef=lessonId)`
 * exists (or can be created), each broadcast message is written to
 * `ChatMessage` so admins can audit a session post-hoc. If the DB write
 * fails the broadcast is still delivered — chat is best-effort and
 * must not block the live conversation.
 *
 * Rate limit: 5 messages / sec / socket. Implemented in-process with a
 * sliding window. We deliberately do NOT escalate to Redis here because
 * the limit is per-connection (not per-user across pods); the live
 * gateway already has pod-affinity per `lessonId` (see SfuService docs).
 */
@WebSocketGateway({
  namespace: '/live',
  cors: { origin: true, credentials: true },
})
@UseGuards(WsJwtGuard)
export class LiveChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(LiveChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaClient,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `LiveChatGateway ready (max ${CHAT_RATE_LIMIT_MAX} msg/${CHAT_RATE_LIMIT_WINDOW_MS}ms, body ≤ ${MAX_CHAT_MESSAGE_LENGTH} chars)`,
    );
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const user = await authenticateSocket(socket, this.tokens);
      if (!user) {
        this.logger.warn(`Disconnecting socket ${socket.id} — missing token`);
        socket.emit('chat:error', {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
        });
        socket.disconnect(true);
        return;
      }
      this.initSocketState(socket, user);
      this.logger.debug(
        `Socket ${socket.id} authenticated as user=${user.sub} role=${user.role}`,
      );
    } catch (err) {
      const code =
        (err as { error?: { code?: string } })?.error?.code ?? 'AUTH_ERROR';
      const message =
        (err as { error?: { message?: string } })?.error?.message ??
        (err as Error).message ??
        'Authentication failed';
      socket.emit('chat:error', { code, message });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    const lessons = this.getSocketLessons(socket);
    if (lessons.size === 0) {
      return;
    }
    const user = this.getSocketUser(socket);
    for (const lessonId of lessons) {
      const room = this.roomFor(lessonId);
      socket.leave(room);
      if (user) {
        // Best-effort presence signal so the room sees the leave even if
        // the client disconnected without sending `chat:leave`.
        socket.to(room).emit('chat:left', {
          lessonId,
          userId: user.sub,
          ts: Date.now(),
        });
      }
    }
    lessons.clear();
  }

  // ------------------------------------------------------------------
  // chat:join
  // ------------------------------------------------------------------

  @SubscribeMessage('chat:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: ChatJoinPayload,
  ): Promise<{ ok: true; lessonId: string }> {
    const user = this.requireUser(socket);
    const lessonId = this.requireLessonId(payload);

    await this.assertRoomAccess(user, lessonId);

    const room = this.roomFor(lessonId);
    await socket.join(room);
    this.getSocketLessons(socket).add(lessonId);

    // Notify peers (not the joiner) that someone arrived. The joiner
    // acks via the return value so the client doesn't need to
    // distinguish self-joins.
    socket.to(room).emit('chat:joined', {
      lessonId,
      userId: user.sub,
      ts: Date.now(),
    });

    return { ok: true, lessonId };
  }

  // ------------------------------------------------------------------
  // chat:message
  // ------------------------------------------------------------------

  @SubscribeMessage('chat:message')
  async onMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: ChatMessagePayload,
  ): Promise<{ ok: true; messageId?: string; ts: number }> {
    const user = this.requireUser(socket);
    const lessonId = this.requireLessonId(payload);
    const text = this.requireText(payload);

    if (!this.getSocketLessons(socket).has(lessonId)) {
      throw new WsException({
        code: 'CHAT_NOT_JOINED',
        message: `Socket has not joined lesson ${lessonId}`,
      });
    }
    if (!this.allowMessage(socket)) {
      throw new WsException({
        code: 'RATE_LIMITED',
        message: `Max ${CHAT_RATE_LIMIT_MAX} messages per ${CHAT_RATE_LIMIT_WINDOW_MS}ms`,
      });
    }

    const ts = Date.now();
    let messageId: string | undefined;
    try {
      messageId = await this.persistMessage(lessonId, user.sub, text);
    } catch (err) {
      // Log and continue — chat is best-effort vs. live-stream UX.
      this.logger.warn(
        `persistMessage failed (lesson=${lessonId}): ${(err as Error).message}`,
      );
    }

    const broadcast: ChatMessageBroadcast = {
      lessonId,
      senderId: user.sub,
      text,
      ts,
      ...(messageId ? { messageId } : {}),
    };

    this.server.to(this.roomFor(lessonId)).emit('chat:message', broadcast);
    return { ok: true, ...(messageId ? { messageId } : {}), ts };
  }

  // ------------------------------------------------------------------
  // chat:leave
  // ------------------------------------------------------------------

  @SubscribeMessage('chat:leave')
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: ChatLeavePayload,
  ): Promise<{ ok: true; lessonId: string }> {
    const user = this.requireUser(socket);
    const lessonId = this.requireLessonId(payload);

    const lessons = this.getSocketLessons(socket);
    if (!lessons.has(lessonId)) {
      // Treat as idempotent — leaving a room you never joined is a no-op.
      return { ok: true, lessonId };
    }

    const room = this.roomFor(lessonId);
    await socket.leave(room);
    lessons.delete(lessonId);

    socket.to(room).emit('chat:left', {
      lessonId,
      userId: user.sub,
      ts: Date.now(),
    });

    return { ok: true, lessonId };
  }

  // ------------------------------------------------------------------
  // Access control
  // ------------------------------------------------------------------

  private async assertRoomAccess(
    user: WsAuthUser,
    roomId: string,
  ): Promise<void> {
    if (roomId.startsWith('dm:')) {
      await this.assertDmAccess(user, roomId.slice(3));
      return;
    }
    await this.assertLessonAccess(user, roomId);
  }

  private async assertDmAccess(
    user: WsAuthUser,
    threadId: string,
  ): Promise<void> {
    const thread = await this.prisma.chatRoom.findFirst({
      where: { id: threadId, scope: 'DM' },
      select: { scopeRef: true },
    });
    if (!thread) {
      throw new WsException({
        code: 'DM_THREAD_NOT_FOUND',
        message: `DM thread ${threadId} not found`,
      });
    }

    const participants = thread.scopeRef.split(':');
    if (!participants.includes(user.sub)) {
      throw new WsException({
        code: 'DM_ACCESS_DENIED',
        message: 'You are not a participant in this DM thread',
      });
    }
  }

  /**
   * Reuse the same access policy as `LessonAccessGuard` (Req 6.1–6.6):
   *  - ADMIN: always allowed
   *  - TEACHER: must own the lesson's course
   *  - STUDENT: must have an APPROVED enrollment in the lesson's group
   * Throws `WsException` (rather than `ForbiddenException`) so the
   * Socket.io error pipeline produces a structured payload.
   */
  private async assertLessonAccess(
    user: WsAuthUser,
    lessonId: string,
  ): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { group: { include: { course: true } } },
    });
    if (!lesson) {
      throw new WsException({
        code: 'LESSON_NOT_FOUND',
        message: `Lesson ${lessonId} not found`,
      });
    }

    switch (user.role) {
      case 'ADMIN':
        return;
      case 'TEACHER':
        if (lesson.group.course.teacherId !== user.sub) {
          throw new WsException({
            code: 'NOT_OWNING_TEACHER',
            message: 'You can only join lessons for your own courses',
          });
        }
        return;
      case 'STUDENT': {
        const enrollment = await this.prisma.enrollment.findUnique({
          where: {
            groupId_studentId: {
              groupId: lesson.groupId,
              studentId: user.sub,
            },
          },
        });
        if (!enrollment || enrollment.status !== 'APPROVED') {
          throw new WsException({
            code: 'LESSON_ACCESS_DENIED',
            message:
              'You do not have approved access to this lesson. Pay and wait for teacher approval to enroll.',
          });
        }
        return;
      }
      default:
        throw new WsException({
          code: 'FORBIDDEN_ROLE',
          message: `Role ${user.role} is not allowed to join live chat`,
        });
    }
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  /**
   * Append a row to `ChatMessage`, creating the `ChatRoom`
   * (scope=LIVE_SESSION, scopeRef=lessonId) on demand. Returns the new
   * `ChatMessage.id`. Throws on DB failure — the caller swallows the
   * error so live broadcast continues.
   */
  private async persistMessage(
    lessonId: string,
    authorId: string,
    body: string,
  ): Promise<string> {
    const room = await this.prisma.chatRoom.upsert({
      where: { scope_scopeRef: { scope: 'LIVE_SESSION', scopeRef: lessonId } },
      create: { scope: 'LIVE_SESSION', scopeRef: lessonId },
      update: {},
    });
    const msg = await this.prisma.chatMessage.create({
      data: { roomId: room.id, authorId, body },
      select: { id: true },
    });
    return msg.id;
  }

  // ------------------------------------------------------------------
  // Rate limiting
  // ------------------------------------------------------------------

  /**
   * Sliding-counter rate limit: at most `CHAT_RATE_LIMIT_MAX` messages
   * inside a `CHAT_RATE_LIMIT_WINDOW_MS` window per socket. State lives
   * on `socket.data` so it dies with the connection.
   */
  private allowMessage(socket: Socket): boolean {
    const now = Date.now();
    const data = socket.data as { rate?: RateLimitState };
    const state = data.rate ?? { count: 0, windowStart: now };

    if (now - state.windowStart >= CHAT_RATE_LIMIT_WINDOW_MS) {
      state.count = 0;
      state.windowStart = now;
    }

    if (state.count >= CHAT_RATE_LIMIT_MAX) {
      data.rate = state;
      return false;
    }

    state.count += 1;
    data.rate = state;
    return true;
  }

  // ------------------------------------------------------------------
  // Validation helpers
  // ------------------------------------------------------------------

  private requireUser(socket: Socket): WsAuthUser {
    const user = this.getSocketUser(socket);
    if (!user) {
      throw new WsException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }
    return user;
  }

  private requireLessonId(
    payload: { lessonId?: unknown } | null | undefined,
  ): string {
    const id = payload?.lessonId;
    if (typeof id !== 'string' || id.length === 0) {
      throw new WsException({
        code: 'BAD_PAYLOAD',
        message: 'lessonId is required',
      });
    }
    return id;
  }

  private requireText(payload: { text?: unknown }): string {
    const raw = payload.text;
    if (typeof raw !== 'string') {
      throw new WsException({
        code: 'BAD_PAYLOAD',
        message: 'text must be a string',
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new WsException({
        code: 'BAD_PAYLOAD',
        message: 'text must not be empty',
      });
    }
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new WsException({
        code: 'BAD_PAYLOAD',
        message: `text must be at most ${MAX_CHAT_MESSAGE_LENGTH} characters`,
      });
    }
    return trimmed;
  }

  private getSocketUser(socket: Socket): WsAuthUser | undefined {
    return (socket.data as { user?: WsAuthUser } | undefined)?.user;
  }

  private getSocketLessons(socket: Socket): Set<string> {
    const data = socket.data as { lessons?: Set<string> };
    if (!data.lessons) {
      data.lessons = new Set<string>();
    }
    return data.lessons;
  }

  private initSocketState(socket: Socket, user: WsAuthUser): void {
    socket.data = socket.data ?? {};
    (socket.data as { user?: WsAuthUser }).user = user;
    (socket.data as { lessons?: Set<string> }).lessons = new Set();
    (socket.data as { rate?: RateLimitState }).rate = {
      count: 0,
      windowStart: Date.now(),
    };
  }

  private roomFor(lessonId: string): string {
    return `lesson:${lessonId}`;
  }
}
