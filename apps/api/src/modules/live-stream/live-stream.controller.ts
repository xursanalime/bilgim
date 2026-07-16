import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { LiveStreamService } from './live-stream.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Request } from 'express';

// Assuming you have a basic Auth request type
interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    // other user fields...
  };
}

@Controller('live-stream')
@UseGuards(JwtAuthGuard)
@Roles('STUDENT', 'TEACHER', 'ADMIN')
export class LiveStreamController {
  constructor(private readonly liveStreamService: LiveStreamService) {}

  @Post('token')
  async getToken(
    @Req() req: RequestWithUser,
    @Body() body: { roomName: string },
  ) {
    const userId = (req.user as any).sub || (req.user as any).id;
    // Safely extract a fallback participant name
    const participantName = req.user?.email?.split('@')[0] || 'Unknown User'; 
    
    // Auto-create the room (LiveKit handles if it already exists implicitly in some configurations,
    // but explicit creation helps set options like maxParticipants)
    try {
      await this.liveStreamService.createRoom(body.roomName);
    } catch (err) {
      // If room creation fails (e.g. LiveKit unreachable), we still try to generate the token
      // though the client will likely fail to connect. We log it in the service.
    }

    const token = await this.liveStreamService.createToken(
      body.roomName,
      participantName,
      userId,
    );

    return { token };
  }

  @Get('rooms')
  async getRooms() {
    const rooms = await this.liveStreamService.listRooms();
    return { rooms };
  }
}
