import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LiveSession, Prisma, PrismaClient } from '@prisma/client';

import { OutboxService } from '../../infra/outbox/outbox.service';
import { LiveSessionRepository } from './repositories/live-session.repository';
import { LiveKitRoomSnapshot, LiveKitService } from './sfu/livekit.service';

/**
 * Public-shape returned by `startSession` / `joinSession`. Pairs the
 * LiveSession DB row with the LiveKit room snapshot.
 */
export interface LiveSessionWithSfu {
  session: LiveSession;
  sfu: LiveKitRoomSnapshot;
  /** The lesson's own title — used by the room UI instead of the raw lessonId. */
  lessonTitle?: string | undefined;
}

/** Shape returned by `joinSession`: session + room + a freshly-allocated token. */
export interface JoinSessionResult extends LiveSessionWithSfu {
  /** LiveKit Access Token for the joining peer. */
  token: string;
  /** Role of the joining user inside the room. */
  role: 'TEACHER' | 'STUDENT';
}

/** How long before `lesson.scheduledAt` a STUDENT may join the waiting room even if the teacher hasn't started the broadcast yet. */
const EARLY_JOIN_MS = 15 * 60 * 1000;

/**
 * LiveService — owns the LiveSession lifecycle using LiveKit (Req 9.1 - 9.8).
 */
