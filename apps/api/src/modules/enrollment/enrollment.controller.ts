import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import {
  CreatedInvite,
  EnrollmentService,
  InviteResolution,
} from './enrollment.service';
import { CreateInviteDto, CreateInviteSchema } from './dto/create-invite.dto';
import {
  CreateEnrollmentRequestDto,
  CreateEnrollmentRequestSchema,
} from './dto/create-request.dto';

/**
 * EnrollmentController — REST endpoints for the enrollment funnel
 * (Requirements 5.1 – 5.7).
 *
 * Route layout:
 *   - POST   /enrollment/invite-links           [TEACHER]
 *   - GET    /enrollment/invite/:token          [PUBLIC]
 *   - GET    /enrollment/requests               [TEACHER]
 *   - POST   /enrollment/requests/:id/approve   [TEACHER]
 *   - POST   /enrollment/requests/:id/reject    [TEACHER]
 *   - GET    /enrollment/my-enrollments         [STUDENT]
 */
@Controller('enrollment')
export class EnrollmentController {
  constructor(private readonly enrollmentService: EnrollmentService) {}

  /**
   * POST /enrollment/invite-links — Create an invite link for a group
   * the calling teacher owns. (Req 5.1)
   */
  @Roles('TEACHER')
  @Post('invite-links')
  @HttpCode(HttpStatus.CREATED)
  async createInviteLink(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateInviteSchema)) dto: CreateInviteDto,
  ): Promise<CreatedInvite> {
    return this.enrollmentService.createInviteLink(user.sub, dto);
  }

  /**
   * GET /enrollment/code/:code — Find a group by its unique join code.
   * Gated for students to prevent general exploration.
   */
  @Roles('STUDENT')
  @Get('code/:code')
  async findByCode(
    @Param('code') code: string,
  ): Promise<InviteResolution> {
    return this.enrollmentService.findGroupByCode(code.toUpperCase());
  }

  /**
   * GET /enrollment/invite/:token — Public landing-page resolver. Returns
   * 404 INVITE_NOT_FOUND on expired / fully-used / inactive tokens (Req 5.7).
   */
  @Public()
  @Get('invite/:token')
  async resolveInvite(
    @Param('token') token: string,
  ): Promise<InviteResolution> {
    return this.enrollmentService.resolveInvite(token);
  }

  /**
   * GET /enrollment/requests — List pending enrollment requests for any
   * group the calling teacher owns. Used by the "Requests" inbox.
   */
  @Roles('TEACHER')
  @Get('requests')
  async listPendingRequests(@CurrentUser() user: JwtPayload) {
    return this.enrollmentService.listPendingRequestsForTeacher(user.sub);
  }

  /**
   * GET /enrollment/students — List approved students across any group the
   * calling teacher owns. Used by the "Students" CRM page.
   */
  @Roles('TEACHER')
  @Get('students')
  async listStudents(@CurrentUser() user: JwtPayload) {
    return this.enrollmentService.listStudentsForTeacher(user.sub);
  }

  /**
   * POST /enrollment/requests/:id/approve — Approve a pending request and
   * create the Enrollment row. Emits `enrollment.approved`. (Req 5.4, 5.6)
   */
  @Roles('TEACHER')
  @Post('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.enrollmentService.approveRequest(user.sub, requestId);
  }

  /**
   * POST /enrollment/requests/:id/reject — Reject a pending request and
   * emit `enrollment.rejected`. Does NOT create an Enrollment row. (Req 5.5)
   */
  @Roles('TEACHER')
  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) requestId: string,
  ) {
    return this.enrollmentService.rejectRequest(user.sub, requestId);
  }

  /**
   * POST /enrollment/requests — A student submits a direct join request for
   * a group (no upfront payment). Lands in the teacher's inbox as
   * PENDING_APPROVAL. (Direct-join flow)
   */
  @Roles('STUDENT')
  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  async createRequest(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateEnrollmentRequestSchema))
    dto: CreateEnrollmentRequestDto,
  ) {
    return this.enrollmentService.createRequest(user.sub, dto);
  }

  /**
   * GET /enrollment/my-requests — The calling student's own join requests
   * across all statuses (PENDING_APPROVAL / APPROVED / REJECTED).
   */
  @Roles('STUDENT')
  @Get('my-requests')
  async myRequests(@CurrentUser() user: JwtPayload) {
    return this.enrollmentService.listRequestsForStudent(user.sub);
  }

  /**
   * GET /enrollment/my-enrollments — Return the calling student's
   * APPROVED enrollments. Used by the student dashboard.
   */
  @Roles('STUDENT')
  @Get('my-enrollments')
  async myEnrollments(@CurrentUser() user: JwtPayload) {
    return this.enrollmentService.listEnrollmentsForStudent(user.sub);
  }
}
