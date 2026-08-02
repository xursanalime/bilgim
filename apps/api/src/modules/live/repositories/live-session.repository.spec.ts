import type { LiveSession } from '@prisma/client';

import { LiveSessionRepository } from './live-session.repository';

/**
 * Unit tests for {@link LiveSessionRepository} (Req 9.1, 9.5, 9.6, 9.8,
 * Task 12.6).
 *
 * The repository is a thin Prisma wrapper, so the tests focus on:
 *  - The shape of arguments passed to Prisma (`where` clauses, `orderBy`,
 *    status filters) — these are part of the contract relied upon by
 *    LiveService for idempotency, ordering, and concurrent-end races.
 *  - The optimistic transition semantics of `transitionToEnded` (true
 *    only on a row that moved out of `STARTING|LIVE`).
 *  - Transactional composition: every mutator must accept an optional
 *    `Prisma.TransactionClient` so service-layer outbox writes commit
 *    atomically with the state change.
 *
 * Strategy: stub the `liveSession` delegate on a fake PrismaClient.
 */
describe('LiveSessionRepository', () => {
  let prisma: {
    liveSession: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let tx: {
    liveSession: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let repo: LiveSessionRepository;

  const SESSION_ID = '11111111-1111-1111-1111-111111111111';
  const LESSON_ID = '22222222-2222-2222-2222-222222222222';
  const ROOM_ID = 'router_1';

  const buildRow = (overrides: Partial<LiveSession> = {}): LiveSession =>
    ({
      id: SESSION_ID,
      lessonId: LESSON_ID,
      status: 'LIVE',
      startedAt: new Date('2025-01-01T00:00:00Z'),
      endedAt: null,
      roomId: ROOM_ID,
      recorderRef: null,
      ...overrides,
    }) as unknown as LiveSession;

  beforeEach(() => {
    prisma = {
      liveSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    tx = {
      liveSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    repo = new LiveSessionRepository(prisma as never);
  });

  // ----------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------

  describe('findById', () => {
    it('queries the row by primary key', async () => {
      const row = buildRow();
      prisma.liveSession.findUnique.mockResolvedValue(row);

      const result = await repo.findById(SESSION_ID);

      expect(prisma.liveSession.findUnique).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
      });
      expect(result).toBe(row);
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.liveSession.findUnique.mockResolvedValue(null);

      await repo.findById(SESSION_ID, tx as never);

      expect(tx.liveSession.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.liveSession.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when no row matches', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(null);
      await expect(repo.findById('missing')).resolves.toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // findActiveByLessonId
  // ----------------------------------------------------------------

  describe('findActiveByLessonId', () => {
    it('selects the most recent non-terminal session for the lesson', async () => {
      const row = buildRow();
      prisma.liveSession.findFirst.mockResolvedValue(row);

      const result = await repo.findActiveByLessonId(LESSON_ID);

      expect(prisma.liveSession.findFirst).toHaveBeenCalledWith({
        where: {
          lessonId: LESSON_ID,
          status: { in: ['SCHEDULED', 'STARTING', 'LIVE'] },
        },
        orderBy: { startedAt: 'desc' },
      });
      expect(result).toBe(row);
    });

    it('does not return ENDED or RECORDING_FAILED rows (status filter excludes terminals)', async () => {
      // Sanity check the constant: callers depend on these three
      // statuses being treated as "still owns an SFU room" so a brand
      // new startSession can detect an in-flight duplicate.
      prisma.liveSession.findFirst.mockResolvedValue(null);

      await repo.findActiveByLessonId(LESSON_ID);

      const arg = prisma.liveSession.findFirst.mock.calls[0][0];
      expect(arg.where.status.in).not.toContain('ENDED');
      expect(arg.where.status.in).not.toContain('RECORDING_FAILED');
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.liveSession.findFirst.mockResolvedValue(null);
      await repo.findActiveByLessonId(LESSON_ID, tx as never);
      expect(tx.liveSession.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.liveSession.findFirst).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // findLatestByLessonId
  // ----------------------------------------------------------------

  describe('findLatestByLessonId', () => {
    it('returns the most recent session for the lesson regardless of status', async () => {
      const row = buildRow({ status: 'ENDED', endedAt: new Date() });
      prisma.liveSession.findFirst.mockResolvedValue(row);

      const result = await repo.findLatestByLessonId(LESSON_ID);

      // No status filter → idempotent end re-reads can locate a
      // terminal row.
      expect(prisma.liveSession.findFirst).toHaveBeenCalledWith({
        where: { lessonId: LESSON_ID },
        orderBy: { startedAt: 'desc' },
      });
      expect(result).toBe(row);
    });

    it('returns null when the lesson never had a session', async () => {
      prisma.liveSession.findFirst.mockResolvedValue(null);
      await expect(repo.findLatestByLessonId(LESSON_ID)).resolves.toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // listLive
  // ----------------------------------------------------------------

  describe('listLive', () => {
    it('selects only LIVE sessions, newest first, with a default page cap', async () => {
      prisma.liveSession.findMany.mockResolvedValue([buildRow()]);

      await repo.listLive();

      expect(prisma.liveSession.findMany).toHaveBeenCalledWith({
        where: { status: 'LIVE' },
        orderBy: { startedAt: 'desc' },
        take: 100,
        skip: 0,
      });
    });

    it('returns an empty array when nothing is live', async () => {
      prisma.liveSession.findMany.mockResolvedValue([]);
      await expect(repo.listLive()).resolves.toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // createActive
  // ----------------------------------------------------------------

  describe('createActive', () => {
    it('inserts a row in LIVE status with startedAt populated', async () => {
      const before = Date.now();
      prisma.liveSession.create.mockResolvedValue(buildRow());

      await repo.createActive({ lessonId: LESSON_ID, roomId: ROOM_ID });

      const arg = prisma.liveSession.create.mock.calls[0][0];
      expect(arg.data.lessonId).toBe(LESSON_ID);
      expect(arg.data.roomId).toBe(ROOM_ID);
      expect(arg.data.status).toBe('LIVE');
      expect(arg.data.startedAt).toBeInstanceOf(Date);
      expect((arg.data.startedAt as Date).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.liveSession.create.mockResolvedValue(buildRow());

      await repo.createActive(
        { lessonId: LESSON_ID, roomId: ROOM_ID },
        tx as never,
      );

      expect(tx.liveSession.create).toHaveBeenCalledTimes(1);
      expect(prisma.liveSession.create).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // transitionToEnded
  // ----------------------------------------------------------------

  describe('transitionToEnded', () => {
    it('issues a conditional updateMany filtered by id + (STARTING|LIVE)', async () => {
      prisma.liveSession.updateMany.mockResolvedValue({ count: 1 });

      const before = Date.now();
      const moved = await repo.transitionToEnded(SESSION_ID);

      const arg = prisma.liveSession.updateMany.mock.calls[0][0];
      expect(arg.where.id).toBe(SESSION_ID);
      expect(arg.where.status.in).toEqual(['STARTING', 'LIVE']);
      expect(arg.data.status).toBe('ENDED');
      expect(arg.data.endedAt).toBeInstanceOf(Date);
      expect((arg.data.endedAt as Date).getTime()).toBeGreaterThanOrEqual(
        before,
      );
      expect(moved).toBe(true);
    });

    it('returns false when the precondition lost the race (count = 0)', async () => {
      prisma.liveSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(repo.transitionToEnded(SESSION_ID)).resolves.toBe(false);
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.liveSession.updateMany.mockResolvedValue({ count: 1 });

      await repo.transitionToEnded(SESSION_ID, tx as never);

      expect(tx.liveSession.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.liveSession.updateMany).not.toHaveBeenCalled();
    });
  });
});
