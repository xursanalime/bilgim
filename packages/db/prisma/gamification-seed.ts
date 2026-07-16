import { PrismaClient, BadgeRarity, BadgeCategory, UserRole } from '@prisma/client';

export async function seedGamification(prisma: PrismaClient) {
  console.log('🌱 Seeding Gamification data...');

  // ============ 1. Create Badges (English-learning themed — Req 13.1/13.2) ============
  const badges = [
    // Cross-cutting engagement
    {
      slug: 'english_early_bird',
      nameUz: 'Erta topshiruvchi',
      nameRu: 'Ранняя пташка',
      nameEn: 'Early Bird',
      descriptionUz: 'Ingliz tili uy vazifasini deadline\'dan 24 soat oldin topshirish',
      iconUrl: '',
      rarity: BadgeRarity.COMMON,
      category: BadgeCategory.LEARNING,
      xpReward: 50,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    {
      slug: 'english_streak_7',
      nameUz: '7 kunlik amaliyot',
      nameRu: '7 дней практики',
      nameEn: '7-Day English Streak',
      descriptionUz: '7 kun ketma-ket ingliz tili mashqlarini bajarish',
      iconUrl: '',
      rarity: BadgeRarity.COMMON,
      category: BadgeCategory.LEARNING,
      xpReward: 150,
      targetRole: UserRole.STUDENT,
      isActive: true,
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
      isActive: true,
    },
    // Per-skill English badges
    {
      slug: 'english_writing_master',
      nameUz: 'Yozuv mahorati',
      nameRu: 'Мастер письма',
      nameEn: 'Writing Master',
      descriptionUz: 'Writing topshiriqlarini yuqori baholar bilan yakunlash',
      iconUrl: '',
      rarity: BadgeRarity.RARE,
      category: BadgeCategory.LEARNING,
      xpReward: 200,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    {
      slug: 'english_speaking_star',
      nameUz: 'Nutq yulduzi',
      nameRu: 'Звезда речи',
      nameEn: 'Speaking Star',
      descriptionUz: 'Speaking topshiriqlari uchun audio javoblarni topshirish',
      iconUrl: '',
      rarity: BadgeRarity.EPIC,
      category: BadgeCategory.LEARNING,
      xpReward: 300,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    {
      slug: 'english_grammar_guru',
      nameUz: 'Grammatika bilimdoni',
      nameRu: 'Гуру грамматики',
      nameEn: 'Grammar Guru',
      descriptionUz: 'Grammar topshiriqlarini xatosiz yakunlash',
      iconUrl: '',
      rarity: BadgeRarity.RARE,
      category: BadgeCategory.LEARNING,
      xpReward: 200,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    // CEFR milestone
    {
      slug: 'cefr_b2_upper_intermediate',
      nameUz: 'B2 — O\'rtadan yuqori',
      nameRu: 'B2 — Выше среднего',
      nameEn: 'B2 Upper-Intermediate',
      descriptionUz: 'B2 darajasiga erishish',
      iconUrl: '',
      rarity: BadgeRarity.RARE,
      category: BadgeCategory.LEARNING,
      xpReward: 350,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    // Exam-track prep
    {
      slug: 'ielts_prep_finisher',
      nameUz: 'IELTS tayyorgarlik',
      nameRu: 'Подготовка к IELTS',
      nameEn: 'IELTS Prep Finisher',
      descriptionUz: 'IELTS tayyorgarlik trekidagi topshiriqlarni yakunlash',
      iconUrl: '',
      rarity: BadgeRarity.EPIC,
      category: BadgeCategory.LEARNING,
      xpReward: 400,
      targetRole: UserRole.STUDENT,
      isActive: true,
    },
    {
      slug: 'english_instructor_mentor',
      nameUz: 'Ingliz tili mentori',
      nameRu: 'Наставник по английскому',
      nameEn: 'English Instructor Mentor',
      descriptionUz: 'O\'quvchilarning ingliz tili topshiriqlarini tezkor va sifatli baholash',
      iconUrl: '',
      rarity: BadgeRarity.EPIC,
      category: BadgeCategory.TEACHING,
      xpReward: 350,
      targetRole: UserRole.TEACHER,
      isActive: true,
    },
    // Legacy non-English badge — retired (deactivated), NOT deleted, so any
    // historical UserBadge awards are preserved (Req 13.3, non-destructive).
    {
      slug: 'al_xorazmiy',
      nameUz: 'Al-Xorazmiy vorisi',
      nameRu: 'Преемник Аль-Хорезми',
      nameEn: 'Al-Khwarizmi Successor',
      descriptionUz: 'Vazifalarni ketma-ket a\'lo baholar bilan mukammal yakunlash',
      iconUrl: '',
      rarity: BadgeRarity.EPIC,
      category: BadgeCategory.SPECIAL,
      xpReward: 400,
      targetRole: UserRole.STUDENT,
      isActive: false,
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
    { nameUz: 'Bugun 2 ta ingliz tili topshirig\'ini topshir', targetCount: 2, eventType: 'homework_submitted', xpReward: 100, role: UserRole.STUDENT },
    { nameUz: 'Jonli ingliz tili darsiga qatnash', targetCount: 1, eventType: 'live_attended', xpReward: 80, role: UserRole.STUDENT },
    { nameUz: 'AI tutordan 3 ta ingliz tili savolini so\'ra', targetCount: 3, eventType: 'ai_tutor_used', xpReward: 60, role: UserRole.STUDENT },
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
