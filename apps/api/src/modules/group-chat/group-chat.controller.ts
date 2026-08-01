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
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  AddGroupMemberDto,
  AddGroupMemberSchema,
  EditGroupMessageDto,
  EditGroupMessageSchema,
  ListGroupMessagesDto,
  ListGroupMessagesSchema,
  SendGroupMessageDto,
  SendGroupMessageSchema,
  SetGroupAvatarDto,
  SetGroupAvatarSchema,
  SetGroupMemberRoleDto,
  SetGroupMemberRoleSchema,
} from './dto';
import {
  CursorPage,
  GroupChatMemberSummary,
  GroupChatMessage,
  GroupChatService,
  GroupChatSummary,
  SendGroupMessageResult,
} from './group-chat.service';

/**
 * `GroupChatController` — Telegram-style group chat tied 1:1 to a
 * course `Group` (cohort). Membership is auto-provisioned (teacher as
 * OWNER on Group creation, students as MEMBER on enrollment approval —
 * see `CatalogService.createGroup` / `EnrollmentService.approveRequest`)
 * and can additionally be managed manually by the OWNER/ADMIN via this
 * controller (add/remove member, promote/demote, group photo).
 *
 * Restricted to `STUDENT`/`TEACHER` like `DmController` — ADMIN
 * (platform-ops role) never participates in chats.
 */
@Controller('group-chat')
@Roles('TEACHER', 'STUDENT')
export class GroupChatController {
  constructor(private readonly groupChatService: GroupChatService) {}

  @Get('groups')
  @HttpCode(HttpStatus.OK)
  async listMyGroups(
    @CurrentUser() user: JwtPayload,
  ): Promise<GroupChatSummary[]> {
    return this.groupChatService.listMyGroups({
      userId: user.sub,
      role: user.role,
    });
  }

  @Get('groups/:groupId')
  @HttpCode(HttpStatus.OK)
  async getGroup(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<GroupChatSummary> {
    return this.groupChatService.getGroup(
      { userId: user.sub, role: user.role },
      groupId,
    );
  }

  @Get('groups/:groupId/messages')
  @HttpCode(HttpStatus.OK)
  async listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Query(new ZodValidationPipe(ListGroupMessagesSchema))
    query: ListGroupMessagesDto,
  ): Promise<CursorPage<GroupChatMessage>> {
    return this.groupChatService.listMessages(
      { userId: user.sub, role: user.role },
      groupId,
      query,
    );
  }

  @Post('groups/:groupId/messages')
  @RateLimit(30, '1m')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodValidationPipe(SendGroupMessageSchema))
    dto: SendGroupMessageDto,
  ): Promise<SendGroupMessageResult> {
    return this.groupChatService.sendMessage(
      { userId: user.sub, role: user.role },
      groupId,
      dto.text ?? '',
      dto.assetId ?? undefined,
    );
  }

  /**
   * `PATCH /group-chat/groups/:groupId/messages/:messageId` — edit the
   * text of a message the caller authored, within the 48h edit window.
   */
  @Patch('groups/:groupId/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async editMessage(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @Body(new ZodValidationPipe(EditGroupMessageSchema))
    dto: EditGroupMessageDto,
  ): Promise<GroupChatMessage> {
    return this.groupChatService.editMessage(
      { userId: user.sub, role: user.role },
      groupId,
      messageId,
      dto.text,
    );
  }

  /**
   * `DELETE /group-chat/groups/:groupId/messages/:messageId` —
   * soft-delete a message. Author can always delete their own;
   * OWNER/ADMIN can delete any member's message.
   */
  @Delete('groups/:groupId/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
  ): Promise<void> {
    await this.groupChatService.deleteMessage(
      { userId: user.sub, role: user.role },
      groupId,
      messageId,
    );
  }

  @Patch('groups/:groupId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<void> {
    await this.groupChatService.markRead(
      { userId: user.sub, role: user.role },
      groupId,
    );
  }

  @Get('groups/:groupId/members')
  @HttpCode(HttpStatus.OK)
  async listMembers(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<GroupChatMemberSummary[]> {
    return this.groupChatService.listMembers(
      { userId: user.sub, role: user.role },
      groupId,
    );
  }

  @Post('groups/:groupId/members')
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodValidationPipe(AddGroupMemberSchema)) dto: AddGroupMemberDto,
  ): Promise<void> {
    await this.groupChatService.addMember(
      { userId: user.sub, role: user.role },
      groupId,
      dto.userId,
    );
  }

  @Delete('groups/:groupId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('userId', new ParseUUIDPipe()) targetUserId: string,
  ): Promise<void> {
    await this.groupChatService.removeMember(
      { userId: user.sub, role: user.role },
      groupId,
      targetUserId,
    );
  }

  @Patch('groups/:groupId/members/:userId/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('userId', new ParseUUIDPipe()) targetUserId: string,
    @Body(new ZodValidationPipe(SetGroupMemberRoleSchema))
    dto: SetGroupMemberRoleDto,
  ): Promise<void> {
    await this.groupChatService.setRole(
      { userId: user.sub, role: user.role },
      groupId,
      targetUserId,
      dto.role,
    );
  }

  @Post('groups/:groupId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leaveGroup(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<void> {
    await this.groupChatService.leaveGroup(
      { userId: user.sub, role: user.role },
      groupId,
    );
  }

  @Patch('groups/:groupId/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setAvatar(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body(new ZodValidationPipe(SetGroupAvatarSchema)) dto: SetGroupAvatarDto,
  ): Promise<void> {
    await this.groupChatService.setAvatar(
      { userId: user.sub, role: user.role },
      groupId,
      dto.assetId,
    );
  }

  @Get('groups/:groupId/avatar-url')
  @HttpCode(HttpStatus.OK)
  async getAvatarUrl(
    @CurrentUser() user: JwtPayload,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ): Promise<{ url: string | null }> {
    return this.groupChatService.getAvatarUrl(
      { userId: user.sub, role: user.role },
      groupId,
    );
  }
}
