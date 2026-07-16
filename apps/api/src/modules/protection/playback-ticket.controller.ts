import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../auth/tokens.service';
import { PlaybackTicket, PlaybackTicketService } from './playback-ticket.service';

/**
 * Query schema for `GET /media/assets/:id/playback-ticket`.
 *
 * `lessonId` is the OPTIONAL lesson context the ticket is issued under
 * (recorded on the `PlaybackSession` for tracing). It is validated as a
 * uuid when present; entitlement is still resolved server-side from the
 * asset's group regardless of this value, so it can never be used to
 * widen access.
 */
const PlaybackTicketQuerySchema = z.object({
  lessonId: z.string().uuid('lessonId must be a uuid').optional(),
});

type PlaybackTicketQuery = z.infer<typeof PlaybackTicketQuerySchema>;

/**
 * Minimal structural view of the Express request we depend on — declared
 * locally (rather than importing `Request` from `express`) to match the
 * convention used by `ProtectedFileController` and keep unit tests free of
 * an `@types/express` dependency.
 */
export interface PlaybackTicketRequest {
  ip?: string | undefined;
  socket?: { remoteAddress?: string | undefined } | undefined;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * PlaybackTicketController — issues short-lived signed Playback_Tickets
 * (content-protection-backend Req 1.1–1.4, 3.1, 3.3).
 *
 *   GET /media/assets/:id/playback-ticket?lessonId=  [TEACHER, STUDENT, ADMIN]
 *
 * Auth is enforced by the global `JwtAuthGuard` + `RolesGuard`; the
 * `@Roles(...)` decorator restricts the route to authenticated learners /
 * teachers / admins. Authorization (the APPROVED-entitlement check) and
 * all ticket material are produced entirely server-side by
 * {@link PlaybackTicketService.issueTicket}:
 *
 *   - a caller WITHOUT an APPROVED Entitlement receives `403
 *     MEDIA_ACCESS_DENIED` and NO media payload (Req 1.2, Property 1);
 *   - an entitled caller receives a ticket whose only media reference is
 *     a short-lived signed manifest reference — never a permanent storage
 *     URL (Req 1.1, 1.4).
 */
@Controller('media/assets')
@Roles('TEACHER', 'STUDENT', 'ADMIN')
export class PlaybackTicketController {
  constructor(private readonly ticketService: PlaybackTicketService) {}

  @Get(':id/playback-ticket')
  @HttpCode(HttpStatus.OK)
  async issuePlaybackTicket(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) assetId: string,
    @Query(new ZodValidationPipe(PlaybackTicketQuerySchema))
    query: PlaybackTicketQuery,
    @Req() req: PlaybackTicketRequest,
  ): Promise<PlaybackTicket> {
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader;
    const ip = req.ip ?? req.socket?.remoteAddress;

    return this.ticketService.issueTicket({
      viewer: user,
      assetId,
      lessonId: query.lessonId,
      ip,
      userAgent,
    });
  }
}
