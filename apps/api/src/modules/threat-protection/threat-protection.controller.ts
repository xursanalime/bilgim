import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  ThreatProtectionService,
  WafBlockEntry,
} from './threat-protection.service';
import { WAF_AUDIT_ACTIONS } from './threat-protection.guard';
import { AdminAuditService } from '../admin/admin-audit.service';

// ------------------------------------------------------------------
// DTOs
// ------------------------------------------------------------------

export const ListBlockedIpsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
});
export type ListBlockedIpsQueryDto = z.infer<typeof ListBlockedIpsQuerySchema>;

export const UnblockIpBodySchema = z.object({
  ip: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[0-9a-fA-F:.\\/]+$/, {
      message: 'Invalid IP — only IPv4 / IPv6 characters are accepted',
    }),
  reason: z.string().min(1).max(500).optional(),
});
export type UnblockIpBodyDto = z.infer<typeof UnblockIpBodySchema>;

/**
 * ThreatProtectionController — admin surface for the application-side
 * WAF (Task 27.1, Requirements 27.1, 27.2).
 *
 * Two endpoints:
 *   - `GET  /admin/threat-protection/blocked-ips` — paginated read
 *     of the active blocklist with reason + expiry.
 *   - `POST /admin/threat-protection/unblock` — manual remove with
 *     audit-log entry. Requires `Idempotency-Key` so a flaky admin
 *     console cannot accidentally double-fire and lose the audit
 *     pair-up.
 *
 * Auth: every route is `@Roles('ADMIN')` and protected by
 * `JwtAuthGuard`. The explicit annotation here mirrors `AdminController`
 * + `AdminOpsController` and satisfies the auth-completeness scanner.
 */
@Controller('admin/threat-protection')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class ThreatProtectionController {
  constructor(
    private readonly threatProtection: ThreatProtectionService,
    private readonly auditService: AdminAuditService,
  ) {}

  /** GET /admin/threat-protection/blocked-ips */
  @Get('blocked-ips')
  @HttpCode(HttpStatus.OK)
  async listBlockedIps(
    @Query(new ZodValidationPipe(ListBlockedIpsQuerySchema))
    query: ListBlockedIpsQueryDto,
  ): Promise<{ blockedIps: WafBlockEntry[]; total: number }> {
    const blockedIps = await this.threatProtection.listBlockedIps(query.limit);
    return {
      blockedIps,
      total: blockedIps.length,
    };
  }

  /** POST /admin/threat-protection/unblock */
  @Post('unblock')
  @HttpCode(HttpStatus.OK)
  async unblockIp(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UnblockIpBodySchema)) dto: UnblockIpBodyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Ip() requestIp: string,
  ): Promise<{ ip: string; unblocked: boolean }> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for admin mutations',
      });
    }
    const unblocked = await this.threatProtection.unblockIp(dto.ip);
    await this.auditService.log(
      user.sub,
      WAF_AUDIT_ACTIONS.IP_UNBLOCKED,
      dto.ip,
      {
        unblocked,
        reason: dto.reason ?? null,
      },
      { ip: requestIp },
    );
    return { ip: dto.ip, unblocked };
  }
}
