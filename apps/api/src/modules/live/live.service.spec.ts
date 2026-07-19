import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LiveSessionStatus, Prisma } from '@prisma/client';

import { LiveService } from './live.service';
import { LiveSessionRepository } from './repositories/live-session.repository';
import { LiveKitRoomSnapshot, LiveKitService } from './sfu/livekit.service';

const TEACHER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TEACHER_ID = '00000000-0000-0000-0000-000000000099';
const STUDENT_ID = '00000000-0000-0000-0000-0000000000aa';
const LESSON_ID = '11111111-1111-1111-1111-111111111111';
const GROUP_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const ROOM_ID = 'router_1';

/**
 * Unit tests for LiveService — Requirements 9.1, 9.2, 9.3, 9.4, 9.5,
 * 9.6, 9.8.
 *
 * Coverage:
 *   - startSession: ownership, idempotency, emits live.started, P2002 race.
 *   - endSession: ownership, idempotent terminal path, emits live.ended,
 *     never leaves a session in LIVE (Req 9.8).
 *   - joinSession: requires LIVE session, allocates transport.
 *   - heartbeat: 404 when not LIVE.
 *   - listActiveSessions: filters to lessons owned by the calling teacher.
 */
describe('LiveService', () => {
  let service: LiveService;
  let prisma: {
    lesson: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
    user: {
      findUnique: jest.Mock;
    };
  };
  let liveSessionRepository: jest.Mocked<LiveSessionRepository>;
  let liveKitService: jest.Mocked<LiveKitService>;
  let outboxService: { create: jest.Mock };

  const sfuRoomSnapshot = {
    lessonId: LESSON_ID,
    roomId: ROOM_ID,
    participantCount: 0,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      lesson: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'user@example.com' }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };

    liveSessionRepository = {
      findById: jest.fn(),
      findActiveByLessonId: jest.fn(),
      findLatestByLessonId: jest.fn(),
      listLive: jest.fn(),
      createActive: jest.fn(),
      transitionToEnded: jest.fn(),
    } as unknown as jest.Mocked<LiveSessionRepository>;

    liveKitService = {
      ensureRoom: jest.fn().mockResolvedValue(sfuRoomSnapshot),
      getRoomSnapshot: jest.fn().mockResolvedValue(sfuRoomSnapshot),
      closeRoom: jest.fn().mockResolvedValue(undefined),
      createToken: jest.fn().mockResolvedValue('fake-token'),
    } as unknown as jest.Mocked<LiveKitService>;

    outboxService = {
      create: jest.fn().mockResolvedValue('outbox-id'),
    };

    service = new LiveService(
      prisma as never,
      liveSessionRepository,
      liveKitService,
      outboxService as never,
    );
  });

  // ------------------------------------------------------------------
  // startSession
  // ------------------------------------------------------------------

  describe('startSession', () => {
    function setupOwnedLesson(): void {
      prisma.lesson.findUnique.mockImplementation(({ select }: any) => {
        if (select && select.groupId) {
          return Promise.resolve({ groupId: GROUP_ID });
        }
        return Promise.resolve({
          id: LESSON_ID,
          groupId: GROUP_ID,
          group: { course: { teacherId: TEACHER_ID } },
        });
      });
    }

    it('IDLE → ACTIVE: creates LIVE row, allocates SFU room, emits live.started (Req 9.1, 9.3)', async () => {
      setupOwnedLesson();
      liveSessionRepository.findActiveByLessonId.mockResolvedValue(null);
      const created = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.createActive.mockResolvedValue(created as never);

      const result = await service.startSession(LESSON_ID, TEACHER_ID);

      expect(liveKitService.ensureRoom).toHaveBeenCalledWith(LESSON_ID);
      expect(liveSessionRepository.createActive).toHaveBeenCalledWith(
        { lessonId: LESSON_ID, roomId: ROOM_ID },
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'live.started',
          idempotencyKey: `live.started:${SESSION_ID}`,
          payload: expect.objectContaining({
            sessionId: SESSION_ID,
            lessonId: LESSON_ID,
            groupId: GROUP_ID,
            teacherId: TEACHER_ID,
            roomId: ROOM_ID,
          }),
        }),
      );
      expect(result.session.id).toBe(SESSION_ID);
      expect(result.sfu.roomId).toBe(ROOM_ID);
    });

    it('idempotent: returns existing non-terminal session without inserting (Req 9.1)', async () => {
      setupOwnedLesson();
      const existing = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.findActiveByLessonId.mockResolvedValue(
        existing as never,
      );

      const result = await service.startSession(LESSON_ID, TEACHER_ID);

      expect(result.session).toBe(existing);
      expect(liveSessionRepository.createActive).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('rejects cross-teacher start with 403 NOT_OWNING_TEACHER (Req 9.1)', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        group: { course: { teacherId: OTHER_TEACHER_ID } },
      });

      await expect(
        service.startSession(LESSON_ID, TEACHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(liveKitService.ensureRoom).not.toHaveBeenCalled();
      expect(liveSessionRepository.createActive).not.toHaveBeenCalled();
    });

    it('rejects with 404 LESSON_NOT_FOUND when lesson is missing', async () => {
      prisma.lesson.findUnique.mockResolvedValue(null);

      await expect(
        service.startSession(LESSON_ID, TEACHER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the racing winner on P2002 collision instead of crashing', async () => {
      setupOwnedLesson();
      liveSessionRepository.findActiveByLessonId
        .mockResolvedValueOnce(null) // pre-insert idempotency probe
        .mockResolvedValueOnce({
          // racing winner re-fetch after P2002
          id: SESSION_ID,
          lessonId: LESSON_ID,
          status: 'LIVE',
          startedAt: new Date(),
          endedAt: null,
          roomId: ROOM_ID,
          recorderRef: null,
        } as never);

      const collision = new Prisma.PrismaClientKnownRequestError(
        'unique constraint',
        { code: 'P2002', clientVersion: 'test' } as never,
      );
      prisma.$transaction.mockRejectedValueOnce(collision);

      const result = await service.startSession(LESSON_ID, TEACHER_ID);
      expect(result.session.id).toBe(SESSION_ID);
      expect(result.sfu.roomId).toBe(ROOM_ID);
    });
  });

  // ------------------------------------------------------------------
  // endSession (Req 9.5, 9.6, 9.8)
  // ------------------------------------------------------------------

  describe('endSession', () => {
    function setupOwnedLesson(): void {
      prisma.lesson.findUnique.mockImplementation(({ select }: any) => {
        if (select && select.groupId) {
          return Promise.resolve({ groupId: GROUP_ID });
        }
        return Promise.resolve({
          id: LESSON_ID,
          groupId: GROUP_ID,
          group: { course: { teacherId: TEACHER_ID } },
        });
      });
    }

    it('ACTIVE → ENDED: transitions row, emits live.ended, closes SFU room (Req 9.5, 9.8)', async () => {
      setupOwnedLesson();
      const live = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      const ended = { ...live, status: 'ENDED' as LiveSessionStatus, endedAt: new Date() };
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(live as never);
      liveSessionRepository.transitionToEnded.mockResolvedValue(true);
      liveSessionRepository.findById.mockResolvedValue(ended as never);

      const result = await service.endSession(LESSON_ID, TEACHER_ID);

      expect(liveSessionRepository.transitionToEnded).toHaveBeenCalledWith(
        SESSION_ID,
        expect.anything(),
      );
      expect(outboxService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          topic: 'live.ended',
          idempotencyKey: `live.ended:${SESSION_ID}`,
        }),
      );
      expect(liveKitService.closeRoom).toHaveBeenCalledWith(LESSON_ID);
      expect(result.session.status).toBe('ENDED');
      expect(result.sfu).toBeNull();
    });

    it('idempotent: an already-ENDED session is returned without re-emitting live.ended (Req 9.8)', async () => {
      setupOwnedLesson();
      const terminal = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'ENDED' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: new Date(),
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(
        terminal as never,
      );

      const result = await service.endSession(LESSON_ID, TEACHER_ID);

      expect(result.session.status).toBe('ENDED');
      expect(result.sfu).toBeNull();
      // Idempotent: no transition, no event, no SFU close.
      expect(liveSessionRepository.transitionToEnded).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
      expect(liveKitService.closeRoom).not.toHaveBeenCalled();
    });

    it('idempotent: a RECORDING_FAILED session is also treated as terminal (Req 9.8)', async () => {
      setupOwnedLesson();
      const failed = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'RECORDING_FAILED' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: new Date(),
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(
        failed as never,
      );

      const result = await service.endSession(LESSON_ID, TEACHER_ID);

      expect(result.session.status).toBe('RECORDING_FAILED');
      expect(liveSessionRepository.transitionToEnded).not.toHaveBeenCalled();
      expect(outboxService.create).not.toHaveBeenCalled();
    });

    it('returns the winner row when a concurrent end raced us', async () => {
      setupOwnedLesson();
      const live = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      const ended = { ...live, status: 'ENDED' as LiveSessionStatus, endedAt: new Date() };
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(live as never);
      liveSessionRepository.transitionToEnded.mockResolvedValue(false); // race lost
      liveSessionRepository.findById.mockResolvedValue(ended as never);

      const result = await service.endSession(LESSON_ID, TEACHER_ID);

      expect(result.session.status).toBe('ENDED');
      // The losing caller does NOT emit a duplicate live.ended event.
      expect(outboxService.create).not.toHaveBeenCalled();
      // SFU still gets closed once we believe the session is terminal.
      expect(liveKitService.closeRoom).toHaveBeenCalledWith(LESSON_ID);
    });

    it('throws 404 LIVE_SESSION_NOT_FOUND when no session has ever been started', async () => {
      setupOwnedLesson();
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(null);

      await expect(
        service.endSession(LESSON_ID, TEACHER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(liveKitService.closeRoom).not.toHaveBeenCalled();
    });

    it('rejects cross-teacher end with 403 NOT_OWNING_TEACHER (Req 9.5)', async () => {
      prisma.lesson.findUnique.mockResolvedValue({
        id: LESSON_ID,
        groupId: GROUP_ID,
        group: { course: { teacherId: OTHER_TEACHER_ID } },
      });

      await expect(
        service.endSession(LESSON_ID, TEACHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(liveSessionRepository.transitionToEnded).not.toHaveBeenCalled();
      expect(liveKitService.closeRoom).not.toHaveBeenCalled();
    });

    it('still closes the SFU room even if outbox/transition completes', async () => {
      // Specifically asserts Req 9.8: the side-effect ordering (DB tx
      // commits first, SFU close second) means a successful end always
      // tears down the router.
      setupOwnedLesson();
      const live = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.findLatestByLessonId.mockResolvedValue(live as never);
      liveSessionRepository.transitionToEnded.mockResolvedValue(true);
      liveSessionRepository.findById.mockResolvedValue({
        ...live,
        status: 'ENDED' as LiveSessionStatus,
      } as never);

      await service.endSession(LESSON_ID, TEACHER_ID);

      expect(liveKitService.closeRoom).toHaveBeenCalledWith(LESSON_ID);
    });
  });

  // ------------------------------------------------------------------
  // joinSession (Req 9.2)
  // ------------------------------------------------------------------

  describe('joinSession', () => {
    it('returns the session, sfu snapshot, and a fresh token for STUDENT', async () => {
      const live = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      };
      liveSessionRepository.findActiveByLessonId.mockResolvedValue(live as never);

      const result = await service.joinSession(
        LESSON_ID,
        STUDENT_ID,
        'STUDENT',
      );

      expect(result.session.id).toBe(SESSION_ID);
      expect(result.sfu.roomId).toBe(ROOM_ID);
      expect(result.role).toBe('STUDENT');
      expect(liveKitService.createToken).toHaveBeenCalled();
      expect(result.token).toBe('fake-token');
    });

    it('rejects with 404 LIVE_SESSION_NOT_FOUND when no session is LIVE', async () => {
      liveSessionRepository.findActiveByLessonId.mockResolvedValue(null);

      await expect(
        service.joinSession(LESSON_ID, STUDENT_ID, 'STUDENT'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 404 LIVE_SESSION_NOT_FOUND when session is in STARTING (not yet LIVE)', async () => {
      // Even though STARTING is "active" at the repo level, joins are
      // only meaningful once the room is ready. We reject so the client
      // retries.
      liveSessionRepository.findActiveByLessonId.mockResolvedValue({
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'STARTING' as LiveSessionStatus,
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      } as never);

      await expect(
        service.joinSession(LESSON_ID, STUDENT_ID, 'STUDENT'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ------------------------------------------------------------------
  // heartbeat
  // ------------------------------------------------------------------

  describe('heartbeat', () => {
    it('returns session+room when LIVE', async () => {
      liveSessionRepository.findActiveByLessonId.mockResolvedValue({
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE',
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      } as never);

      const result = await service.heartbeat(LESSON_ID);
      expect(result.session.id).toBe(SESSION_ID);
      expect(result.sfu.roomId).toBe(ROOM_ID);
    });

    it('throws 404 when not LIVE', async () => {
      liveSessionRepository.findActiveByLessonId.mockResolvedValue(null);
      await expect(service.heartbeat(LESSON_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when DB says LIVE but SFU desync cannot be recovered', async () => {
      liveSessionRepository.findActiveByLessonId.mockResolvedValue({
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE',
        startedAt: new Date(),
        endedAt: null,
        roomId: ROOM_ID,
        recorderRef: null,
      } as never);
      liveKitService.getRoomSnapshot.mockResolvedValue(null);
      liveKitService.ensureRoom.mockRejectedValue(new NotFoundException());

      await expect(service.heartbeat(LESSON_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ------------------------------------------------------------------
  // listActiveSessions (RBAC)
  // ------------------------------------------------------------------

  describe('listActiveSessions', () => {
    it('returns only sessions for lessons owned by the calling teacher', async () => {
      const sessionMine = {
        id: SESSION_ID,
        lessonId: LESSON_ID,
        status: 'LIVE',
      };
      const sessionTheirs = {
        id: 'other-session',
        lessonId: 'other-lesson',
        status: 'LIVE',
      };
      liveSessionRepository.listLive.mockResolvedValue([
        sessionMine,
        sessionTheirs,
      ] as never);
      // Only LESSON_ID is owned by the calling teacher.
      prisma.lesson.findMany.mockResolvedValue([{ id: LESSON_ID }]);

      const result = await service.listActiveSessions(TEACHER_ID);

      expect(result).toEqual([sessionMine]);
      expect(prisma.lesson.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [LESSON_ID, 'other-lesson'] },
          group: { course: { teacherId: TEACHER_ID } },
        },
        select: { id: true },
      });
    });

    it('returns an empty list when no sessions are LIVE (no lesson query needed)', async () => {
      liveSessionRepository.listLive.mockResolvedValue([]);
      const result = await service.listActiveSessions(TEACHER_ID);
      expect(result).toEqual([]);
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    });
  });
});
