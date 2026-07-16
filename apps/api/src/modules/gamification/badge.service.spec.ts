import { NotFoundException } from '@nestjs/common';
import { BadgeCategory, BadgeRarity, UserRole } from '@prisma/client';

import { BadgeService } from './badge.service';
import { ENGLISH_BADGE_DEFINITIONS } from './english-badges.constants';

/**
 * Task 7.3 — re-theming + non-destructive deactivation of legacy badges.
 *
 * Mechanics are unchanged; we only verify the new English-theming surface:
 *  - legacy badges can be retired (isActive=false) without losing awards,
 *  - badges can be re-themed without touching awarded records,
 *  - the English catalog can be synced idempotently.
 */

function makeBadge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'badge-1',
    slug: 'al_xorazmiy',
    nameUz: 'Al-Xorazmiy vorisi',
    nameRu: 'Преемник Аль-Хорезми',
    nameEn: 'Al-Khwarizmi Successor',
    descriptionUz: 'math themed',
    iconUrl: '',
    rarity: BadgeRarity.EPIC,
    category: BadgeCategory.SPECIAL,
    xpReward: 400,
    isActive: true,
    targetRole: UserRole.STUDENT,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('BadgeService — re-theme & deactivation (Req 13.3)', () => {
  let badgeRepo: {
    findBySlug: jest.Mock;
    setActive: jest.Mock;
    updateBySlug: jest.Mock;
    upsertBySlug: jest.Mock;
    awardBadge: jest.Mock;
  };
  let prisma: { userBadge: { delete: jest.Mock; deleteMany: jest.Mock } };
  let gamificationService: { awardXp: jest.Mock };
  let service: BadgeService;

  beforeEach(() => {
    badgeRepo = {
      findBySlug: jest.fn(),
      setActive: jest.fn(),
      updateBySlug: jest.fn(),
      upsertBySlug: jest.fn(),
      awardBadge: jest.fn(),
    };
    prisma = {
      userBadge: { delete: jest.fn(), deleteMany: jest.fn() },
    };
    gamificationService = { awardXp: jest.fn() };

    service = new BadgeService(
      prisma as never,
      badgeRepo as never,
      gamificationService as never,
    );
  });

  it('deactivates (retires) a legacy badge without deleting awards', async () => {
    badgeRepo.findBySlug.mockResolvedValue(makeBadge());
    badgeRepo.setActive.mockResolvedValue(makeBadge({ isActive: false }));

    const result = await service.deactivateBadge('al_xorazmiy');

    expect(badgeRepo.setActive).toHaveBeenCalledWith('al_xorazmiy', false);
    expect(result.isActive).toBe(false);

    // Non-destructive: historical UserBadge awards must NOT be removed.
    expect(prisma.userBadge.delete).not.toHaveBeenCalled();
    expect(prisma.userBadge.deleteMany).not.toHaveBeenCalled();
  });

  it('throws NotFound when deactivating a missing badge', async () => {
    badgeRepo.findBySlug.mockResolvedValue(null);
    await expect(service.deactivateBadge('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(badgeRepo.setActive).not.toHaveBeenCalled();
  });

  it('re-themes a badge\'s display metadata without touching awards', async () => {
    badgeRepo.findBySlug.mockResolvedValue(makeBadge());
    badgeRepo.updateBySlug.mockResolvedValue(
      makeBadge({ nameEn: 'English Vocabulary Collector' }),
    );

    const result = await service.rethemeBadge('al_xorazmiy', {
      nameEn: 'English Vocabulary Collector',
      category: BadgeCategory.LEARNING,
    });

    expect(badgeRepo.updateBySlug).toHaveBeenCalledWith('al_xorazmiy', {
      nameEn: 'English Vocabulary Collector',
      category: BadgeCategory.LEARNING,
    });
    expect(result.nameEn).toBe('English Vocabulary Collector');
    expect(prisma.userBadge.delete).not.toHaveBeenCalled();
    expect(prisma.userBadge.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an empty re-theme patch', async () => {
    badgeRepo.findBySlug.mockResolvedValue(makeBadge());
    await expect(service.rethemeBadge('al_xorazmiy', {})).rejects.toThrow();
    expect(badgeRepo.updateBySlug).not.toHaveBeenCalled();
  });

  it('reactivates a previously retired badge', async () => {
    badgeRepo.findBySlug.mockResolvedValue(makeBadge({ isActive: false }));
    badgeRepo.setActive.mockResolvedValue(makeBadge({ isActive: true }));

    const result = await service.reactivateBadge('al_xorazmiy');
    expect(badgeRepo.setActive).toHaveBeenCalledWith('al_xorazmiy', true);
    expect(result.isActive).toBe(true);
  });
});

describe('BadgeService — English catalog sync (Req 13.1/13.2)', () => {
  it('idempotently upserts every English badge definition', async () => {
    const badgeRepo = {
      upsertBySlug: jest.fn().mockResolvedValue(makeBadge()),
    };
    const service = new BadgeService(
      {} as never,
      badgeRepo as never,
      {} as never,
    );

    const count = await service.syncEnglishBadges();

    expect(count).toBe(ENGLISH_BADGE_DEFINITIONS.length);
    expect(badgeRepo.upsertBySlug).toHaveBeenCalledTimes(
      ENGLISH_BADGE_DEFINITIONS.length,
    );
    // Catalog-only metadata must never reach the persistence layer.
    for (const call of badgeRepo.upsertBySlug.mock.calls) {
      expect(call[1]).not.toHaveProperty('skill');
      expect(call[1]).not.toHaveProperty('cefrLevel');
      expect(call[1]).not.toHaveProperty('examTrack');
    }
  });

  it('exposes the English badge catalog', () => {
    const service = new BadgeService({} as never, {} as never, {} as never);
    expect(service.getEnglishBadgeCatalog().length).toBeGreaterThan(0);
  });
});
