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

import { TokensService } from '../auth/tokens.service';
import { authenticateSocket, WsJwtGuard, type WsAuthUser } from './chat/ws-jwt.guard';
import { LiveService } from './live.service';
import { SfuService } from './sfu/sfu.service';
import { LiveSessionRepository } from './repositories/live-session.repository';

interface ParticipantState {
  userId: string;
  role: 'TEACHER' | 'STUDENT';
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
  cors: { origin: true, credentials: true },
})
@UseGuards(WsJwtGuard)
export class LiveGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(LiveGateway.name);

  // Maps to track participant metadata in memory
  // lessonId -> Map<socketId, ParticipantState>
  private readonly roomParticipants = new Map<string, Map<string, ParticipantState>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly liveService: LiveService,
    private readonly sfuService: SfuService,
    private readonly liveSessionRepository: LiveSessionRepository,
  ) {}

  onModuleInit(): void {
    this.logger.log('LiveGateway (Classroom Signal) initialized');
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const user = await authenticateSocket(socket, this.tokens);
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
    // Find which room this socket was in and clean up
    for (const [lessonId, participants] of this.roomParticipants.entries()) {
      if (participants.has(socket.id)) {
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
        break;
      }
    }
    this.logger.debug(`SFU Socket disconnected: ${socket.id}`);
  }

  @SubscribeMessage('live:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; name: string },
  ) {
    try {
      const user = this.getSocketUser(socket);
      const session = await this.liveSessionRepository.findActiveByLessonId(payload.lessonId);
      
      if (!session || session.status !== 'LIVE') {
        throw new Error('Dars efiri hozir faol emas');
      }

      const room = await this.sfuService.ensureRoomForLesson(payload.lessonId);
      
      // Initialize participant state
      const state: ParticipantState = {
        userId: user.sub,
        role: user.role === 'STUDENT' ? 'STUDENT' : 'TEACHER',
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
        role: state.role
      };
    } catch (err: any) {
      return { error: { message: err.message } };
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
    const user = this.getSocketUser(socket);
    if (user.role !== 'TEACHER') throw new WsException('Faqat o\u2018qituvchi hayday oladi');

    this.server.to(payload.targetSocketId).emit('classroom:kicked', {
      reason: 'O\u2018qituvchi darsdan chetlatdi'
    });
    return { ok: true };
  }

  // --- WebRTC SFU Handlers ---
  // (Keep the existing produce/consume/connect logic here...)
  
  @SubscribeMessage('live:create-transport')
  async onCreateTransport(
    @ConnectedSocket() _socket: Socket,
    @MessageBody() payload: { lessonId: string },
  ) {
    try {
      const transport = await this.sfuService.createTransport(payload.lessonId);
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        sctpParameters: transport.sctpParameters,
      };
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  @SubscribeMessage('live:connect-transport')
  async onConnectTransport(
    @ConnectedSocket() _socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; dtlsParameters: any },
  ) {
    try {
      await this.sfuService.connectTransport(
        payload.lessonId,
        payload.transportId,
        payload.dtlsParameters,
      );
      return { ok: true };
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  @SubscribeMessage('live:produce')
  async onProduce(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; kind: 'audio' | 'video'; rtpParameters: any; appData?: any },
  ) {
    try {
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
      return { error: { message: err.message } };
    }
  }

  @SubscribeMessage('live:consume')
  async onConsume(
    @ConnectedSocket() _socket: Socket,
    @MessageBody() payload: { lessonId: string; transportId: string; producerId: string; rtpCapabilities: any },
  ) {
    try {
      return await this.sfuService.addConsumer(
        payload.lessonId,
        payload.transportId,
        payload.producerId,
        payload.rtpCapabilities,
      );
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  @SubscribeMessage('live:resume-consumer')
  async onResumeConsumer(
    @ConnectedSocket() _socket: Socket,
    @MessageBody() payload: { lessonId: string; consumerId: string },
  ) {
    try {
      await this.sfuService.resumeConsumer(payload.lessonId, payload.consumerId);
      return { ok: true };
    } catch (err: any) {
      return { error: { message: err.message } };
    }
  }

  private getSocketUser(socket: Socket): WsAuthUser {
    const user = (socket.data as { user?: WsAuthUser })?.user;
    if (!user) throw new WsException('Unauthenticated');
    return user;
  }
}
