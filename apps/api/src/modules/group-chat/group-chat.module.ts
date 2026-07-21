import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../infra/prisma';

import { GroupChatController } from './group-chat.controller';
import { GroupChatService } from './group-chat.service';
import { GroupChatRepository } from './repositories/group-chat.repository';
import { LiveChatModule } from '../live/chat/live-chat.module';
import { MediaModule } from '../media/media.module';

/**
 * `GroupChatModule` — Telegram-style group chat tied 1:1 to a course
 * `Group` (cohort).
 *
 * Persistence reuses the existing `ChatRoom` + `ChatMessage` models
 * with `scope = "GROUP"` and `scopeRef = Group.id` (same generic
 * scope/scopeRef pattern as DM and live-lesson chat), plus a new
 * `GroupChatMember` join table for N-ary membership + role (OWNER /
 * ADMIN / MEMBER) — unlike DM's 2-party scopeRef encoding, group
 * membership can't be derived from the room id alone.
 *
 * `GroupChatRepository` is exported so `CatalogModule`
 * (`CatalogService.createGroup`) and `EnrollmentModule`
 * (`EnrollmentService.approveRequest`) can provision the room/owner
 * and add approved students as members inside their own transactions.
 *
 * Owns its own `PrismaClient` instance (same pattern as every other
 * bounded-context module in this codebase).
 */
@Module({
  imports: [ConfigModule, LiveChatModule, MediaModule],
  controllers: [GroupChatController],
  providers: [
    GroupChatService,
    GroupChatRepository,
    {
      provide: PrismaClient,
      useFactory: () => createPrismaClient(),
    },
  ],
  exports: [GroupChatService, GroupChatRepository],
})
export class GroupChatModule {}
