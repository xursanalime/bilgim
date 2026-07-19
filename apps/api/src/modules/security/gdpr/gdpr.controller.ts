/**
 * `modules/security/gdpr/gdpr.controller.ts` — Task 30.4
 *
 * REST endpoints for GDPR Data Subject Requests.
 * Implements Requirement 32.2: data access, rectification, erasure,
 * and portability with 30-day SLA tracking.
 *
 * Routes:
 *   POST /gdpr/requests/access       — submit data access request
 *   POST /gdpr/requests/rectification — submit rectification request
 *   POST /gdpr/requests/erasure       — submit erasure request
 *   POST /gdpr/requests/portability   — submit portability request
 *   GET  /gdpr/requests               — list user's own requests
 *   GET  /gdpr/requests/:id           — get request details
 *   GET  /gdpr/requests/:id/sla       — check SLA status
 *   POST /gdpr/requests/:id/process   — process a pending request (admin)
 *   POST /gdpr/requests/:id/reject    — reject a request (admin)
 *   GET  /gdpr/requests/overdue       — list overdue requests (admin)
 */
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { GdprService } from './gdpr.service';
import {
  CreateAccessRequestDto,
  CreateRectificationRequestDto,
  CreateErasureRequestDto,
  CreatePortabilityRequestDto,
  DataSubjectRequest,
  SlaStatus,
} from './gdpr-request.types';

/**
 * Controller for GDPR data subject rights endpoints.
 *
 * In production, these endpoints would be protected by:
 * - Authentication guard (user must be logged in)
 * - Identity verification for sensitive operations (erasure)
 * - Admin role guard for processing/rejection endpoints
 *
 * The `userId` is extracted from the authenticated session.
 * For simplicity in this implementation, it's passed as a header
 * or derived from the request context.
 */
@Controller('gdpr/requests')
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  // -------------------------------------------------------------------------
  // Data subject endpoints (authenticated user)
  // -------------------------------------------------------------------------

  /**
   * Submit a data access request (Art. 15).
   */
  @Post('access')
  @HttpCode(HttpStatus.CREATED)
  async submitAccessRequest(
    @Body() dto: CreateAccessRequestDto & { userId: string },
  ): Promise<DataSubjectRequest> {
    return this.gdprService.submitAccessRequest(dto.userId, dto);
  }

  /**
   * Submit a data rectification request (Art. 16).
   */
  @Post('rectification')
  @HttpCode(HttpStatus.CREATED)
  async submitRectificationRequest(
    @Body() dto: CreateRectificationRequestDto & { userId: string },
  ): Promise<DataSubjectRequest> {
    return this.gdprService.submitRectificationRequest(dto.userId, dto);
  }

  /**
   * Submit a data erasure request (Art. 17).
   */
  @Post('erasure')
  @HttpCode(HttpStatus.CREATED)
  async submitErasureRequest(
    @Body() dto: CreateErasureRequestDto & { userId: string },
  ): Promise<DataSubjectRequest> {
    return this.gdprService.submitErasureRequest(dto.userId, dto);
  }

  /**
   * Submit a data portability request (Art. 20).
   */
  @Post('portability')
  @HttpCode(HttpStatus.CREATED)
  async submitPortabilityRequest(
    @Body() dto: CreatePortabilityRequestDto & { userId: string },
  ): Promise<DataSubjectRequest> {
    return this.gdprService.submitPortabilityRequest(dto.userId, dto);
  }

  /**
   * List all requests for the authenticated user.
   */
  @Get()
  async listUserRequests(
    @Body() body: { userId: string },
  ): Promise<DataSubjectRequest[]> {
    return this.gdprService.getUserRequests(body.userId);
  }

  /**
   * Get a specific request by ID.
   */
  @Get(':id')
  async getRequest(@Param('id') id: string): Promise<DataSubjectRequest> {
    return this.gdprService.getRequest(id);
  }

  /**
   * Check SLA status for a request.
   */
  @Get(':id/sla')
  async getSlaStatus(@Param('id') id: string): Promise<SlaStatus> {
    const request = await this.gdprService.getRequest(id);
    return this.gdprService.getSlaStatus(request);
  }

  // -------------------------------------------------------------------------
  // Admin endpoints
  // -------------------------------------------------------------------------

  /**
   * Process a pending request (admin action).
   */
  @Post(':id/process')
  @HttpCode(HttpStatus.OK)
  async processRequest(@Param('id') id: string): Promise<DataSubjectRequest> {
    return this.gdprService.processRequest(id);
  }

  /**
   * Reject a request with a reason (admin action).
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ): Promise<DataSubjectRequest> {
    return this.gdprService.rejectRequest(id, body.reason);
  }

  /**
   * List all overdue requests (admin dashboard).
   */
  @Get('overdue')
  async getOverdueRequests(): Promise<DataSubjectRequest[]> {
    return this.gdprService.getOverdueRequests();
  }
}
