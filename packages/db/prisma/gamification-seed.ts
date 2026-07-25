import { PrismaClient, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';

export async function seedGamification(prisma: PrismaClient) {
  console.log('🌱 Seeding Gamification data...');

  // ============ 1. Create Badges ============
  const badges = [
    {
      slug: 'early_bird',
      nameUz: 'Erta uyg\'ongan',
      nameRu: 'Ранняя пташка',
      nameEn: 'Early Bird',
      descriptionUz: 'Birinchi uy vazifani deadline\'dan 24 soat oldin topshirish',
      iconUrl: '',
      rarity: BadgeRarity.COMMON,
      category: BadgeCategory.LEARNING,
      xpReward: 50,
      targetRole: UserRole.STUDENT,
    },
    {
      slug: 'perfectionist',
      nameUz: 'Mukammallik shaydosi',
      nameRu: 'Перфекционист',
      nameEn: 'Perfectionist',
      descriptionUz: '5 ta ketma-ket 100% baho olish',
      iconUrl: '',
      rarity: BadgeRarity.EPIC,
      category: BadgeCategory.LEARNING,
      xpReward: 300,
      targetRole: UserRole.STUDENT,
    },
    {
      slug: 'streak_7',
      nameUz: '7 kunlik shiddat',
      nameRu: '7-дневный удар',
      nameEn: '7-Day Streak',
      descriptionUz: '7 kunlik ketma-ket faollik',
      iconUrl: '',
      rarity: BadgeRarity.COMMON,
      category: BadgeCategory.LEARNING,
      xpReward: 150,
      targetRole: UserRole.STUDENT,
    },
    {
      slug: 'platform_pioneer',
      nameUz: 'Platforma kashfiyotchisi',
      nameRu: 'Пионер платформы',
      nameEn: 'Platform Pioneer',
      descriptionUz: 'Birinchi 1000 foydalanuvchidan biri bo\'lish',
      iconUrl: '',
      rarity: BadgeRarity.LEGENDARY,
      category: BadgeCategory.SPECIAL,
      xpReward: 500,
      targetRole: null,
    },
  ];

  for (const b of badges) {
    await prisma.badge.upsert({
      where: { slug: b.slug },
      update: b,
      create: b,
    });
  }
  console.log(`  ✓ Seeded ${badges.length} badges`);

  // ============ 2. Create Reward Items ============
  const rewards = [
    {
      slug: 'streak_freeze',
      nameUz: 'Streak Freeze',
      description: 'Bir kunlik faoliyatni o\'rnini bosadi va streak uzilishini oldini oladi',
      xpCost: 500,
      itemType: 'streak_freeze',
      isActive: true,
    },
    {
      slug: 'profile_frame_gold',
      nameUz: 'Oltin profil ramkasi',
      description: 'Profil rasmi uchun maxsus oltin rangli ramka',
      xpCost: 2000,
      itemType: 'profile_frame',
      isActive: true,
    },
  ];

  for (const r of rewards) {
    await prisma.rewardItem.upsert({
      where: { slug: r.slug },
      update: r,
      create: r,
    });
  }
  console.log(`  ✓ Seeded ${rewards.length} reward items`);

  // ============ 3. Seed Today's Challenges ============
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const challenges = [
    { nameUz: 'Bugun 2 ta uy vazifa topshir', targetCount: 2, eventType: 'homework_submitted', xpReward: 100, role: UserRole.STUDENT },
    { nameUz: 'Jonli darsga qatnash', targetCount: 1, eventType: 'live_attended', xpReward: 80, role: UserRole.STUDENT },
    { nameUz: 'AI tutordan 3 ta savol so\'ra', targetCount: 3, eventType: 'ai_tutor_used', xpReward: 60, role: UserRole.STUDENT },
  ];

  for (const c of challenges) {
    await prisma.dailyChallenge.upsert({
      where: {
        date_eventType_targetRole: {
          date: today,
          eventType: c.eventType,
          targetRole: c.role,
        },
      },
      update: {},
      create: {
        date: today,
        nameUz: c.nameUz,
        description: c.nameUz,
        xpReward: c.xpReward,
        targetCount: c.targetCount,
        eventType: c.eventType,
        targetRole: c.role,
      },
    });
  }
  console.log(`  ✓ Seeded ${challenges.length} daily challenges for today`);
}
