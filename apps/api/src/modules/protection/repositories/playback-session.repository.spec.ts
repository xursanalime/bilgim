import { PrismaClient } from '@prisma/client';

import { PlaybackSessionRepository } from './playback-session.repository';

/**
 * Unit tests for {@link PlaybackSessionRepository}
 * (content-protection-backend, Task 2.2, Req 6.1, 6.2, 6.4).
 *
 * The Prisma client is mocked: these assert the repository builds the
 * correct query shape (row mapping, `undefined` → `null` normalization,
 * trace-back lookup caps, retention delete) without a live database.
 */
describe('PlaybackSessionRepository', () => {
  function makePrisma() {
    return {
      playbackSession: {
        create: jest.fn(async ({ data }: { data: unknown }) => data),
        findUnique: jest.fn(async (_args: { where: { id: string } }) => null),
        findMany: jest.fn(async (_args: Record<string, unknown>) => []),
        deleteMany: jest.fn(async (_args: Record<string, unknown>) => ({
          count: 3,
        })),
      },
    };
  }

  function makeRepo(prisma = makePrisma()): {
    repo: PlaybackSessionRepository;
    prisma: ReturnType<typeof makePrisma>;
  } {
    const repo = new PlaybackSessionRepository(
      prisma as unknown as PrismaClient,
    );
    return { repo, prisma };
  }

  describe('create', () => {
    it('persists the viewer↔session↔asset mapping (Req 6.1)', async () => {
      const { repo, prisma } = makeRepo();
      const expiresAt = new Date('2024-06-01T12:02:00.000Z');

      await repo.create({
        id: 'sess-1',
        assetId: 'asset-1',
        lessonId: 'lesson-1',
        viewerUserId: 'user-1',
        enrollmentId: 'enr-1',
        viewerTag: 'tag-abc',
        drmKeySystem: 'widevine',
        ip: '203.0.113.5',
        userAgent: 'jest',
        expiresAt,
      });

      expect(prisma.playbackSession.create).toHaveBeenCalledWith({
        data: {
          id: 'sess-1',
          assetId: 'asset-1',
          lessonId: 'lesson-1',
          viewerUserId: 'user-1',
          enrollmentId: 'enr-1',
          viewerTag: 'tag-abc',
          drmKeySystem: 'widevine',
          ip: '203.0.113.5',
          userAgent: 'jest',
          expiresAt,
        },
      });
    });

    it('normalizes omitted optional fields to null', async () => {
      const { repo, prisma } = makeRepo();

      await repo.create({
        id: 'sess-2',
        assetId: 'asset-2',
        viewerUserId: 'user-2',
        viewerTag: 'tag-2',
        expiresAt: new Date('2024-06-01T12:02:00.000Z'),
      });

      const data = prisma.playbackSession.create.mock.calls[0]![0].data;
      expect(data).toMatchObject({
        lessonId: null,
        enrollmentId: null,
        drmKeySystem: null,
        ip: null,
        userAgent: null,
      });
    });
  });

  describe('findByViewerTag — admin trace-back (Req 6.4)', () => {
    it('queries by viewerTag, newest-first, with a default cap', async () => {
      const { repo, prisma } = makeRepo();

      await repo.findByViewerTag('tag-abc');

      expect(prisma.playbackSession.findMany).toHaveBeenCalledWith({
        where: { viewerTag: 'tag-abc' },
        orderBy: { issuedAt: 'desc' },
        take: 50,
      });
    });

    it('clamps an oversized take to the hard cap', async () => {
      const { repo, prisma } = makeRepo();

      await repo.findByViewerTag('tag-abc', { take: 10_000 });

      expect(prisma.playbackSession.findMany.mock.calls[0]![0].take).toBe(200);
    });
  });

  describe('deleteIssuedBefore — retention pruning (Req 6.2)', () => {
    it('deletes rows older than the cutoff and returns the count', async () => {
      const { repo, prisma } = makeRepo();
      const cutoff = new Date('2024-01-01T00:00:00.000Z');

      const removed = await repo.deleteIssuedBefore(cutoff);

      expect(prisma.playbackSession.deleteMany).toHaveBeenCalledWith({
        where: { issuedAt: { lt: cutoff } },
      });
      expect(removed).toBe(3);
    });
  });
});
