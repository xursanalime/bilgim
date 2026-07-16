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
import { RecordingService } from './recording/recording.service';

/**
 * Public-shape returned by `startSession` / `joinSession`. Pairs the
 * LiveSession DB row with the LiveKit room snapshot.
 */
export interface LiveSessionWithSfu {
  session: LiveSession;
  sfu: LiveKitRoomSnapshot;
}

/** Shape returned by `joinSession`: session + room + a freshly-allocated token. */
export interface JoinSessionResult extends LiveSessionWithSfu {
  /** LiveKit Access Token for the joining peer. */
  token: string;
  /** Role of the joining user inside the room. */
  role: 'TEACHER' | 'STUDENT';
}

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
    private readonly recordingService: RecordingService,
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

    // Idempotent fast-path
    const existing = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    if (existing) {
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

      // Best-effort: start the recorder synchronously so a recorderRef is
      // persisted even if the async outbox/queue pipeline isn't running
      // (e.g. local dev). Idempotent — the port + service both dedupe, so the
      // `live.started` queue path remains harmless if it also runs.
      try {
        await this.recordingService.startRecording(session.id);
      } catch (err) {
        this.logger.warn(
          `startSession: best-effort startRecording failed for session ${session.id}: ${(err as Error).message}`,
        );
      }

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

    // Best-effort: finalize the recording synchronously so the recording
    // row (READY/FAILED) exists immediately after ending — without waiting
    // on the async outbox/queue pipeline (which may not run in local dev).
    // Idempotent via `Recording.sessionId @unique`, so the `live.ended` queue
    // path stays harmless if it also runs.
    try {
      await this.recordingService.finalizeRecording(ended.id);
    } catch (err) {
      this.logger.warn(
        `endSession: best-effort finalizeRecording failed for session ${ended.id}: ${(err as Error).message}`,
      );
    }

    return { session: ended, sfu: null };
  }

  /**
   * Join an active live session.
   */
  async joinSession(
    lessonId: string,
    userId: string,
    role: 'TEACHER' | 'STUDENT',
  ): Promise<JoinSessionResult> {
    const session = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    if (!session || session.status !== 'LIVE') {
      throw new NotFoundException({
        code: 'LIVE_SESSION_NOT_FOUND',
        message: `No live session in progress for lesson ${lessonId}`,
      });
    }

    const room = await this.liveKitService.ensureRoom(lessonId);
    
    // Fetch user details for the token
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const participantName = user?.email?.split('@')[0] || 'Unknown';

    const token = await this.liveKitService.createToken(lessonId, participantName, userId, role);

    this.logger.log(`LiveSession ${session.id} joined by user=${userId} role=${role}`);

    return { session, sfu: room, token, role };
  }

  /**
   * Heartbeat to check if session is still alive.
   */
  async heartbeat(lessonId: string): Promise<LiveSessionWithSfu> {
    const session = await this.liveSessionRepository.findActiveByLessonId(lessonId);
    if (!session || session.status !== 'LIVE') {
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
    
    return { session, sfu: room };
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

  /**
   * List sessions live RIGHT NOW for a student — only sessions where the
   * student has an APPROVED enrollment in the lesson's group.
   * Used by the student dashboard "Hozir jonli!" widget.
   */
  async listActiveSessionsForStudent(studentId: string): Promise<LiveSession[]> {
    const live = await this.liveSessionRepository.listLive();
    if (live.length === 0) return [];

    const lessonIds = Array.from(new Set(live.map((s) => s.lessonId)));
    const enrolled = await this.prisma.lesson.findMany({
      where: {
        id: { in: lessonIds },
        group: {
          enrollments: {
            some: { studentId, status: 'APPROVED' },
          },
        },
      },
      select: { id: true },
    });
    const enrolledSet = new Set(enrolled.map((l) => l.id));
    return live.filter((s) => enrolledSet.has(s.lessonId));
  }

  /**
   * List all recordings for a lesson (newest first) for on-demand viewing
   * (Req 6.2). Access is gated by `LessonAccessGuard` at the controller.
   */
  async listLessonRecordings(lessonId: string) {
    return this.recordingService.listForLesson(lessonId);
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

  private isTerminal(status: LiveSession['status']): boolean {
    return status === 'ENDED' || status === 'RECORDING_FAILED';
  }
}

export type { LiveSession } from '@prisma/client';
