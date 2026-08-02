import { DiscoveryRepository } from './discovery.repository';

/**
 * DiscoveryRepository unit tests — Requirement 14.2, 14.3, 14.4.
 *
 * The repository carries the visibility invariant for the entire module:
 *   - Courses returned only when `isPublished=true AND isDiscoverable=true`.
 *   - Teachers returned only when `publicSlug != null` AND they own at
 *     least one published+discoverable course.
 *
 * These tests freeze that contract by inspecting the `where` clause the
 * repository hands to Prisma — drift here means a regression in
 * Property 10 (Discovery visibility).
 */
describe('DiscoveryRepository', () => {
  let prisma: {
    course: { findMany: jest.Mock; findFirst: jest.Mock };
    teacherProfile: { findMany: jest.Mock };
  };
  let repo: DiscoveryRepository;

  beforeEach(() => {
    prisma = {
      course: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      teacherProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    repo = new DiscoveryRepository(prisma as any);
  });

  // ==================================================================
  // searchCourses
  // ==================================================================

  describe('searchCourses', () => {
    it('always filters by isPublished=true AND isDiscoverable=true', async () => {
      await repo.searchCourses({ pageSize: 20 });
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.where.isPublished).toBe(true);
      expect(args.where.isDiscoverable).toBe(true);
    });

    it('asks for pageSize+1 rows so the service can detect more pages', async () => {
      await repo.searchCourses({ pageSize: 20 });
      expect(prisma.course.findMany.mock.calls[0][0].take).toBe(21);
    });

    it('translates priceMin/priceMax into a fromPriceUzs range', async () => {
      await repo.searchCourses({
        pageSize: 20,
        priceMin: 100_000,
        priceMax: 500_000,
      });
      const where = prisma.course.findMany.mock.calls[0][0].where;
      expect(where.fromPriceUzs).toEqual({ gte: 100_000, lte: 500_000 });
    });

    it('joins to teacher.specialtyId for the specialty filter', async () => {
      await repo.searchCourses({ pageSize: 20, specialtyId: 'spec-1' });
      const where = prisma.course.findMany.mock.calls[0][0].where;
      expect(where.teacher).toEqual({ specialtyId: 'spec-1' });
    });

    it('uses ILIKE on title and description for the q filter', async () => {
      await repo.searchCourses({ pageSize: 20, q: 'ielts' });
      const where = prisma.course.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { title: { contains: 'ielts', mode: 'insensitive' } },
        { description: { contains: 'ielts', mode: 'insensitive' } },
      ]);
    });

    it('skips the q filter when q is shorter than 2 chars (defence-in-depth)', async () => {
      // The DTO already rejects this, but the repository keeps the rule too
      // so a misuse never blows up Postgres with a 1-char trigram scan.
      await repo.searchCourses({ pageSize: 20, q: 'a' });
      const where = prisma.course.findMany.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('uses cursor with skip:1 so the cursor row itself is not returned twice', async () => {
      await repo.searchCourses({ pageSize: 20, cursor: 'last-id' });
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.cursor).toEqual({ id: 'last-id' });
      expect(args.skip).toBe(1);
    });

    it('orders by (createdAt DESC, id DESC) for stable pagination', async () => {
      await repo.searchCourses({ pageSize: 20 });
      const args = prisma.course.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });
  });

  // ==================================================================
  // findPublicCourseById
  // ==================================================================

  describe('findPublicCourseById', () => {
    it('returns null when the row exists but is hidden', async () => {
      prisma.course.findFirst.mockResolvedValue(null);
      const out = await repo.findPublicCourseById('c-1');
      expect(out).toBeNull();
    });

    it('always pins the visibility filter on the where clause', async () => {
      await repo.findPublicCourseById('c-1');
      const args = prisma.course.findFirst.mock.calls[0][0];
      expect(args.where).toMatchObject({
        id: 'c-1',
        isPublished: true,
        isDiscoverable: true,
      });
    });
  });

  // ==================================================================
  // searchTeachers
  // ==================================================================

  describe('searchTeachers', () => {
    it('excludes teachers whose publicSlug is null', async () => {
      await repo.searchTeachers({ pageSize: 20 });
      const where = prisma.teacherProfile.findMany.mock.calls[0][0].where;
      expect(where.publicSlug).toEqual({ not: null });
    });

    it('requires at least one published+discoverable course (no empty profiles)', async () => {
      await repo.searchTeachers({ pageSize: 20 });
      const where = prisma.teacherProfile.findMany.mock.calls[0][0].where;
      expect(where.courses).toEqual({
        some: { isPublished: true, isDiscoverable: true },
      });
    });

    it('passes specialtyId straight through', async () => {
      await repo.searchTeachers({ pageSize: 20, specialtyId: 'spec-1' });
      const where = prisma.teacherProfile.findMany.mock.calls[0][0].where;
      expect(where.specialtyId).toBe('spec-1');
    });

    it('counts only public courses in _count.courses (no leak of hidden rows)', async () => {
      await repo.searchTeachers({ pageSize: 20 });
      const select = prisma.teacherProfile.findMany.mock.calls[0][0].select;
      expect(select._count).toEqual({
        select: {
          courses: {
            where: { isPublished: true, isDiscoverable: true },
          },
        },
      });
    });

    it('uses userId-based cursor pagination with skip:1', async () => {
      await repo.searchTeachers({ pageSize: 20, cursor: 'user-1' });
      const args = prisma.teacherProfile.findMany.mock.calls[0][0];
      expect(args.cursor).toEqual({ userId: 'user-1' });
      expect(args.skip).toBe(1);
    });
  });
});
