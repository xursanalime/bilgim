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
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { GroupChatService } from './group-chat.service';

const CreateGroupSchema = z.object({
  title: z.string().min(1).max(80),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
});
type CreateGroupDto = z.infer<typeof CreateGroupSchema>;

const SendGroupMessageSchema = z.object({
  text: z.string().max(4000).optional(),
  assetId: z.string().uuid().optional(),
});
type SendGroupMessageDto = z.infer<typeof SendGroupMessageSchema>;

const AddMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
});
type AddMembersDto = z.infer<typeof AddMembersSchema>;

const JoinGroupSchema = z
  .object({
    token: z.string().min(6).max(64).optional(),
    username: z.string().min(2).max(40).optional(),
  })
  .refine((v) => Boolean(v.token || v.username), { message: 'token yoki username kerak' });
type JoinGroupDto = z.infer<typeof JoinGroupSchema>;

const UpdateGroupSchema = z
  .object({
    title: z.string().min(1).max(80).optional(),
    username: z.string().max(40).nullable().optional(),
    avatarAssetId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.username !== undefined || v.avatarAssetId !== undefined, {
    message: 'Hech bo‘lmasa bitta maydon kerak',
  });
type UpdateGroupDto = z.infer<typeof UpdateGroupSchema>;

const SetRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
type SetRoleDto = z.infer<typeof SetRoleSchema>;

const ListMessagesSchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
type ListMessagesDto = z.infer<typeof ListMessagesSchema>;

/**
 * GroupChatController — Telegram-style group conversations (`/dm/groups`).
 * Restricted to TEACHER / STUDENT like the rest of the DM surface.
 */
@Controller('dm/groups')
@Roles('TEACHER', 'STUDENT')
export class GroupChatController {
  constructor(private readonly groups: GroupChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateGroupSchema)) dto: CreateGroupDto,
  ) {
    return this.groups.createGroup(
      { userId: user.sub, role: user.role },
      dto.title,
      dto.memberIds,
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: JwtPayload) {
    return this.groups.listGroups({ userId: user.sub, role: user.role });
  }

  // Static routes declared BEFORE ':id' so they are not captured by the
  // UUID param route.
  @Get('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @CurrentUser() user: JwtPayload,
    @Query('token') token?: string,
    @Query('username') username?: string,
  ) {
    return this.groups.preview(
      { userId: user.sub, role: user.role },
      { ...(token ? { token } : {}), ...(username ? { username } : {}) },
    );
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  async join(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(JoinGroupSchema)) dto: JoinGroupDto,
  ) {
    return this.groups.join(
      { userId: user.sub, role: user.role },
      { ...(dto.token ? { token: dto.token } : {}), ...(dto.username ? { username: dto.username } : {}) },
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.groups.getGroup({ userId: user.sub, role: user.role }, id);
  }

  @Get(':id/messages')
  @HttpCode(HttpStatus.OK)
  async listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListMessagesSchema)) query: ListMessagesDto,
  ) {
    return this.groups.listMessages({ userId: user.sub, role: user.role }, id, query);
  }

  @Post(':id/messages')
  @RateLimit(30, '1m')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SendGroupMessageSchema)) dto: SendGroupMessageDto,
  ) {
    return this.groups.sendMessage(
      { userId: user.sub, role: user.role },
      id,
      dto.text ?? '',
      dto.assetId,
    );
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.groups.markRead({ userId: user.sub, role: user.role }, id);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  async addMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AddMembersSchema)) dto: AddMembersDto,
  ) {
    return this.groups.addMembers({ userId: user.sub, role: user.role }, id, dto.userIds);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    await this.groups.removeMember({ userId: user.sub, role: user.role }, id, userId);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateGroupSchema)) dto: UpdateGroupDto,
  ) {
    return this.groups.updateSettings({ userId: user.sub, role: user.role }, id, dto);
  }

  @Post(':id/invite')
  @HttpCode(HttpStatus.OK)
  async rotateInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.groups.rotateInvite({ userId: user.sub, role: user.role }, id);
  }

  @Delete(':id/invite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.groups.revokeInvite({ userId: user.sub, role: user.role }, id);
  }

  @Patch(':id/members/:userId/role')
  @HttpCode(HttpStatus.OK)
  async setRole(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(SetRoleSchema)) dto: SetRoleDto,
  ) {
    return this.groups.setMemberRole({ userId: user.sub, role: user.role }, id, userId, dto.role);
  }
}
