import {
  BadRequestException,
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
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  BulkUpdatePreferencesDto,
  BulkUpdatePreferencesSchema,
  ListNotificationsQuery,
  ListNotificationsQuerySchema,
  NotificationChannelSchema,
  NotificationKindSchema,
  RegisterDeviceDto,
  RegisterDeviceSchema,
  UpdatePreferenceDto,
  UpdatePreferenceSchema,
} from './dto';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsController — REST surface for in-app notifications and the
 * per-kind / per-channel preference matrix (Req 16.1, 16.3).
 *
 * Auth: every route requires an authenticated user (no `@Public`). All
 * routes are scoped to the calling user — a STUDENT cannot read another
 * STUDENT's notifications, etc.
 */
@Controller('notifications')
@Roles('STUDENT', 'TEACHER', 'ADMIN')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications — paginated list of the caller's notifications.
   * Query params: `cursor` (ISO timestamp), `limit` (1..50), `unreadOnly`.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(ListNotificationsQuerySchema))
    query: ListNotificationsQuery,
  ) {
    return this.notificationsService.listForUser(user.sub, {
      cursor: query.cursor,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
    });
  }

  /** GET /notifications/unread-count — badge counter for the navbar. */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.notificationsService.unreadCount(user.sub);
    return { count };
  }

  /** PATCH /notifications/:id/read — mark a single notification as read. */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.markRead(user.sub, id);
  }

  /** POST /notifications/mark-all-read — bulk mark as read. */
  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllRead(user.sub);
  }

  /** GET /notifications/preferences — full kind × channel matrix. */
  @Get('preferences')
  @Roles('STUDENT', 'TEACHER')
  async getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getPreferences(user.sub);
  }

  /**
   * PATCH /notifications/preferences — bulk update.
   *
   * Body: `{ preferences: [{ kind, channel, enabled }, ...] }`. The
   * response includes the post-update full matrix so the client can
   * refresh its settings page without a follow-up GET.
   *
   * Scoped to STUDENT and TEACHER (Task 14.3) — admin notification
   * preferences are managed at the platform level, not via this route.
   */
  @Patch('preferences')
  @Roles('STUDENT', 'TEACHER')
  @HttpCode(HttpStatus.OK)
  async bulkUpdatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(BulkUpdatePreferencesSchema))
    dto: BulkUpdatePreferencesDto,
  ) {
    return this.notificationsService.updatePreferencesBulk(
      user.sub,
      dto.preferences,
    );
  }

  /**
   * PUT /notifications/preferences/:kind/:channel — flip a single
   * preference. `kind` and `channel` are validated against the Zod
   * enums; unknown values return 400 BAD REQUEST.
   *
   * IN_APP is always-on (Task 14.3 / Req 16.1) — attempts to disable
   * it return 400 with `PREFERENCE_IN_APP_LOCKED`.
   */
  @Put('preferences/:kind/:channel')
  @Roles('STUDENT', 'TEACHER')
  @HttpCode(HttpStatus.OK)
  async updatePreference(
    @CurrentUser() user: JwtPayload,
    @Param('kind') kindParam: string,
    @Param('channel') channelParam: string,
    @Body(new ZodValidationPipe(UpdatePreferenceSchema))
    dto: UpdatePreferenceDto,
  ) {
    const kindParse = NotificationKindSchema.safeParse(kindParam);
    const channelParse = NotificationChannelSchema.safeParse(channelParam);
    if (!kindParse.success || !channelParse.success) {
      throw new BadRequestException({
        code: 'PREFERENCE_INVALID',
        message: 'Unknown notification kind or channel',
      });
    }
    if (channelParse.data === 'IN_APP' && dto.enabled === false) {
      throw new BadRequestException({
        code: 'PREFERENCE_IN_APP_LOCKED',
        message: 'IN_APP channel is always-on and cannot be disabled',
      });
    }
    if (channelParse.data === 'IN_APP') {
      // IN_APP is always-on — the request is a no-op. Return the
      // canonical "enabled" payload for client UX continuity.
      return {
        kind: kindParse.data,
        channel: channelParse.data,
        enabled: true,
      };
    }
    return this.notificationsService.updatePreference(
      user.sub,
      kindParse.data,
      channelParse.data,
      dto.enabled,
    );
  }

  // ------------------------------------------------------------------
  // Push devices (Task 22.2, Req 16.1)
  // ------------------------------------------------------------------

  /**
   * POST /notifications/devices — register / refresh an Expo push
   * token for the calling user.
   *
   * The mobile app calls this once on first launch (after the user
   * grants notification permission) and again on every cold boot to
   * keep `lastSeenAt` fresh. The endpoint is idempotent on
   * `(userId, token)` so re-registering is safe.
   */
  @Post('devices')
  @HttpCode(HttpStatus.OK)
  async registerDevice(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(RegisterDeviceSchema))
    dto: RegisterDeviceDto,
  ) {
    return this.notificationsService.registerPushDevice({
      userId: user.sub,
      token: dto.token,
      platform: dto.platform,
      deviceInfo: dto.deviceInfo ?? null,
    });
  }

  /**
   * DELETE /notifications/devices/:token — forget a push token
   * (typically called on logout or when the user removes a device).
   */
  @Delete('devices/:token')
  @HttpCode(HttpStatus.OK)
  async unregisterDevice(
    @CurrentUser() user: JwtPayload,
    @Param('token') token: string,
  ) {
    if (!token || token.length === 0) {
      throw new BadRequestException({
        code: 'PUSH_DEVICE_TOKEN_REQUIRED',
        message: 'Push device token is required',
      });
    }
    return this.notificationsService.unregisterPushDevice(user.sub, token);
  }
}
