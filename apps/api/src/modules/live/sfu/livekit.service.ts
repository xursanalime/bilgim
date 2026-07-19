import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export interface LiveKitRoomSnapshot {
  readonly lessonId: string;
  readonly roomId: string;
  readonly participantCount: number;
  readonly createdAt: Date;
}

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private roomService: RoomServiceClient;

  constructor(private readonly configService: ConfigService) {
    const livekitUrl = this.configService.get<string>('LIVEKIT_API_URL', 'http://localhost:7880');
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY', 'devkey');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET', 'secret');

    this.roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);
  }

  async createToken(roomName: string, participantName: string, identity: string, role: 'TEACHER' | 'STUDENT'): Promise<string> {
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY', 'devkey');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET', 'secret');

    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity,
      name: participantName,
    });
    
    // Teacher: publish everything. Student: publish camera+mic (mic controlled via DataChannel permission)
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true
    });

    return at.toJwt();
  }

  async ensureRoom(roomName: string): Promise<LiveKitRoomSnapshot> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      let room = rooms.find(r => r.name === roomName);
      
      if (!room) {
        room = await this.roomService.createRoom({
          name: roomName,
          emptyTimeout: 10 * 60, // 10 minutes timeout if empty
          maxParticipants: 100,
        });
        this.logger.log(`LiveKit Room created: ${roomName}`);
      }

      return {
        lessonId: roomName,
        roomId: room.name,
        participantCount: room.numParticipants,
        createdAt: new Date(Number(room.creationTime) * 1000),
      };
    } catch (error) {
      this.logger.error(`Failed to ensure LiveKit room ${roomName}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async closeRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
      this.logger.log(`LiveKit Room deleted: ${roomName}`);
    } catch (error) {
      this.logger.warn(`Failed to delete LiveKit room ${roomName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getRoomSnapshot(roomName: string): Promise<LiveKitRoomSnapshot | null> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      const room = rooms.find(r => r.name === roomName);
      if (!room) return null;
      
      return {
        lessonId: roomName,
        roomId: room.name,
        participantCount: room.numParticipants,
        createdAt: new Date(Number(room.creationTime) * 1000),
      };
    } catch (error) {
      return null;
    }
  }
}
