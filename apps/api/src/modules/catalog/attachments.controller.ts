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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { CatalogService } from './catalog.service';
import { CreateAttachmentDto, CreateAttachmentSchema } from './dto';

/**
 * AttachmentsController — REST endpoints for linking MediaAssets to
 * Lessons. The teacher first uploads a file via `/media/uploads/*`, then
 * calls `POST /catalog/lessons/:lessonId/attachments` with the resulting
 * `assetId` to surface it on the lesson page.
 *
 * Routes:
 *   POST   /catalog/lessons/:lessonId/attachments   [TEACHER]
 *   GET    /catalog/lessons/:lessonId/attachments   [TEACHER]
 *   DELETE /catalog/attachments/:id                 [TEACHER]
 */
@Controller('catalog')
@Roles('TEACHER')
export class AttachmentsController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('lessons/:lessonId/attachments')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(CreateAttachmentSchema)) dto: CreateAttachmentDto,
  ) {
    return this.catalogService.createAttachment(user.sub, lessonId, dto as any);
  }

  @Get('lessons/:lessonId/attachments')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.catalogService.listAttachmentsForLesson(user.sub, lessonId);
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.catalogService.deleteAttachment(user.sub, id);
  }

  @Patch('attachments/:id')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: { role?: string; caption?: string | null; position?: number },
  ) {
    return this.catalogService.updateAttachment(user.sub, id, dto);
  }
}
