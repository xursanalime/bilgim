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

import { SessionValidatorService } from '../auth/session-validator.service';
import { TokensService } from '../auth/tokens.service';
import { assertWsLessonAccess } from './access/ws-lesson-access';
import { resolveWsCorsOptions } from './ws-cors';
import { authenticateSocket, WsJwtGuard, type WsAuthUser } from './chat/ws-jwt.guard';
import { LiveService } from './live.service';
import { SfuService } from './sfu/sfu.service';
import { LiveSessionRepository } from './repositories/live-session.repository';

interface ParticipantState {
  userId: string;
  role: 'TEACHER' | 'STUDENT';
  /**
   * Whether this participant may moderate the room (owning teacher or
   * ADMIN). Resolved once at join time by `assertWsLessonAccess` and
   * cached here — moderation handlers gate on this, never on
   * `user.role === 'TEACHER'`, which would let any teacher on the
   * platform moderate a colleague's classroom.
   */
  isModerator: boolean;
  name: string;
  isMicOn: boolean;
  isCamOn: boolean;
  isHandRaised: boolean;
  joinedAt: number;
}

/**
 * LiveGateway — The real-time signaling backbone for Bilgim Live sessions.
 * Handles WebRTC transport negotiation and classroom state sync.
 */
@WebSocketGateway({
  namespace: '/live-sfu',
  // Explicit allow-list, NOT `origin: true`. The session cookie is scoped
  // to `.bilgim.uz`, so a reflected origin would let any teacher
  // subdomain (or any site, if a browser ever relaxed SameSite) open an
  // authenticated socket on a visitor's behalf. See `ws-cors.ts`.
  cors: resolveWsCorsOptions(),
})
@UseGuards(WsJwtGuard)
export class LiveGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(LiveGateway.name);

  // Maps to track participant metadata in memory
  // lessonId -> Map<socketId, ParticipantState>
  private readonly roomParticipants = new Map<string, Map<string, ParticipantState>>();

  /**
   * socketId -> set of SFU transport ids this socket created. Transports
   * are per-room in `SfuService`, so without this a participant could pass
   * a peer's `transportId` to `live:connect-transport` / `live:produce`
   * and hijack their media path. Ownership is tracked here and asserted on
   * every transport-scoped handler.
   */
  private readonly socketTransports = new Map<string, Set<string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokensService,
    private readonly sessions: SessionValidatorService,
    private readonly liveService: LiveService,
    private readonly sfuService: SfuService,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  onModuleInit(): void {
    this.logger.log('LiveGateway (Classroom Signal) initialized');
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const user = await authenticateSocket(socket, this.tokens, this.sessions);
      if (!user) {
        socket.disconnect(true);
        return;
      }
      this.logger.debug(`SFU Socket connected: ${socket.id} (user=${user.sub})`);
    } catch (err) {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    // Clean up every room this socket was in. (No `break`: a socket is
    // normally in one lesson, but leaking a stale participant entry would
    // keep a disconnected peer "authorized" in `assertJoined`.)
    for (const [lessonId, participants] of this.roomParticipants.entries()) {
      if (!participants.has(socket.id)) continue;

      const p = participants.get(socket.id);
      participants.delete(socket.id);

      // Notify others
      this.server.to(`live:${lessonId}`).emit('classroom:participant-left', {
        socketId: socket.id,
        userId: p?.userId,
        count: participants.size
      });

      if (participants.size === 0) {
        this.roomParticipants.delete(lessonId);
      }
    }
    this.socketTransports.delete(socket.id);
    this.logger.debug(`SFU Socket disconnected: ${socket.id}`);
  }

  @SubscribeMessage('live:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; name: string },
  ) {
    try {
      const user = this.getSocketUser(socket);

      // Authorization (Req 6.1 – 6.6). Without this any authenticated
      // account could join any teacher's classroom by guessing a lessonId.
      const access = await assertWsLessonAccess(
        this.prisma,
        user,
        payload.lessonId,
      );

      const session = await this.liveSessionRepository.findActiveByLessonId(payload.lessonId);

      if (!session || session.status !== 'LIVE') {
        throw new Error('Dars efiri hozir faol emas');
      }

      const room = await this.sfuService.ensureRoomForLesson(payload.lessonId);

      // Initialize participant state
      const state: ParticipantState = {
        userId: user.sub,
        role: user.role === 'STUDENT' ? 'STUDENT' : 'TEACHER',
        isModerator: access.isOwningTeacher,
        name: payload.name || user.email.split('@')[0] || 'User',
        isMicOn: false,
        isCamOn: false,
        isHandRaised: false,
        joinedAt: Date.now(),
      };

      if (!this.roomParticipants.has(payload.lessonId)) {
        this.roomParticipants.set(payload.lessonId, new Map());
      }
      this.roomParticipants.get(payload.lessonId)!.set(socket.id, state);

      await socket.join(`live:${payload.lessonId}`);
      
      const producers = this.sfuService.listProducers(payload.lessonId).map(p => ({
        producerId: p.id,
        kind: p.kind
      }));

      // Broadcast to others
      socket.to(`live:${payload.lessonId}`).emit('classroom:participant-joined', {
        socketId: socket.id,
        ...state
      });

      return {
        rtpCapabilities: room.rtpCapabilities,
        producers,
        participants: Array.from(this.roomParticipants.get(payload.lessonId)!.entries()).map(([sid, s]) => ({
          socketId: sid,
          ...s
        })),
        role: state.role,
        isModerator: state.isModerator
      };
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  // --- Classroom Events ---

  @SubscribeMessage('classroom:update-media-status')
  async onUpdateMediaStatus(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; isMicOn?: boolean; isCamOn?: boolean },
  ) {
    const participants = this.roomParticipants.get(payload.lessonId);
    const state = participants?.get(socket.id);
    if (!state) return;

    if (payload.isMicOn !== undefined) state.isMicOn = payload.isMicOn;
    if (payload.isCamOn !== undefined) state.isCamOn = payload.isCamOn;

    socket.to(`live:${payload.lessonId}`).emit('classroom:media-status-updated', {
      socketId: socket.id,
      isMicOn: state.isMicOn,
      isCamOn: state.isCamOn,
    });
    return { ok: true };
  }

  @SubscribeMessage('classroom:raise-hand')
  async onRaiseHand(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; isRaised: boolean },
  ) {
    const participants = this.roomParticipants.get(payload.lessonId);
    const state = participants?.get(socket.id);
    if (!state) return;

    state.isHandRaised = payload.isRaised;
    socket.to(`live:${payload.lessonId}`).emit('classroom:hand-raised', {
      socketId: socket.id,
      isRaised: state.isHandRaised,
    });
    return { ok: true };
  }

  @SubscribeMessage('classroom:whiteboard-draw')
  async onWhiteboardDraw(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; data: any },
  ) {
    // Must be a joined participant \u2014 otherwise any authenticated account
    // could scribble over an arbitrary classroom's whiteboard.
    this.assertJoined(socket, payload.lessonId);

    // Relay drawing data to everyone else in the room
    socket.to(`live:${payload.lessonId}`).emit('classroom:whiteboard-data', {
      socketId: socket.id,
      data: payload.data
    });
    return { ok: true };
  }

  @SubscribeMessage('classroom:kick-participant')
  async onKickParticipant(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; targetSocketId: string },
  ) {
    // `isModerator` (owning teacher / ADMIN), not `role === 'TEACHER'` \u2014
    // the latter let any teacher on the platform kick participants out of
    // a colleague's classroom.
    const state = this.assertJoined(socket, payload.lessonId);
    if (!state.isModerator) {
      throw new WsException({
        code: 'NOT_ROOM_MODERATOR',
        message: 'Faqat darsning o\u2018qituvchisi hayday oladi',
      });
    }

    // Only kick someone who is actually in THIS room \u2014 `targetSocketId`
    // is client-supplied and would otherwise address any socket on the
    // namespace, including participants of other lessons.
    const participants = this.roomParticipants.get(payload.lessonId);
    if (!participants?.has(payload.targetSocketId)) {
      throw new WsException({
        code: 'PARTICIPANT_NOT_IN_ROOM',
        message: 'Bu ishtirokchi darsda emas',
      });
    }

    this.server.to(payload.targetSocketId).emit('classroom:kicked', {
      reason: 'O\u2018qituvchi darsdan chetlatdi'
    });
    return { ok: true };
  }

  // --- WebRTC SFU Handlers ---
  // (Keep the existing produce/consume/connect logic here...)
  
  @SubscribeMessage('live:create-transport')
  async onCreateTransport(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string },
  ) {
    try {
      this.assertJoined(socket, payload.lessonId);
      const transport = await this.sfuService.createTransport(payload.lessonId);
      this.rememberTransport(socket.id, transport.id);
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        sctpParameters: transport.sctpParameters,
      };
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  @SubscribeMessage('live:connect-transport')
  async onConnectTransport(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; dtlsParameters: any },
  ) {
    try {
      this.assertJoined(socket, payload.lessonId);
      this.assertOwnsTransport(socket, payload.transportId);
      await this.sfuService.connectTransport(
        payload.lessonId,
        payload.transportId,
        payload.dtlsParameters,
      );
      return { ok: true };
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  @SubscribeMessage('live:produce')
  async onProduce(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; kind: 'audio' | 'video'; rtpParameters: any; appData?: any },
  ) {
    try {
      this.assertJoined(socket, payload.lessonId);
      this.assertOwnsTransport(socket, payload.transportId);
      const producer = await this.sfuService.addProducer(
        payload.lessonId,
        payload.transportId,
        payload.kind,
        payload.rtpParameters,
      );

      // Notify other peers in the room about the new producer
      socket.to(`live:${payload.lessonId}`).emit('live:new-producer', {
        producerId: producer.id,
        kind: producer.kind,
        appData: payload.appData // Pass along custom data (e.g. { type: 'screen' })
      });

      return { id: producer.id };
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  @SubscribeMessage('live:consume')
  async onConsume(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; producerId: string; rtpCapabilities: any },
  ) {
    try {
      // The eavesdropping guard: without these two asserts any logged-in
      // account could consume another classroom's audio/video producers.
      this.assertJoined(socket, payload.lessonId);
      this.assertOwnsTransport(socket, payload.transportId);
      return await this.sfuService.addConsumer(
        payload.lessonId,
        payload.transportId,
        payload.producerId,
        payload.rtpCapabilities,
      );
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  @SubscribeMessage('live:resume-consumer')
  async onResumeConsumer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; consumerId: string },
  ) {
    try {
      this.assertJoined(socket, payload.lessonId);
      await this.sfuService.resumeConsumer(payload.lessonId, payload.consumerId);
      return { ok: true };
    } catch (err: any) {
      return { error: { code: errorCodeOf(err), message: err.message } };
    }
  }

  // ------------------------------------------------------------------
  // Access control helpers
  // ------------------------------------------------------------------

  private getSocketUser(socket: Socket): WsAuthUser {
    const user = (socket.data as { user?: WsAuthUser })?.user;
    if (!user) throw new WsException('Unauthenticated');
    return user;
  }

  /**
   * Assert this socket completed `live:join` for `lessonId` — i.e. that
   * `assertWsLessonAccess` already passed for it. Every other handler
   * hangs off this instead of re-querying the DB, so the per-message cost
   * stays a Map lookup while the authorization decision still comes from
   * a real enrollment/ownership check.
   */
  private assertJoined(socket: Socket, lessonId: string): ParticipantState {
    const state = this.roomParticipants.get(lessonId)?.get(socket.id);
    if (!state) {
      throw new WsException({
        code: 'NOT_IN_LESSON',
        message: 'Avval darsga qo‘shiling (live:join)',
      });
    }
    return state;
  }

  private rememberTransport(socketId: string, transportId: string): void {
    let owned = this.socketTransports.get(socketId);
    if (!owned) {
      owned = new Set<string>();
      this.socketTransports.set(socketId, owned);
    }
    owned.add(transportId);
  }

  /** Reject transport ids this socket did not create (see `socketTransports`). */
  private assertOwnsTransport(socket: Socket, transportId: string): void {
    if (!this.socketTransports.get(socket.id)?.has(transportId)) {
      throw new WsException({
        code: 'TRANSPORT_NOT_OWNED',
        message: 'Bu transport sizga tegishli emas',
      });
    }
  }
}

/**
 * Surface the structured `code` from a `WsException` payload so clients
 * can branch on the reason instead of string-matching the message.
 */
function errorCodeOf(err: unknown): string {
  const payload = (err as WsException | undefined)?.getError?.();
  if (payload && typeof payload === 'object' && 'code' in payload) {
    return String((payload as { code: unknown }).code);
  }
  return 'LIVE_ERROR';
}