@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly liveKitService: LiveKitService,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Start a live session for a lesson owned by `teacherId`.
   */
  async startSession(
    lessonId: string,
    teacherId: string,
  ): Promise<LiveSessionWithSfu> {
    await this.assertTeacherOwnsLesson(lessonId, teacherId);

    const room = await this.liveKitService.ensureRoom(lessonId);
    const groupId = await this.loadGroupId(lessonId);

    // A student may already be waiting in a SCHEDULED session (early-join
    // window, see `joinSession`) — promote it to LIVE instead of creating
    // a second row, and stamp `startedAt` now (not when the student joined).
    const existing = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    if (existing) {
      if (existing.status === 'SCHEDULED') {
        const promoted = await this.prisma.$transaction(async (tx) => {
          const transitioned = await this.liveSessionRepository.transitionToLive(existing.id, tx);
          if (!transitioned) {
            return (await this.liveSessionRepository.findById(existing.id, tx)) ?? existing;
          }

          await this.outboxService.create(tx, {
            topic: 'live.started',
            payload: {
              sessionId: existing.id,
              lessonId,
              groupId,
              teacherId,
              roomId: room.roomId,
              startedAt: new Date().toISOString(),
            },
            idempotencyKey: `live.started:${existing.id}`,
          });

          return (await this.liveSessionRepository.findById(existing.id, tx)) as LiveSession;
        });

        this.logger.log(`LiveSession ${promoted.id} promoted SCHEDULED -> LIVE (lesson=${lessonId} teacher=${teacherId})`);
        return { session: promoted, sfu: room };
      }

      // Already LIVE/STARTING — idempotent fast-path.
      return { session: existing, sfu: room };
    }

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const created = await this.liveSessionRepository.createActive(
          { lessonId, roomId: room.roomId },
          tx,
        );

        await this.outboxService.create(tx, {
          topic: 'live.started',
          payload: {
            sessionId: created.id,
            lessonId,
            groupId,
            teacherId,
            roomId: room.roomId,
            startedAt: created.startedAt?.toISOString() ?? null,
          },
          idempotencyKey: `live.started:${created.id}`,
        });

        return created;
      });

      this.logger.log(`LiveSession ${session.id} started (lesson=${lessonId} teacher=${teacherId})`);
      return { session, sfu: room };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.liveSessionRepository.findActiveByLessonId(lessonId);
        if (winner) return { session: winner, sfu: room };
      }
      throw error;
    }
  }

  /**
   * End the live session for a lesson.
   */
  async endSession(
    lessonId: string,
    teacherId: string,
  ): Promise<LiveSessionWithSfu | { session: LiveSession; sfu: null }> {
    await this.assertTeacherOwnsLesson(lessonId, teacherId);

    const latest = await this.liveSessionRepository.findLatestByLessonId(lessonId);
    if (!latest) {
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `No live session has been started for lesson ${lessonId}`,
      });
    }

    if (this.isTerminal(latest.status)) {
      return { session: latest, sfu: null };
    }

    const groupId = await this.loadGroupId(lessonId);

    const ended = await this.prisma.$transaction(async (tx) => {
      const transitioned = await this.liveSessionRepository.transitionToEnded(latest.id, tx);
      if (!transitioned) {
        const fresh = await this.liveSessionRepository.findById(latest.id, tx);
        if (!fresh) throw new NotFoundException({ code: 'LIVE_SESSION_NOT_FOUND', message: `Live session disappeared` });
        return fresh;
      }

      await this.outboxService.create(tx, {
        topic: 'live.ended',
        payload: { sessionId: latest.id, lessonId, groupId, teacherId, endedAt: new Date().toISOString() },
        idempotencyKey: `live.ended:${latest.id}`,
      });

      return await this.liveSessionRepository.findById(latest.id, tx) as LiveSession;
    });

    await this.liveKitService.closeRoom(lessonId);

    this.logger.log(`LiveSession ${ended.id} ended (lesson=${lessonId})`);
    return { session: ended, sfu: null };
  }

  /**
   * Join a live session.
   *
   * TEACHER must wait for an explicit `startSession` call (status LIVE).
   * STUDENT may additionally join a `SCHEDULED` "waiting room" — and, if
   * no session exists yet at all, opens one — as long as the current
   * time is within `EARLY_JOIN_MS` of the lesson's `scheduledAt`. This
   * lets students arrive up to 15 minutes early and sit in the room
   * (camera/mic preview, seeing each other) before the teacher presses
   * "start"; the session only actually goes LIVE — and the duration
   * timer only starts — once the teacher does.
   */
  async joinSession(
    lessonId: string,
    userId: string,
    role: 'TEACHER' | 'STUDENT',
  ): Promise<JoinSessionResult> {
    let session = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    let opensAt: Date | null = null;

    if (!session && role === 'STUDENT') {
      opensAt = await this.loadEarlyJoinOpensAt(lessonId);
      if (opensAt && Date.now() >= opensAt.getTime()) {
        session = await this.openWaitingRoom(lessonId);
      }
    }

    const joinable =
      !!session &&
      (session.status === 'LIVE' || (role === 'STUDENT' && session.status === 'SCHEDULED'));

    if (!joinable) {
      if (opensAt === null) opensAt = await this.loadEarlyJoinOpensAt(lessonId);
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `No live session in progress for lesson ${lessonId}`,
        details: { opensAt: opensAt?.toISOString() ?? null },
      });
    }

    const activeSession = session as LiveSession;
    const room = await this.liveKitService.ensureRoom(lessonId);

    // Fetch user details for the token
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const participantName = user?.email?.split('@')[0] || 'Unknown';

    const token = await this.liveKitService.createToken(lessonId, participantName, userId, role);

    this.logger.log(`LiveSession ${activeSession.id} joined by user=${userId} role=${role} sessionStatus=${activeSession.status}`);

    return { session: activeSession, sfu: room, token, role };
  }

  private async loadEarlyJoinOpensAt(lessonId: string): Promise<Date | null> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { scheduledAt: true },
    });
    return lesson?.scheduledAt ? new Date(lesson.scheduledAt.getTime() - EARLY_JOIN_MS) : null;
  }

  /**
   * Open a `SCHEDULED` waiting-room session for a lesson so a STUDENT can
   * join early. If a concurrent request already created one (roomId's
   * partial unique index), fall back to reading the winner's row.
   */
  private async openWaitingRoom(lessonId: string): Promise<LiveSession | null> {
    const room = await this.liveKitService.ensureRoom(lessonId);
    try {
      return await this.liveSessionRepository.createPending({ lessonId, roomId: room.roomId });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return await this.liveSessionRepository.findActiveByLessonId(lessonId);
      }
      throw error;
    }
  }

  /**
   * Heartbeat to check if session is still alive. Also succeeds for a
   * `SCHEDULED` waiting-room session, so a student sitting in early
   * keeps polling successfully until the teacher flips it to LIVE.
   */
  async heartbeat(lessonId: string): Promise<LiveSessionWithSfu> {
    const session = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    if (!session || (session.status !== 'LIVE' && session.status !== 'SCHEDULED')) {
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `No live session in progress for lesson ${lessonId}`,
      });
    }
    
    let room = await this.liveKitService.getRoomSnapshot(lessonId);
    if (!room) {
      room = await this.liveKitService.ensureRoom(lessonId);
      this.logger.log(`Recovered LiveKit room for lesson ${lessonId}`);
    }

    const lessonTitle = await this.loadLessonTitle(lessonId);
    return { session, sfu: room, lessonTitle };
  }

  /**
   * List sessions live right now for a teacher.
   */
  async listActiveSessions(teacherId: string): Promise<LiveSession[]> {
    const live = await this.liveSessionRepository.listLive();
    if (live.length === 0) return [];
    
    const lessonIds = Array.from(new Set(live.map((s) => s.lessonId)));
    const owned = await this.prisma.lesson.findMany({
      where: { id: { in: lessonIds }, group: { course: { teacherId } } },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((l) => l.id));
    return live.filter((s) => ownedSet.has(s.lessonId));
  }

  private async assertTeacherOwnsLesson(lessonId: string, teacherId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { group: { select: { course: { select: { teacherId: true } } } } },
    });
    if (!lesson) throw new NotFoundException({ code: 'LESSON_NOT_FOUND', message: `Lesson ${lessonId} not found` });
    if (lesson.group.course.teacherId !== teacherId) {
      throw new ForbiddenException({ code: 'NOT_OWNING_TEACHER', message: 'You can only manage live sessions for your own lessons' });
    }
  }

  private async loadGroupId(lessonId: string): Promise<string> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId }, select: { groupId: true } });
    if (!lesson) throw new NotFoundException({ code: 'LESSON_NOT_FOUND', message: `Lesson ${lessonId} not found` });
    return lesson.groupId;
  }

  private async loadLessonTitle(lessonId: string): Promise<string | undefined> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId }, select: { title: true } });
    return lesson?.title;
  }

  private isTerminal(status: LiveSession['status']): boolean {
    return status === 'ENDED' || status === 'RECORDING_FAILED';
  }
}

export type { LiveSession } from '@prisma/client';
