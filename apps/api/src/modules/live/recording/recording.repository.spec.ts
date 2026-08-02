import type { Recording } from '@prisma/client';

import {
  RECORDING_STATUS,
  RecordingRepository,
} from './recording.repository';

/**
 * Unit tests for {@link RecordingRepository} (Req 9.6, 9.7, 9.8, Task 12.6).
 *
 * Conventions exercised:
 *  - `findBySessionId` queries by the `sessionId` `@unique` index, which
 *    is what makes "one Recording per LiveSession" enforceable at the
 *    DB level. The service relies on this lookup for idempotent
 *    finalize retries.
 *  - `create` passes through the lessonId/sessionId/status fields and
 *    defaults `assetId`/`durationMs` to `null` when omitted, so the
 *    initial RECORDING insert (no asset yet) doesn't blow up on
 *    `undefined` values that Prisma would coerce differently.
 *  - Both methods accept an optional `Prisma.TransactionClient` so the
 *    finalize path can compose the Recording write with the
 *    LiveSession status transition inside a single transaction.
 *
 * Strategy: stub the `recording` delegate on a fake PrismaClient.
 */
describe('RecordingRepository', () => {
  let prisma: {
    recording: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let tx: {
    recording: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let repo: RecordingRepository;

  const RECORDING_ID = '00000000-0000-0000-0000-000000000aaa';
  const LESSON_ID = '00000000-0000-0000-0000-000000000bbb';
  const SESSION_ID = '00000000-0000-0000-0000-000000000ccc';
  const ASSET_ID = '00000000-0000-0000-0000-000000000ddd';

  const buildRow = (overrides: Partial<Recording> = {}): Recording =>
    ({
      id: RECORDING_ID,
      lessonId: LESSON_ID,
      sessionId: SESSION_ID,
      status: RECORDING_STATUS.RECORDING,
      assetId: null,
      durationMs: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      ...overrides,
    }) as unknown as Recording;

  beforeEach(() => {
    prisma = {
      recording: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    tx = {
      recording: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    repo = new RecordingRepository(prisma as never);
  });

  // ----------------------------------------------------------------
  // findBySessionId — relies on Recording.sessionId @unique
  // ----------------------------------------------------------------

  describe('findBySessionId', () => {
    it('queries by the @unique sessionId column', async () => {
      const row = buildRow();
      prisma.recording.findUnique.mockResolvedValue(row);

      const result = await repo.findBySessionId(SESSION_ID);

      expect(prisma.recording.findUnique).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID },
      });
      expect(result).toBe(row);
    });

    it('returns null when no Recording exists for the session', async () => {
      prisma.recording.findUnique.mockResolvedValue(null);
      await expect(repo.findBySessionId(SESSION_ID)).resolves.toBeNull();
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.recording.findUnique.mockResolvedValue(null);

      await repo.findBySessionId(SESSION_ID, tx as never);

      expect(tx.recording.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.recording.findUnique).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // create
  // ----------------------------------------------------------------

  describe('create', () => {
    it('inserts a RECORDING row and forwards the input as-is', async () => {
      const row = buildRow({
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });
      prisma.recording.create.mockResolvedValue(row);

      const result = await repo.create({
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.READY,
        assetId: ASSET_ID,
        durationMs: 60_000,
      });

      expect(prisma.recording.create).toHaveBeenCalledWith({
        data: {
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.READY,
          assetId: ASSET_ID,
          durationMs: 60_000,
        },
      });
      expect(result).toBe(row);
    });

    it('defaults assetId and durationMs to null when omitted (RECORDING-only insert)', async () => {
      prisma.recording.create.mockResolvedValue(buildRow());

      await repo.create({
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.RECORDING,
      });

      expect(prisma.recording.create).toHaveBeenCalledWith({
        data: {
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.RECORDING,
          assetId: null,
          durationMs: null,
        },
      });
    });

    it('persists FAILED rows with no asset (Req 9.7 — failed recordings still have a row)', async () => {
      prisma.recording.create.mockResolvedValue(
        buildRow({ status: RECORDING_STATUS.FAILED }),
      );

      await repo.create({
        lessonId: LESSON_ID,
        sessionId: SESSION_ID,
        status: RECORDING_STATUS.FAILED,
      });

      const arg = prisma.recording.create.mock.calls[0][0];
      expect(arg.data.status).toBe(RECORDING_STATUS.FAILED);
      expect(arg.data.assetId).toBeNull();
      expect(arg.data.durationMs).toBeNull();
    });

    it('uses the supplied transaction client when provided', async () => {
      tx.recording.create.mockResolvedValue(buildRow());

      await repo.create(
        {
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.RECORDING,
        },
        tx as never,
      );

      expect(tx.recording.create).toHaveBeenCalledTimes(1);
      expect(prisma.recording.create).not.toHaveBeenCalled();
    });

    it('propagates Prisma errors (e.g. P2002 on sessionId @unique) so callers can translate to idempotent paths', async () => {
      const collision = Object.assign(new Error('unique'), {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.recording.create.mockRejectedValue(collision);

      await expect(
        repo.create({
          lessonId: LESSON_ID,
          sessionId: SESSION_ID,
          status: RECORDING_STATUS.READY,
          assetId: ASSET_ID,
        }),
      ).rejects.toBe(collision);
    });
  });
});
