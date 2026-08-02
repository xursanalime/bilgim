import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../auth/tokens.service';
import { AdminAuditService } from '../../admin/admin-audit.service';
import { IpBlockListEntry, IpBlocklistService } from './ip-blocklist.service';

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
 * IpBlocklistAdminController — admin surface for `IpBlocklistService`
 * (Redis keys `security:blocklist:ip:*`), the store `IpBlocklistGuard`
 * checks on every request before anything else runs.
 *
 * This is a **separate** blocklist from the one exposed under
 * `admin/threat-protection` (Redis keys `waf:blocked:*`, owned by
 * `ThreatProtectionService`). The two guards reject with different
 * error bodies and read different Redis namespaces, so unblocking
 * through the WAF admin endpoint does not clear an entry here. Before
 * this controller existed there was no way to clear a
 * `security:blocklist:ip:*` entry short of waiting out its TTL
 * (up to 7d for threat-intel imports) or deleting the key directly in
 * Redis — which mattered because every browser call is proxied
 * through the Next.js BFF's shared address (see
 * `trusted-client-ip.middleware.ts`), so a single burst of abuse could
 * land this block on the address the whole user base shares and lock
 * out the platform until someone with Redis access stepped in.
 *
 * Auth: `@Roles('ADMIN')` + `JwtAuthGuard`, mirroring
 * `ThreatProtectionController`. `unblock` requires `Idempotency-Key`
 * for the same reason — a retried admin-console click must not double
 * fire and desync the audit trail.
 */
@Controller('admin/ip-blocklist')
@UseGuards(JwtAuthGuard)
@Roles('ADMIN')
export class IpBlocklistAdminController {
  constructor(
    private readonly blocklist: IpBlocklistService,
    private readonly auditService: AdminAuditService,
  ) {}

  /** GET /admin/ip-blocklist */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query(new ZodValidationPipe(ListBlockedIpsQuerySchema))
    query: ListBlockedIpsQueryDto,
  ): Promise<{ blockedIps: IpBlockListEntry[]; total: number }> {
    const blockedIps = await this.blocklist.listBlocked(query.limit);
    return { blockedIps, total: blockedIps.length };
  }

  /** POST /admin/ip-blocklist/unblock */
  @Post('unblock')
  @HttpCode(HttpStatus.OK)
  async unblock(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UnblockIpBodySchema)) dto: UnblockIpBodyDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<{ ip: string; unblocked: boolean }> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required for admin mutations',
      });
    }
    const unblocked = await this.blocklist.unblock(dto.ip);
    await this.auditService.log(
      user.sub,
      'security.ip_blocklist.unblocked',
      dto.ip,
      { unblocked, reason: dto.reason ?? null },
    );
    return { ip: dto.ip, unblocked };
  }
}
