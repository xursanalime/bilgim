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
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { JwtPayload } from '../../auth/tokens.service';
import { AiConversationsService } from './ai-conversations.service';

@Controller('ai/conversations')
@Roles('STUDENT', 'TEACHER', 'ADMIN')
export class AiConversationsController {
  constructor(private readonly svc: AiConversationsService) {}

  /** GET /ai/conversations — list current user's conversations */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.listConversations(user.sub);
  }

  /** POST /ai/conversations — create a new conversation */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { title?: string },
  ) {
    return this.svc.createConversation(user.sub, { title: body.title ?? undefined });
  }

  /** GET /ai/conversations/:id — get conversation with messages */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.getConversation(user.sub, id);
  }

  /** PATCH /ai/conversations/:id — rename conversation */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { title: string },
  ) {
    return this.svc.renameConversation(user.sub, id, { title: body.title });
  }

  /** DELETE /ai/conversations/:id — delete conversation */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.deleteConversation(user.sub, id);
  }

  /** DELETE /ai/conversations/:id/messages — clear all messages */
  @Delete(':id/messages')
  @HttpCode(HttpStatus.OK)
  clear(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.clearConversation(user.sub, id);
  }

  /** POST /ai/conversations/:id/messages — send message, get AI reply */
  @Post(':id/messages')
  @RateLimit(60, '10m')
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: {
      content: string;
      attachments?: Array<{
        name: string;
        type: string;
        size: number;
        url?: string;
        assetId?: string;
        extractedText?: string;
      }>;
      locale?: 'uz' | 'ru' | 'en';
    },
  ) {
    return this.svc.sendMessage(
      user.sub,
      user.role as 'STUDENT' | 'TEACHER' | 'ADMIN',
      id,
      body,
    );
  }
}
