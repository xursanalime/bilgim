import {
  BadRequestException,
  Body,
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
import {
  IngestAnomalySignalsDto,
  IngestAnomalySignalsSchema,
  LookupSessionsQueryDto,
  LookupSessionsQuerySchema,
} from './dto';
import { AdminProtectionSessionsService } from './protection-sessions.service';

/**
 * AdminProtectionController — leak detection & response support
 * (content-protection-backend, Task 4.2 / Req 6.3, 6.4).
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by `JwtAuthGuard`,
 * mirroring `AdminController` / `AdminOpsController`. These endpoints
 * expose learner identity behind a watermark/session marker, so they are
 * strictly admin-only and the service audit-logs every access.
 */
@Controller('admin/protection')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class AdminProtectionController {
  constructor(
    private readonly protectionSessionsService: AdminProtectionSessionsService,
  ) {}

  // ==================================================================
  // Watermark / session → learner lookup (Req 6.4)
  // ==================================================================

  /**
   * GET /admin/protection/sessions?viewerTag=...&viewerUserId=...&assetId=...
   *
   * Map a watermark/session marker back to the learner identity behind
   * the recorded playback sessions. At least one selector is required
   * (enforced by the Zod schema). An unknown marker returns an empty
   * page rather than a 404 — the search distinguishes "no such session"
   * from a failure.
   */
  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  async lookupSessions(
    @CurrentUser() user: JwtPayload,
    @Query(new ZodValidationPipe(LookupSessionsQuerySchema))
    query: LookupSessionsQueryDto,
    @Ip() ip: string,
  ) {
    return this.protectionSessionsService.lookupSessions(user.sub, query, {
      ip,
    });
  }

  /**
   * GET /admin/protection/sessions/:id — resolve a single playback
   * session by id to its learner identity. 404s when the id is unknown.
   */
  @Get('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async getSessionById(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ip() ip: string,
  ) {
    return this.protectionSessionsService.getSessionById(user.sub, id, { ip });
  }

  // ==================================================================
  // Provider anomaly / concurrency ingestion (Req 6.3) — dev no-op seam
  // ==================================================================

  /**
   * POST /admin/protection/anomaly-signals — provider-agnostic seam to
   * ingest DRM_Provider concurrency/anomaly signals (Req 6.3).
   *
   * Requires an `Idempotency-Key` (parity with other admin writes) so a
   * provider/webhook retry cannot double-record a batch. Until a real
   * DRM_Provider is wired, signals are accepted and dropped by a clearly
   * flagged dev no-op (`devNoop: true` in the response).
   */
  @Post('anomaly-signals')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestAnomalySignals(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(IngestAnomalySignalsSchema))
    dto: IngestAnomalySignalsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() ip: string,
  ) {
    this.requireIdempotencyKey(idempotencyKey);
    return this.protectionSessionsService.ingestAnomalySignals(user.sub, dto, {
      ip,
    });
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
