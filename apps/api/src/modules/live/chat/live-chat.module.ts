import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../../infra/prisma';

import { AuthModule } from '../../auth';
import { LiveChatGateway } from './live-chat.gateway';
import { WsJwtGuard } from './ws-jwt.guard';

/**
 * LiveChatModule — wires the Socket.io gateway that powers the
 * real-time chat panel during a live efir (Req 9.9).
 *
 * The gateway depends on `TokensService` (re-exported by `AuthModule`)
 * for JWT verification on the WebSocket handshake, and on a local
 * `PrismaClient` instance for chat persistence. We provide our own
 * client here — bounded contexts in this codebase consistently own
 * their Prisma instance rather than sharing one across modules
 * (mirrors the pattern in `AuthModule`).
 */
@Module({
  imports: [AuthModule],
  providers: [
    LiveChatGateway,
    WsJwtGuard,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [LiveChatGateway],
})
export class LiveChatModule {}
