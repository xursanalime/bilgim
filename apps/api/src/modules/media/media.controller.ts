import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  CompleteUploadDto,
  CompleteUploadSchema,
} from './dto/complete-upload.dto';
import { InitUploadDto, InitUploadSchema } from './dto/init-upload.dto';
import {
  MediaService,
  type UploadAborted,
  type UploadCompleted,
  type UploadInitiated,
} from './media.service';

/**
 * MediaController — REST endpoints for the R2 multipart upload pipeline
 * (Req 8.1, 8.2, 8.6, 8.7, 8.8).
 *
 *   POST /media/uploads               [TEACHER, ADMIN]
 *   POST /media/uploads/:id/complete  [TEACHER, ADMIN]
 *   POST /media/uploads/:id/abort     [TEACHER, ADMIN]
 *
 * RBAC (Req 8.8 / 17.x): only TEACHER and ADMIN can initiate or finalize
 * uploads. STUDENT submissions go through a separate (future) endpoint
 * that delegates to the same MediaService but with stricter content-type
 * rules.
 *
 * Authorization is double-checked at the service layer: every method
 * verifies the asset belongs to `user.sub` so an admin (when implemented)
 * cannot finalize someone else's upload.
 */
@Controller('media/uploads')
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * POST /media/uploads — Begin a new multipart upload. The response
   * includes the asset id, R2 upload id, and a list of pre-signed PUT
   * URLs (one per part). Clients PUT each part directly to R2 and then
   * call `/complete` with the returned ETags.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async initUpload(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(InitUploadSchema)) dto: InitUploadDto,
  ): Promise<UploadInitiated> {
    return this.mediaService.initiateUpload(user.sub, dto);
  }

  /**
   * POST /media/uploads/:id/complete — Finalize the multipart upload.
   * Transitions MediaAsset UPLOADING → UPLOADED.
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Body(new ZodValidationPipe(CompleteUploadSchema)) dto: CompleteUploadDto,
  ): Promise<UploadCompleted> {
    return this.mediaService.completeUpload(user.sub, assetId, dto);
  }

  /**
   * POST /media/uploads/:id/abort — Cancel the multipart upload and
   * mark the MediaAsset as FAILED.
   */
  @Post(':id/abort')
  @HttpCode(HttpStatus.OK)
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
  ): Promise<UploadAborted> {
    return this.mediaService.abortUpload(user.sub, assetId);
  }
}
