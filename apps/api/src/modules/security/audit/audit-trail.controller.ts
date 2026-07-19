import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';

import { AuditTrailService, type VerificationResult } from './audit-trail.service';
import type { AuditEntry } from './audit-storage.port';

/**
 * `AuditTrailController` — Task 30.3, Requirements 32.3 / 32.4.
 *
 * Admin-only endpoints for audit log integrity verification and
 * recent entry retrieval. These endpoints are protected by the
 * `ADMIN` role guard.
 */
@ApiTags('Security / Audit')
@Controller('security/audit')
export class AuditTrailController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  /**
   * Verify the integrity of the entire audit trail hash chain.
   *
   * Walks the chain from oldest to newest, recomputing each entry's
   * SHA-256 hash and verifying linkage. Returns whether the chain
   * is intact or where the first break occurred.
   */
  @Get('verify')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Verify audit trail integrity',
    description:
      'Walks the hash chain from genesis to head, verifying each entry. Admin-only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification result with chain integrity status.',
  })
  async verifyIntegrity(): Promise<VerificationResult> {
    return this.auditTrailService.verifyIntegrity();
  }

  /**
   * Retrieve recent audit entries (newest-first).
   */
  @Get('recent')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Get recent audit entries',
    description: 'Returns the most recent audit trail entries. Admin-only.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of entries to return (default: 50, max: 500)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of recent audit entries.',
  })
  async getRecent(@Query('limit') limit?: string): Promise<AuditEntry[]> {
    const parsedLimit = Math.min(
      Math.max(parseInt(limit ?? '50', 10) || 50, 1),
      500,
    );
    return this.auditTrailService.getRecent(parsedLimit);
  }
}
