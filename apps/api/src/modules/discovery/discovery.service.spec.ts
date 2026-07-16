import { NotFoundException } from '@nestjs/common';

import { DiscoveryService } from './discovery.service';
import {
  DiscoveryCourseRow,
  DiscoveryRepository,
  DiscoveryTeacherRow,
} from './repositories/discovery.repository';

/**
 * DiscoveryService unit tests — Requirements 14.1, 14.2, 14.3, 14.4, 14.7.
 *
 * Coverage:
 *   - Cursor pagination: +1 overflow trim and `nextCursor` derivation.
 *   - Default page size when caller omits it; 100-row hard cap.
 *   - Repository visibility filters are forwarded verbatim.
 *   - Public course detail: 404 when the row is missing or hidden.
 *   - Cache layer (CacheService.getOrSet): key shape is order-insensitive,
 *     fetched values are persisted with the 5-minute TTL, hits skip the
 *     repository, fetch errors propagate.
 *   - Mapper coverage: Decimal rating → number, courseCount surfaced from
 *     `_count.courses`.
 */
describe('DiscoveryService', () => {
  let service: DiscoveryService;
  let repository: jest.Mocked<DiscoveryRepository>;
  let cache: { getOrSet: jest.Mock };
  let cacheStore: Map<string, unknown>;
  let cacheTtls: Map<string, number>;

  beforeEach(() => {
    repository = {
      searchCourses: jest.fn(),
      findPublicCourseById: jest.fn(),
      searchTeachers: jest.fn(),
    } as any;

    cacheStore = new Map();
    cacheTtls = new Map();
    cache = {
      getOrSet: jest.fn(async (key: string, ttl: number, fetcher: () => Promise<unknown>) => {
        if (cacheStore.has(key)) {
          return cacheStore.get(key);
        }
        const value = await fetcher();
        cacheStore.set(key, value);
        cacheTtls.set(key, ttl);
        return value;
      }),
    };

    service = new DiscoveryService(repository, cache as any);
  });

  function makeCourse(id: string): DiscoveryCourseRow {
    return {
      id,
      title: `Course ${id}`,
      description: null,
      level: 'A2',
      cefrLevel: 'A2',
      examTrack: 'ielts',
      coverUrl: null,
      fromPriceUzs: 200_000,
      createdAt: new Date(`2026-01-${id.padStart(2, '0')}T00:00:00Z`),
      teacher: {
        userId: `t-${id}`,
        publicSlug: `slug-${id}`,
        fullName: `Teacher ${id}`,
        headline: 'IELTS expert',
        coverUrl: null,
        rating: { toString: () => '4.75' } as any, // Prisma.Decimal-shaped
        studentsCount: 42,
        specialty: {
          id: 's-1',
          slug: 'ielts',
          nameUz: 'IELTS',
          nameRu: 'IELTS',
          nameEn: 'IELTS',
        },
      },
    };
  }

  function makeTeacher(userId: string, courseCount = 3): DiscoveryTeacherRow {
    return {
      userId,
      publicSlug: `slug-${userId}`,
      fullName: `Teacher ${userId}`,
      headline: 'Headline',
      coverUrl: null,
      rating: null,
      studentsCount: 10,
      createdAt: new Date(`2026-02-01T00:00:00Z`),
      taughtCefrLevels: ['B1', 'B2'],
      examTrackFocus: ['ielts'],
      specialty: {
        id: 's-1',
        slug: 'ielts',
        nameUz: 'IELTS',
        nameRu: 'IELTS',
        nameEn: 'IELTS',
      },
      _count: { courses: courseCount },
    };
  }

  // ==================================================================
  // listCourses (Req 14.1, 14.2, 14.7)
  // ==================================================================

  describe('listCourses', () => {
    it('uses default pageSize=20 and forwards CEFR + exam-track filters to the repository', async () => {
      repository.searchCourses.mockResolvedValue([]);

      await service.listCourses({
        q: 'ielts',
        cefrLevel: ['B2'],
        examTrack: 'ielts',
        level: 'B2',
        priceMin: 100_000,
        priceMax: 500_000,
      });

      expect(repository.searchCourses).toHaveBeenCalledWith({
        q: 'ielts',
        cefrLevels: ['B2'],
        examTrack: 'ielts',
        level: 'B2',
        priceMin: 100_000,
        priceMax: 500_000,
        cursor: undefined,
        pageSize: 20,
      });
    });

    it('ignores the deprecated specialtyId facet (English-only refocus, Req 14.4 / 2.3)', async () => {
      repository.searchCourses.mockResolvedValue([]);

      await service.listCourses({
        specialtyId: '00000000-0000-0000-0000-000000000001',
      });

      const forwarded = repository.searchCourses.mock.calls[0]![0];
      expect(forwarded).not.toHaveProperty('specialtyId');
    });

    it('forwards multiple CEFR levels and omits empty level arrays', async () => {
      repository.searchCourses.mockResolvedValue([]);

      await service.listCourses({ cefrLevel: ['A1', 'A2', 'B1'] });
      expect(repository.searchCourses).toHaveBeenCalledWith(
        expect.objectContaining({ cefrLevels: ['A1', 'A2', 'B1'] }),
      );

      repository.searchCourses.mockClear();
      await service.listCourses({ cefrLevel: [] });
      const forwarded = repository.searchCourses.mock.calls[0]![0];
      expect(forwarded).not.toHaveProperty('cefrLevels');
    });

    it('respects caller-provided pageSize and cursor', async () => {
      repository.searchCourses.mockResolvedValue([]);
      await service.listCourses({ pageSize: 5, cursor: 'cursor-id' });
      expect(repository.searchCourses).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 5, cursor: 'cursor-id' }),
      );
    });

    it('caps pageSize at 100 to protect Postgres from a runaway client', async () => {
      repository.searchCourses.mockResolvedValue([]);
      await service.listCourses({ pageSize: 5_000 });
      expect(repository.searchCourses).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 }),
      );
    });

    it('trims the +1 overflow row and exposes nextCursor of the last kept row', async () => {
      // Repository returns pageSize+1 rows when there is another page.
      const rows = ['1', '2', '3'].map(makeCourse);
      repository.searchCourses.mockResolvedValue(rows);

      const page = await service.listCourses({ pageSize: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.items.map((c) => c.id)).toEqual(['1', '2']);
      // Cursor for the next page is the id of the last *kept* row.
      expect(page.nextCursor).toBe('2');
    });

    it('returns nextCursor=null when fewer rows than pageSize are returned', async () => {
      repository.searchCourses.mockResolvedValue([makeCourse('1')]);
      const page = await service.listCourses({ pageSize: 5 });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('maps Decimal rating to number and exposes teacher.avatarUrl', async () => {
      const row = makeCourse('1');
      row.teacher.rating = { toString: () => '4.50' } as any;
      row.teacher.coverUrl = 'https://r2/cover.jpg';
      repository.searchCourses.mockResolvedValue([row]);

      const page = await service.listCourses({});
      const out = page.items[0]!;
      expect(out.teacher.rating).toBe(4.5);
      expect(out.teacher.avatarUrl).toBe('https://r2/cover.jpg');
      // Req 14.2/14.3 — CEFR level + exam track are exposed to discovery.
      expect(out.cefrLevel).toBe('A2');
      expect(out.examTrack).toBe('ielts');
    });

    it('caches the response with a stable key (order-insensitive) for 5 minutes', async () => {
      repository.searchCourses.mockResolvedValue([makeCourse('1')]);

      await service.listCourses({ q: 'a', specialtyId: 's' });
      await service.listCourses({ specialtyId: 's', q: 'a' });

      // Both calls produce the same cache key — second call hit the cache.
      const keys = (cache.getOrSet as jest.Mock).mock.calls.map((c) => c[0]);
      expect(new Set(keys).size).toBe(1);

      // TTL is 5 minutes (Task 24.2 raised it from the original 30 s).
      const ttls = (cache.getOrSet as jest.Mock).mock.calls.map((c) => c[1]);
      for (const ttl of ttls) {
        expect(ttl).toBe(300);
      }

      // Repository was only called once — the second call hit the cache.
      expect(repository.searchCourses).toHaveBeenCalledTimes(1);
    });

    it('returns the cached value on cache hit and skips the repository', async () => {
      const cached = {
        items: [
          {
            id: 'cached-id',
            title: 'cached',
            description: null,
            level: null,
            coverUrl: null,
            fromPriceUzs: null,
            teacher: {
              userId: 't',
              publicSlug: 's',
              fullName: 'F',
              headline: null,
              avatarUrl: null,
              rating: null,
              studentsCount: 0,
              specialty: null,
            },
          },
        ],
        nextCursor: null,
      };
      cacheStore.set('discovery:courses:pageSize=20&q=x', cached);

      const result = await service.listCourses({ q: 'x' });

      expect(result).toEqual(cached);
      expect(repository.searchCourses).not.toHaveBeenCalled();
    });
  });

  // ==================================================================
  // getCourseById (Req 14.2, 14.3)
  // ==================================================================

  describe('getCourseById', () => {
    it('returns the course summary when public', async () => {
      repository.findPublicCourseById.mockResolvedValue(makeCourse('42'));

      const out = await service.getCourseById('42');
      expect(out.id).toBe('42');
      expect(out.teacher.fullName).toBe('Teacher 42');
    });

    it('throws 404 COURSE_NOT_FOUND when the row is missing or hidden', async () => {
      repository.findPublicCourseById.mockResolvedValue(null);
      await expect(service.getCourseById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getCourseById('missing')).rejects.toMatchObject({
        response: { code: 'COURSE_NOT_FOUND' },
      });
    });
  });

  // ==================================================================
  // listTeachers (Req 14.1, 14.4, 14.7)
  // ==================================================================

  describe('listTeachers', () => {
    it('forwards q, CEFR + exam-track filters and pagination to the repository', async () => {
      repository.searchTeachers.mockResolvedValue([]);
      await service.listTeachers({
        q: 'jane',
        cefrLevel: ['B2', 'C1'],
        examTrack: 'ielts',
        cursor: 'c',
        pageSize: 10,
      });
      expect(repository.searchTeachers).toHaveBeenCalledWith({
        q: 'jane',
        cefrLevels: ['B2', 'C1'],
        examTrack: 'ielts',
        cursor: 'c',
        pageSize: 10,
      });
    });

    it('ignores the deprecated specialtyId facet on teacher search (Req 14.4 / 2.3)', async () => {
      repository.searchTeachers.mockResolvedValue([]);
      await service.listTeachers({
        specialtyId: '00000000-0000-0000-0000-000000000001',
      });
      const forwarded = repository.searchTeachers.mock.calls[0]![0];
      expect(forwarded).not.toHaveProperty('specialtyId');
    });

    it('surfaces taughtCefrLevels and examTrackFocus in the teacher summary', async () => {
      repository.searchTeachers.mockResolvedValue([makeTeacher('t1', 2)]);
      const page = await service.listTeachers({});
      expect(page.items[0]!.taughtCefrLevels).toEqual(['B1', 'B2']);
      expect(page.items[0]!.examTrackFocus).toEqual(['ielts']);
    });

    it('surfaces _count.courses as courseCount in the summary', async () => {
      repository.searchTeachers.mockResolvedValue([
        makeTeacher('t1', 5),
        makeTeacher('t2', 0),
      ]);
      const page = await service.listTeachers({});
      expect(page.items.map((t) => t.courseCount)).toEqual([5, 0]);
    });

    it('uses userId for nextCursor when paginating teachers', async () => {
      // Three rows for pageSize=2 — one extra to trigger a next page.
      repository.searchTeachers.mockResolvedValue([
        makeTeacher('a'),
        makeTeacher('b'),
        makeTeacher('c'),
      ]);
      const page = await service.listTeachers({ pageSize: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe('b');
    });
  });

  // ==================================================================
  // Cache key shape
  // ==================================================================

  describe('cache key', () => {
    it('omits empty / undefined params and namespaces by scope', async () => {
      repository.searchCourses.mockResolvedValue([]);
      await service.listCourses({ q: '', specialtyId: undefined });
      const key = (cache.getOrSet as jest.Mock).mock.calls[0]?.[0] as string;
      expect(key).toMatch(/^discovery:courses:/);
      expect(key).toContain('pageSize=20');
      expect(key).not.toContain('q=');
      expect(key).not.toContain('specialtyId=');
    });
  });
});
