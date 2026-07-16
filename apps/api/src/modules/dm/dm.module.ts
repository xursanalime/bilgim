import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { DmController } from './dm.controller';
import { DmService } from './dm.service';
import { GroupChatController } from './group-chat.controller';
import { GroupChatService } from './group-chat.service';
import { DmRepository } from './repositories/dm.repository';
import { LiveChatModule } from '../live/chat/live-chat.module';
import { MediaModule } from '../media/media.module';

/**
 * `DmModule` — Direct Messaging between TEACHER and STUDENT users
 * (Req 13.1 – 13.4).
 *
 * REST surface:
 *   - `POST /dm/threads`                         [TEACHER, STUDENT]
 *   - `GET  /dm/threads`                         [TEACHER, STUDENT]
 *   - `POST /dm/threads/:id/messages`            [TEACHER, STUDENT]
 *   - `GET  /dm/threads/:id/messages`            [TEACHER, STUDENT]
 *
 * Persistence reuses the existing `ChatRoom` + `ChatMessage` models
 * with `scope = "DM"` and `scopeRef = "<minUserId>:<maxUserId>"` so
 * each unordered pair maps to a single thread (UNIQUE on
 * `(scope, scopeRef)`). The thread is lazily created on the first
 * `POST /dm/threads` call (Req 13.1).
 *
 * Rate limit (Req 13.3): the directional Redis counter
 * `dm:rate:{senderId}:{recipientId}` (TTL 24h) caps a non-reciprocated
 * pair to N messages/day. Reciprocation lifts the cap; the global
 * per-user ceiling continues to be enforced by the cross-cutting
 * `RateLimitInterceptor`.
 *
 * Owns its own `PrismaClient` (matching Auth/Billing/Catalog
 * convention). `RedisService` is provided globally by `RedisModule`.
 */
@Module({
  imports: [ConfigModule, LiveChatModule, MediaModule],
  controllers: [DmController, GroupChatController],
  providers: [
    DmService,
    GroupChatService,
    DmRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [DmService],
})
export class DmModule {}
