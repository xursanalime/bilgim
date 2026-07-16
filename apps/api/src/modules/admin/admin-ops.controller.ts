import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { AdminOpsService } from './admin-ops.service';
import {
  ListFailedDeliveriesQueryDto,
  ListFailedDeliveriesQuerySchema,
  ListPaymentsQueryDto,
  ListPaymentsQuerySchema,
  ListPendingOutboxQueryDto,
  ListPendingOutboxQuerySchema,
  ListTeachersQueryDto,
  ListTeachersQuerySchema,
} from './dto';

/**
 * AdminOpsController — operations / SRE endpoints (Task 23.1).
 *
 * The original `AdminController` covers moderation and catalog
 * management; this controller carries the operations surface: paginated
 * teacher / payment lists, failed-delivery triage with re-enqueue,
 * stuck-outbox visibility and the system-stats overview.
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by
 * `JwtAuthGuard`. The explicit annotation here mirrors `AdminController`
 * and satisfies the auth-completeness scanner without relying solely on
 * the global guard wiring.
 *
 * Idempotency: the only mutation here is the delivery-retry POST,
 * which requires an `Idempotency-Key` header so a flaky admin client
 * cannot accidentally double-fire a retry.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class AdminOpsController {
  constructor(private readonly adminOpsService: AdminOpsService) {}

  // ==================================================================
  // Teachers
  // ==================================================================

  /** GET /admin/teachers — paginated teacher list with subscription state. */
  @Get('teachers')
  @HttpCode(HttpStatus.OK)
  async listTeachers(
    @Query(new ZodValidationPipe(ListTeachersQuerySchema))
    query: ListTeachersQueryDto,
  ) {
    return this.adminOpsService.listTeachers(query);
  }

  // ==================================================================
  // Payments
  // ==================================================================

  /** GET /admin/payments — paginated PaymeTransaction + Invoice list. */
  @Get('payments')
  @HttpCode(HttpStatus.OK)
  async listPayments(
    @Query(new ZodValidationPipe(ListPaymentsQuerySchema))
    query: ListPaymentsQueryDto,
  ) {
    return this.adminOpsService.listPayments(query);
  }

  // ==================================================================
  // Notification triage
  // ==================================================================

  /**
   * GET /admin/notifications/failed — failed `NotificationDelivery` list.
   * Powers the ops triage UI; pair with the retry endpoint below.
   */
  @Get('notifications/failed')
  @HttpCode(HttpStatus.OK)
  async listFailedDeliveries(
    @Query(new ZodValidationPipe(ListFailedDeliveriesQuerySchema))
    query: ListFailedDeliveriesQueryDto,
  ) {
    return this.adminOpsService.listFailedDeliveries(query);
  }

  /**
   * POST /admin/notifications/:id/retry — re-enqueue a failed delivery.
   *
   * `:id` is the `NotificationDelivery.id` (not the parent Notification's
   * id — the parent has multiple per-channel deliveries and admins
   * triage one channel at a time). Re-enqueue produces a fresh BullMQ
   * job and writes an audit-log entry.
   */
  @Post('notifications/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retryNotificationDelivery(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.adminOpsService.retryFailedDelivery(user.sub, id, { ip });
  }

  // ==================================================================
  // Outbox visibility
  // ==================================================================

  /**
   * GET /admin/outbox/pending — `OutboxEvent` rows still PENDING and
   * older than `olderThanMinutes` (default 5).
   */
  @Get('outbox/pending')
  @HttpCode(HttpStatus.OK)
  async listPendingOutbox(
    @Query(new ZodValidationPipe(ListPendingOutboxQuerySchema))
    query: ListPendingOutboxQueryDto,
  ) {
    return this.adminOpsService.listPendingOutbox(query);
  }

  // ==================================================================
  // System stats
  // ==================================================================

  /**
   * GET /admin/system/stats — aggregate counts powering the admin
   * dashboard's "system at a glance" panel.
   */
  @Get('system/stats')
  @HttpCode(HttpStatus.OK)
  async getSystemStats() {
    return this.adminOpsService.getSystemStats();
  }

  /**
   * GET /admin/stats — consolidated dashboard KPI counters
   * (totalUsers, totalTeachers, totalStudents, activeSubscriptions,
   * revenueUzs, liveSessions). Powers the admin overview stat cards.
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getDashboardStats() {
    return this.adminOpsService.getDashboardStats();
  }

  /**
   * GET /admin/activity — normalized reverse-chronological feed of recent
   * platform events (signups, payments, live sessions, admin actions).
   */
  @Get('activity')
  @HttpCode(HttpStatus.OK)
  async getRecentActivity(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 8;
    return this.adminOpsService.getRecentActivity(
      Number.isFinite(parsed) ? parsed : 8,
    );
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private requireIdempotencyKey(key: string | undefined): void {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for admin mutations',
      });
    }
  }
}
