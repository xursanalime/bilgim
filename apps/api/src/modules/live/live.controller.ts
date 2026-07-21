import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { LessonAccessGuard } from '../../common/guards/lesson-access.guard';
import { JwtPayload } from '../auth/tokens.service';
import {
  JoinSessionResult,
  LiveService,
  LiveSessionWithSfu,
} from './live.service';

/**
 * LiveController — REST endpoints for the live-session lifecycle
 * (Req 9.1 – 9.6, 9.8).
 *
 * Routes:
 *   POST /live/sessions/:lessonId/start   [TEACHER]            — owner-only via service ownership check
 *   POST /live/sessions/:lessonId/end     [TEACHER]            — owner-only via service ownership check
 *   POST /live/sessions/:lessonId/join    [TEACHER, STUDENT]   — gated by LessonAccessGuard (Req 9.4)
 *   GET  /live/sessions/:lessonId          [TEACHER, STUDENT, ADMIN] — gated by LessonAccessGuard
 *   GET  /live/sessions                    [TEACHER]            — list of sessions live RIGHT NOW for this teacher
 *
 * Why two layers of authz?
 *   - `start` and `end` are owner-only: the service issues a
 *     `LESSON_NOT_FOUND` / `NOT_OWNING_TEACHER` decision so we don't
 *     accidentally leak existence.
 *   - `join` is open to TEACHER and STUDENT, but enrollment-gating
 *     (Req 9.4) is enforced by `LessonAccessGuard`, which already
 *     understands the "owning teacher OR APPROVED student OR admin"
 *     predicate.
 */
@Controller('live')
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  /**
   * POST /live/sessions/:lessonId/start — Teacher starts a live session.
   *
   * Idempotent: hitting "Start" twice returns the existing LIVE
   * session (Req 9.1).
   */
  @Roles('TEACHER')
  @Post('sessions/:lessonId/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ): Promise<LiveSessionWithSfu> {
    return this.liveService.startSession(lessonId, user.sub);
  }

  /**
   * POST /live/sessions/:lessonId/end — Teacher ends a live session.
   *
   * Idempotent: ending an already-ENDED session returns the same row
   * with `sfu: null` instead of 409 (Req 9.5, 9.8).
   */
  @Roles('TEACHER')
  @Post('sessions/:lessonId/end')
  @HttpCode(HttpStatus.OK)
  async end(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.liveService.endSession(lessonId, user.sub);
  }

  /**
   * POST /live/sessions/:lessonId/join — Negotiate a WebRTC transport
   * for the current user.
   *
   * Authz: `LessonAccessGuard` ensures only the owning TEACHER, an
   * ADMIN auditor, or a STUDENT with APPROVED enrollment for the
   * lesson's group reaches the handler (Req 6.1 – 6.6, 9.4).
   *
   * Mapping the guard's role decision to the room role:
   *   - TEACHER (owner) → joins as TEACHER (producer-capable).
   *   - ADMIN           → joins as TEACHER role for read-only audit.
   *   - STUDENT         → joins as STUDENT (consumer-only at this layer).
   */
  @UseGuards(LessonAccessGuard)
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Post('sessions/:lessonId/join')
  @HttpCode(HttpStatus.OK)
  async join(
    @CurrentUser() user: JwtPayload,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ): Promise<JoinSessionResult> {
    const role: 'TEACHER' | 'STUDENT' =
      user.role === 'STUDENT' ? 'STUDENT' : 'TEACHER';
    return this.liveService.joinSession(lessonId, user.sub, role);
  }

  /**
   * GET /live/sessions/:lessonId — Lightweight heartbeat. Returns the
   * current session + SFU snapshot, or 404 once the session ends.
   * Gated by `LessonAccessGuard` so the same access rules as `join`
   * apply.
   */
  @UseGuards(LessonAccessGuard)
  @Roles('TEACHER', 'STUDENT', 'ADMIN')
  @Get('sessions/:lessonId')
  async getCurrent(
    @Req() _req: unknown,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
  ): Promise<LiveSessionWithSfu> {
    return this.liveService.heartbeat(lessonId);
  }

  /**
   * GET /live/sessions — All sessions currently LIVE for the calling
   * teacher's lessons. Used by the dashboard "Live now" widget.
   */
  @Roles('TEACHER')
  @Get('sessions')
  async listMine(@CurrentUser() user: JwtPayload) {
    return this.liveService.listActiveSessions(user.sub);
  }
}
