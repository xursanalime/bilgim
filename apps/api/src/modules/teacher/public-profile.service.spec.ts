import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TeacherProfile } from '@prisma/client';

import { TeacherPublicProfileService } from './public-profile.service';
import { TeacherProfileRepository } from './repositories/teacher-profile.repository';
import { UsersRepository } from '../auth/repositories/users.repository';

const OWNER_ID = 'teacher-1';
const OTHER_ID = 'teacher-2';

function buildProfile(overrides: Partial<TeacherProfile> = {}): TeacherProfile {
  return {
    userId: OWNER_ID,
    specialtyId: null,
    bio: null,
    yearsOfExperience: null,
    onboardingCompletedAt: null,
    createdAt: new Date(),
    publicSlug: null,
    headline: null,
    fullName: 'Aziz Aliyev',
    coverUrl: null,
    rating: null,
    studentsCount: 0,
    themeColor: '#2563eb',
    ...overrides,
  } as TeacherProfile;
}

describe('TeacherPublicProfileService', () => {
  let service: TeacherPublicProfileService;
  let repository: jest.Mocked<TeacherProfileRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;
  let prisma: any;
  let jwtService: JwtService;

  beforeEach(() => {
    repository = {
      findByUserId: jest.fn(),
      updatePublicProfile: jest.fn(),
      findUserIdByPublicSlug: jest.fn(),
    } as unknown as jest.Mocked<TeacherProfileRepository>;

    usersRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    prisma = {
      course: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      teacherProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    jwtService = new JwtService({ secret: 'test-secret-for-preview-tokens' });

    service = new TeacherPublicProfileService(repository, usersRepository, prisma, jwtService);
  });

  describe('setStatus — explicit slug', () => {
    it('claims a valid, unclaimed slug', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());
      repository.findUserIdByPublicSlug.mockResolvedValue(null);
      repository.updatePublicProfile.mockResolvedValue(buildProfile({ publicSlug: 'aziz-school' }));

      await service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'aziz-school' });

      expect(repository.updatePublicProfile).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({ publicSlug: 'aziz-school' }),
      );
    });

    it('allows re-saving the caller\'s own current slug', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile({ publicSlug: 'aziz-school' }));
      repository.findUserIdByPublicSlug.mockResolvedValue(OWNER_ID);
      repository.updatePublicProfile.mockResolvedValue(buildProfile({ publicSlug: 'aziz-school' }));

      await expect(
        service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'aziz-school' }),
      ).resolves.toBeDefined();
    });

    it('rejects a reserved slug', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());

      await expect(
        service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'admin' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.updatePublicProfile).not.toHaveBeenCalled();
    });

    it('rejects a slug already claimed by another teacher', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());
      repository.findUserIdByPublicSlug.mockResolvedValue(OTHER_ID);

      await expect(
        service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'taken-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a malformed slug', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile());

      await expect(
        service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'a' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears the slug when isPublic is false, even if a slug is supplied', async () => {
      repository.findByUserId.mockResolvedValue(buildProfile({ publicSlug: 'aziz-school' }));
      repository.updatePublicProfile.mockResolvedValue(buildProfile({ publicSlug: null }));

      await service.setStatus(OWNER_ID, { isPublic: false });

      expect(repository.updatePublicProfile).toHaveBeenCalledWith(
        OWNER_ID,
        expect.objectContaining({ publicSlug: null }),
      );
    });

    it('throws when the teacher profile does not exist', async () => {
      repository.findByUserId.mockResolvedValue(null);

      await expect(
        service.setStatus(OWNER_ID, { isPublic: true, publicSlug: 'aziz-school' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkSlugAvailability', () => {
    it('reports available for a free, valid slug', async () => {
      repository.findUserIdByPublicSlug.mockResolvedValue(null);
      await expect(service.checkSlugAvailability(OWNER_ID, 'fresh-slug')).resolves.toEqual({
        available: true,
      });
    });

    it("reports the caller's own slug as available", async () => {
      repository.findUserIdByPublicSlug.mockResolvedValue(OWNER_ID);
      await expect(service.checkSlugAvailability(OWNER_ID, 'aziz-school')).resolves.toEqual({
        available: true,
      });
    });

    it('reports invalid for a malformed slug', async () => {
      await expect(service.checkSlugAvailability(OWNER_ID, 'a')).resolves.toEqual({
        available: false,
        reason: 'invalid',
      });
    });

    it('reports reserved for a reserved slug', async () => {
      await expect(service.checkSlugAvailability(OWNER_ID, 'www')).resolves.toEqual({
        available: false,
        reason: 'reserved',
      });
    });

    it('reports taken for a slug owned by someone else', async () => {
      repository.findUserIdByPublicSlug.mockResolvedValue(OTHER_ID);
      await expect(service.checkSlugAvailability(OWNER_ID, 'someone-else')).resolves.toEqual({
        available: false,
        reason: 'taken',
      });
    });
  });

  describe('preview tokens', () => {
    it('round-trips a preview token through create → resolve', async () => {
      const { previewToken } = await service.createPreviewToken(OWNER_ID, {
        slug: 'draft-slug',
        headline: 'Draft headline',
      });

      const resolved = await service.resolvePreviewToken(previewToken);
      expect(resolved).toEqual({
        teacherId: OWNER_ID,
        slug: 'draft-slug',
        headline: 'Draft headline',
      });
    });

    it('rejects a malformed draft slug at creation time', async () => {
      await expect(
        service.createPreviewToken(OWNER_ID, { slug: 'a' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects tokens signed for a different purpose', async () => {
      const foreignToken = await jwtService.signAsync(
        { purpose: 'something-else', teacherId: OWNER_ID, slug: 'x' },
        { algorithm: 'HS256' },
      );
      await expect(service.resolvePreviewToken(foreignToken)).rejects.toThrow(NotFoundException);
    });

    it('rejects a garbage token', async () => {
      await expect(service.resolvePreviewToken('not-a-jwt')).rejects.toThrow(NotFoundException);
    });

    it('getPreviewProfile merges draft fields over the persisted profile', async () => {
      repository.findByUserId.mockResolvedValue(
        buildProfile({
          fullName: 'Aziz Aliyev',
          headline: 'Persisted headline',
          coverUrl: 'https://cdn.example/persisted.jpg',
          themeColor: '#111111',
          rating: null,
          studentsCount: 12,
        }),
      );
      prisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Course 1', description: null, level: null, coverUrl: null, fromPriceUzs: 100000 },
      ]);

      const { previewToken } = await service.createPreviewToken(OWNER_ID, {
        slug: 'draft-slug',
        headline: 'Draft headline',
      });

      const result = await service.getPreviewProfile(previewToken);
      expect(result.teacher).toEqual(
        expect.objectContaining({
          id: OWNER_ID,
          slug: 'draft-slug',
          fullName: 'Aziz Aliyev',
          headline: 'Draft headline', // draft overrides persisted
          avatarUrl: 'https://cdn.example/persisted.jpg', // no draft coverUrl → falls back
          themeColor: '#111111',
          studentsCount: 12,
        }),
      );
      expect(result.courses).toHaveLength(1);
    });

    it('treats an explicit empty-string draft coverUrl as "no cover" (O\'chirish button), not a fallback', async () => {
      repository.findByUserId.mockResolvedValue(
        buildProfile({ coverUrl: 'https://cdn.example/persisted.jpg' }),
      );
      prisma.course.findMany.mockResolvedValue([]);

      const { previewToken } = await service.createPreviewToken(OWNER_ID, {
        slug: 'draft-slug',
        coverUrl: '',
      });

      const result = await service.getPreviewProfile(previewToken);
      expect(result.teacher.avatarUrl).toBeNull();
    });
  });
});
