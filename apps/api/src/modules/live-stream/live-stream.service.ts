import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

@Injectable()
export class LiveStreamService {
  private readonly logger = new Logger(LiveStreamService.name);
  private roomService: RoomServiceClient;

  constructor(private readonly configService: ConfigService) {
    const livekitUrl = this.configService.get<string>('LIVEKIT_API_URL', 'http://localhost:7880');
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY', 'devkey');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET', 'secret');

    this.roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);
  }

  async createToken(roomName: string, participantName: string, identity: string): Promise<string> {
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY', 'devkey');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET', 'secret');

    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity,
      name: participantName,
    });
    
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    return at.toJwt();
  }

  async createRoom(roomName: string): Promise<any> {
    try {
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 10 * 60, // 10 minutes timeout if empty
        maxParticipants: 50,
      });
      this.logger.log(`Room created: ${roomName}`);
      return room;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to create room ${roomName} (it might already exist or LiveKit is unreachable). Continuing...`, error.stack);
      } else {
        this.logger.error(`Failed to create room ${roomName}`, String(error));
      }
      return null;
    }
  }

  async listRooms(): Promise<any[]> {
    return await this.roomService.listRooms();
  }
}
