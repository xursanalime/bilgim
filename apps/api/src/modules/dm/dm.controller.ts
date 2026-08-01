import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  CursorPage,
  DmMessage,
  DmService,
  DmThreadSummary,
  DmUnreadCount,
  OpenThreadResult,
  SendMessageResult,
} from './dm.service';
import {
  EditDmMessageDto,
  EditDmMessageSchema,
  ListDmMessagesDto,
  ListDmMessagesSchema,
  ListDmThreadsDto,
  ListDmThreadsSchema,
  OpenDmThreadDto,
  OpenDmThreadSchema,
  SendDmMessageDto,
  SendDmMessageSchema,
  ToggleReactionDto,
  ToggleReactionSchema,
} from './dto';

/**
 * `DmController` — REST surface for direct messaging (Req 13.1 – 13.4).
 *
 * Routes are restricted to `STUDENT` and `TEACHER` (Req 13.4) via the
 * controller-level `@Roles` decorator. The pre-reciprocation 24h rate
 * limit (Property 11) is enforced inside `DmService.sendMessage`.
 */
@Controller('dm')
@Roles('TEACHER', 'STUDENT')
export class DmController {
  constructor(private readonly dmService: DmService) {}

  /**
   * `POST /dm/threads` — open (or reuse) a DM thread with another
   * user. Body: `{ recipientId }`. Returns the thread summary and a
   * `created` flag indicating whether a new `ChatRoom` was lazily
   * created (Req 13.1).
   */
  @Post('threads')
  @HttpCode(HttpStatus.CREATED)
  async openThread(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(OpenDmThreadSchema))
    dto: OpenDmThreadDto,
  ): Promise<OpenThreadResult> {
    return this.dmService.openThread(
      { userId: user.sub, role: user.role },
      dto.recipientId,
    );
  }

  /**
   * `GET /dm/threads` — cursor-paginated list of the caller's
   * threads, newest activity first.
   */
  @Get('threads')
  @HttpCode(HttpStatus.OK)
  async listThreads(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(ListDmThreadsSchema))
    query: ListDmThreadsDto,
  ): Promise<CursorPage<DmThreadSummary>> {
    return this.dmService.listThreads(
      { userId: user.sub, role: user.role },
      query,
    );
  }

  /**
   * `GET /dm/unread-count` — total unread message count.
   */
  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(@CurrentUser() user: JwtPayload): Promise<DmUnreadCount> {
    return this.dmService.getUnreadCount({
      userId: user.sub,
      role: user.role,
    });
  }

  @Get('threads/:id')
  @HttpCode(HttpStatus.OK)
  async getThread(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
  ): Promise<DmThreadSummary> {
    return this.dmService.getThread(
      { userId: user.sub, role: user.role },
      threadId,
    );
  }

  /**
   * `POST /dm/threads/:id/messages` — send a message on an existing
   * thread. Body: `{ text }`. Throws 429 `DM_RATE_LIMITED` when the
   * pre-reciprocation 24h cap is hit.
   *
   * In addition to the per-thread reciprocation cap (Property 11), the
   * `@RateLimit(30, '1m')` decorator caps total send-rate at 30 / minute
   * per user (Task 29.4 — Req 30.x). Authenticated routes key by JWT
   * subject so a noisy client cannot bypass the limit by switching IPs.
   */
  @Post('threads/:id/messages')
  @RateLimit(30, '1m')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
    @Body(new ZodValidationPipe(SendDmMessageSchema))
    dto: SendDmMessageDto,
  ): Promise<SendMessageResult> {
    return this.dmService.sendMessage(
      { userId: user.sub, role: user.role },
      threadId,
      dto.text ?? '',
      dto.assetId ?? undefined,
    );
  }

  /**
   * `GET /dm/threads/:id/messages` — cursor-paginated message
   * history for a thread the caller participates in. Newest first.
   */
  @Get('threads/:id/messages')
  @HttpCode(HttpStatus.OK)
  async listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
    @Query(new ZodValidationPipe(ListDmMessagesSchema))
    query: ListDmMessagesDto,
  ): Promise<CursorPage<DmMessage>> {
    return this.dmService.listMessages(
      { userId: user.sub, role: user.role },
      threadId,
      query,
    );
  }

  /**
   * `PATCH /dm/threads/:id/read` — mark all messages in a thread as read.
   */
  @Patch('threads/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
  ): Promise<void> {
    await this.dmService.markRead(
      { userId: user.sub, role: user.role },
      threadId,
    );
  }

  /**
   * `PATCH /dm/threads/:id/messages/:messageId` — edit the text of a
   * message the caller authored, within the 48h edit window.
   */
  @Patch('threads/:id/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async editMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body(new ZodValidationPipe(EditDmMessageSchema)) dto: EditDmMessageDto,
  ): Promise<DmMessage> {
    return this.dmService.editMessage(
      { userId: user.sub, role: user.role },
      threadId,
      messageId,
      dto.text,
    );
  }

  /**
   * `DELETE /dm/threads/:id/messages/:messageId` — soft-delete a
   * message the caller authored.
   */
  @Delete('threads/:id/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ): Promise<void> {
    await this.dmService.deleteMessage(
      { userId: user.sub, role: user.role },
      threadId,
      messageId,
    );
  }

  /**
   * `PUT /dm/threads/:id/messages/:messageId/reactions` — toggle the
   * caller's `emoji` reaction on a message (adds if absent, removes if
   * present).
   */
  @Put('threads/:id/messages/:messageId/reactions')
  @HttpCode(HttpStatus.OK)
  async toggleReaction(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) threadId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body(new ZodValidationPipe(ToggleReactionSchema)) dto: ToggleReactionDto,
  ): Promise<{ added: boolean }> {
    return this.dmService.toggleReaction(
      { userId: user.sub, role: user.role },
      threadId,
      messageId,
      dto.emoji,
    );
  }
}
