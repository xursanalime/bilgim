import {
  PrismaClient,
  UserRole,
  UserStatus,
  HomeworkModuleType,
  CefrLevel,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { seedGamification } from './gamification-seed';

const prisma = new PrismaClient();

/**
 * Hash a password using argon2 (same approach the auth module uses).
 */
async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

async function main() {
  console.log('🌱 Seeding database...');

  // ============ Create Specialties ============
  // Bilgim is an English-only teaching platform. The single active
  // specialty is "english"; any legacy specialties (mathematics, smm) are
  // deactivated so they no longer surface in onboarding or discovery.
  const english = await prisma.specialty.upsert({
    where: { slug: 'english' },
    update: { isActive: true },
    create: {
      slug: 'english',
      nameUz: 'Ingliz tili',
      nameRu: 'Английский язык',
      nameEn: 'English',
      isActive: true,
      dashboardKey: 'english',
    },
  });

  // Deactivate legacy non-English specialties if they exist (idempotent).
  await prisma.specialty.updateMany({
    where: { slug: { in: ['mathematics', 'smm'] } },
    data: { isActive: false },
  });

  console.log('  ✓ English specialty ready; legacy specialties deactivated');

  // ============ Create SpecialtyModules for English ============
  const englishModules: { moduleType: HomeworkModuleType; defaultEnabled: boolean }[] = [
    { moduleType: 'READING', defaultEnabled: true },
    { moduleType: 'WRITING', defaultEnabled: true },
    { moduleType: 'LISTENING', defaultEnabled: true },
    { moduleType: 'SPEAKING', defaultEnabled: true },
    { moduleType: 'VOCABULARY', defaultEnabled: false },
    { moduleType: 'GRAMMAR', defaultEnabled: false },
    { moduleType: 'SPELLING', defaultEnabled: false },
    { moduleType: 'PRONUNCIATION', defaultEnabled: false },
  ];

  for (const mod of englishModules) {
    await prisma.specialtyModule.upsert({
      where: {
        specialtyId_moduleType: {
          specialtyId: english.id,
          moduleType: mod.moduleType,
        },
      },
      update: {},
      create: {
        specialtyId: english.id,
        moduleType: mod.moduleType,
        isActive: true,
        defaultEnabled: mod.defaultEnabled,
      },
    });
  }
  console.log(`  ✓ Created ${englishModules.length} modules for English specialty`);

  // ============ Create Onboarding Questions ============
  // Each option carries a `weights` map keyed by Specialty.slug. The
  // OnboardingService classifier sums these weights across the teacher's
  // answers and picks the highest scoring slug (Requirements 2.2, 2.4).
  const onboardingQuestions: Array<{
    order: number;
    textUz: string;
    textRu: string;
    textEn: string;
    options: Array<{
      id: string;
      text: { uz: string; ru: string; en: string };
      weights: Record<string, number>;
    }>;
  }> = [
    {
      order: 1,
      textUz: "Ingliz tilining qaysi yo'nalishini o'qitasiz?",
      textRu: 'Какое направление английского вы преподаёте?',
      textEn: 'Which area of English do you teach?',
      options: [
        {
          id: 'focus_general',
          text: {
            uz: 'Umumiy ingliz tili (General English)',
            ru: 'Общий английский (General English)',
            en: 'General English',
          },
          weights: { english: 3 },
        },
        {
          id: 'focus_exam',
          text: {
            uz: 'Imtihonga tayyorlash (IELTS, TOEFL)',
            ru: 'Подготовка к экзаменам (IELTS, TOEFL)',
            en: 'Exam prep (IELTS, TOEFL)',
          },
          weights: { english: 3 },
        },
        {
          id: 'focus_business',
          text: {
            uz: 'Biznes ingliz tili (Business English)',
            ru: 'Деловой английский (Business English)',
            en: 'Business English',
          },
          weights: { english: 3 },
        },
      ],
    },
    {
      order: 2,
      textUz: "Darslaringizda ko'pincha qanday topshiriq berasiz?",
      textRu: 'Какие задания вы чаще всего даёте на уроках?',
      textEn: 'What kind of homework do you usually assign?',
      options: [
        {
          id: 'task_writing_reading',
          text: {
            uz: 'Esse yozish, matn o‘qish va tarjima qilish',
            ru: 'Написание эссе, чтение и перевод текстов',
            en: 'Writing essays, reading and translating texts',
          },
          weights: { english: 2 },
        },
        {
          id: 'task_listening_speaking',
          text: {
            uz: 'Tinglab tushunish va gapirish mashqlari',
            ru: 'Упражнения на аудирование и говорение',
            en: 'Listening and speaking practice',
          },
          weights: { english: 2 },
        },
        {
          id: 'task_grammar_vocab',
          text: {
            uz: 'Grammatika va lug‘at mashqlari',
            ru: 'Упражнения по грамматике и лексике',
            en: 'Grammar and vocabulary drills',
          },
          weights: { english: 2 },
        },
      ],
    },
    {
      order: 3,
      textUz: 'Talabalaringiz qaysi natijaga erishishini xohlaysiz?',
      textRu: 'Каких результатов вы хотите от своих студентов?',
      textEn: 'What outcomes do you want for your students?',
      options: [
        {
          id: 'outcome_speaking',
          text: {
            uz: 'Erkin gaplashish va kundalik muloqot',
            ru: 'Свободно говорить и общаться',
            en: 'Speak fluently and converse with confidence',
          },
          weights: { english: 2 },
        },
        {
          id: 'outcome_exam_score',
          text: {
            uz: 'IELTS/TOEFL yuqori ball olish',
            ru: 'Получить высокий балл IELTS/TOEFL',
            en: 'Achieve a high IELTS/TOEFL score',
          },
          weights: { english: 2 },
        },
        {
          id: 'outcome_career',
          text: {
            uz: 'Ish va karyera uchun ingliz tili',
            ru: 'Английский для работы и карьеры',
            en: 'English for work and career',
          },
          weights: { english: 2 },
        },
      ],
    },
    {
      order: 4,
      textUz: 'Qaysi vositalardan ko‘proq foydalanasiz?',
      textRu: 'Какими инструментами вы чаще всего пользуетесь?',
      textEn: 'Which tools do you use the most?',
      options: [
        {
          id: 'tools_dictionary',
          text: {
            uz: 'Lug‘at, audio diktant, grammatik mashqlar',
            ru: 'Словарь, аудиодиктант, грамматические упражнения',
            en: 'Dictionary, audio dictation, grammar drills',
          },
          weights: { english: 1 },
        },
        {
          id: 'tools_mock_exam',
          text: {
            uz: 'Sinov imtihonlari va baholash mezonlari',
            ru: 'Пробные экзамены и критерии оценивания',
            en: 'Mock exams and scoring rubrics',
          },
          weights: { english: 1 },
        },
        {
          id: 'tools_conversation',
          text: {
            uz: 'Suhbat klublari va rolli o‘yinlar',
            ru: 'Разговорные клубы и ролевые игры',
            en: 'Conversation clubs and role-plays',
          },
          weights: { english: 1 },
        },
      ],
    },
  ];

  for (const q of onboardingQuestions) {
    // Find an existing question by (order) — order is stable across reseeds in
    // dev. The Prisma model has no @unique on order, so we use findFirst +
    // create/update for idempotency.
    const existing = await prisma.onboardingQuestion.findFirst({
      where: { order: q.order, specialtyId: null },
    });

    if (existing) {
      await prisma.onboardingQuestion.update({
        where: { id: existing.id },
        data: {
          textUz: q.textUz,
          textRu: q.textRu,
          textEn: q.textEn,
          optionsJson: q.options,
          isActive: true,
        },
      });
    } else {
      await prisma.onboardingQuestion.create({
        data: {
          order: q.order,
          textUz: q.textUz,
          textRu: q.textRu,
          textEn: q.textEn,
          optionsJson: q.options,
          isActive: true,
        },
      });
    }
  }
  console.log(`  ✓ Created ${onboardingQuestions.length} onboarding questions`);

  // Deactivate any legacy specialty-specific onboarding questions that were
  // tied to non-English specialties (mathematics, smm) by earlier seeds. The
  // wizard only renders universal questions, but this keeps the data clean.
  const legacySpecialties = await prisma.specialty.findMany({
    where: { slug: { in: ['mathematics', 'smm'] } },
    select: { id: true },
  });
  if (legacySpecialties.length > 0) {
    const deactivated = await prisma.onboardingQuestion.updateMany({
      where: { specialtyId: { in: legacySpecialties.map((s) => s.id) } },
      data: { isActive: false },
    });
    console.log(
      `  ✓ Deactivated ${deactivated.count} legacy specialty-specific questions`,
    );
  }

  // ============ Create Admin User ============
  const adminEmail = 'admin@bilgim.uz';
  const adminPassword = await hashPassword('Admin123!@#');

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      publicId: '100001',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      fullName: 'Bilgim Admin',
      locale: 'uz',
    },
  });
  console.log(`  ✓ Created admin user: ${adminUser.email}`);

  // ============ Create Plans (TEACHER_SUBSCRIPTION) ============
  const monthlyPlan = await prisma.plan.upsert({
    where: { slug: 'teacher-monthly' },
    update: {},
    create: {
      slug: 'teacher-monthly',
      nameUz: "O'qituvchi oylik",
      priceUzs: 99_000,
      intervalDays: 30,
      maxStudents: 50,
      features: {
        liveStreams: true,
        aiGrading: true,
        analytics: 'basic',
      },
      isActive: true,
    },
  });
  console.log(`  ✓ Created plan: ${monthlyPlan.slug} (${monthlyPlan.priceUzs} UZS/oy)`);

  // ============ Exam tracks ============
  // Without these seeded, POST /teacher/onboarding/complete rejects EVERY
  // exam-track selection with EXAM_TRACK_NOT_FOUND (the endpoint validates
  // examTrackFocus slugs against this catalog) — the instructor-onboarding
  // form offers these exact six slugs (see EXAM_TRACKS in
  // instructor-onboarding-form.tsx), so the catalog must match it 1:1.
  const examTracks: Array<{ slug: string; name: string }> = [
    { slug: 'ielts', name: 'IELTS' },
    { slug: 'toefl', name: 'TOEFL' },
    { slug: 'general', name: 'General English' },
    { slug: 'cambridge', name: 'Cambridge' },
    { slug: 'pte', name: 'PTE' },
    { slug: 'business-english', name: 'Business English' },
  ];
  for (const track of examTracks) {
    await prisma.examTrack.upsert({
      where: { slug: track.slug },
      update: { name: track.name, isActive: true },
      create: { slug: track.slug, name: track.name, isActive: true },
    });
  }
  console.log(`  ✓ Seeded ${examTracks.length} exam tracks`);

  // ============ Demo teachers & courses (public discovery) ============
  // Populates /teachers, /search, /discover, /courses with realistic,
  // browsable content in dev/staging. Without at least one TeacherProfile
  // with `publicSlug` set AND one `isPublished + isDiscoverable` Course,
  // the public marketplace pages render as permanently empty (see
  // discovery.repository.ts `searchTeachers`).
  const demoTeachers: Array<{
    email: string;
    fullName: string;
    publicSlug: string;
    headline: string;
    bio: string;
    rating: number;
    studentsCount: number;
    taughtCefrLevels: CefrLevel[];
    examTrackFocus: string[];
    schoolName?: string;
    accentColor?: 'BLUE' | 'GREEN' | 'PURPLE' | 'ORANGE';
    course: {
      title: string;
      description: string;
      cefrLevel: CefrLevel;
      examTrack: string | null;
      fromPriceUzs: number;
      group: { name: string; priceUzs: number; capacity: number };
    };
  }> = [
    {
      email: 'nodira.teacher@bilgim.uz',
      fullName: 'Nodira Rashidova',
      publicSlug: 'nodira-rashidova',
      headline: 'IELTS 8.0 | 7 yillik tajriba',
      bio: "Cambridge CELTA sertifikatiga ega, IELTS Speaking va Writing bo'yicha ixtisoslashgan o'qituvchi.",
      rating: 4.9,
      studentsCount: 214,
      taughtCefrLevels: [CefrLevel.B2, CefrLevel.C1],
      examTrackFocus: ['ielts'],
      schoolName: "Nodira's English Academy",
      accentColor: 'PURPLE',
      course: {
        title: 'IELTS Intensiv (Speaking + Writing)',
        description:
          "8 haftalik intensiv kurs — IELTS Speaking va Writing bo'limlariga chuqur tayyorgarlik.",
        cefrLevel: CefrLevel.B2,
        examTrack: 'ielts',
        fromPriceUzs: 650_000,
        group: { name: "Kechki guruh (18:00)", priceUzs: 650_000, capacity: 12 },
      },
    },
    {
      email: 'jasur.teacher@bilgim.uz',
      fullName: 'Jasur Aliyev',
      publicSlug: 'jasur-aliyev',
      headline: 'TOEFL va umumiy ingliz tili',
      bio: "10 yildan ortiq tajriba, davlat maktabida va xususiy markazlarda dars bergan.",
      rating: 4.7,
      studentsCount: 158,
      taughtCefrLevels: [CefrLevel.A2, CefrLevel.B1, CefrLevel.B2],
      examTrackFocus: ['toefl', 'general'],
      course: {
        title: 'Umumiy ingliz tili — B1 dan B2 ga',
        description: "Grammatika, lug'at boyligi va nutq amaliyotiga asoslangan 12 haftalik kurs.",
        cefrLevel: CefrLevel.B1,
        examTrack: 'general',
        fromPriceUzs: 450_000,
        group: { name: "Ertalabki guruh (09:00)", priceUzs: 450_000, capacity: 15 },
      },
    },
    {
      email: 'malika.teacher@bilgim.uz',
      fullName: 'Malika Yusupova',
      publicSlug: 'malika-yusupova',
      headline: "Boshlang'ich daraja bo'yicha mutaxassis",
      bio: "Yosh o'quvchilar va boshlang'ich darajadagi kattalar bilan ishlashga ixtisoslashgan.",
      rating: 4.8,
      studentsCount: 96,
      taughtCefrLevels: [CefrLevel.A1, CefrLevel.A2],
      examTrackFocus: ['general'],
      course: {
        title: "Noldan ingliz tili (A1)",
        description: "Alifbodan boshlab kundalik muloqot darajasigacha olib boradigan kurs.",
        cefrLevel: CefrLevel.A1,
        examTrack: 'general',
        fromPriceUzs: 350_000,
        group: { name: "Kunduzgi guruh (14:00)", priceUzs: 350_000, capacity: 10 },
      },
    },
  ];

  const demoPassword = await hashPassword('Demo123!@#');

  for (const demo of demoTeachers) {
    const user = await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: {
        email: demo.email,
        passwordHash: demoPassword,
        role: UserRole.TEACHER,
        status: UserStatus.ACTIVE,
        fullName: demo.fullName,
        locale: 'uz',
      },
    });

    await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      update: {
        publicSlug: demo.publicSlug,
        headline: demo.headline,
        fullName: demo.fullName,
        rating: demo.rating,
        studentsCount: demo.studentsCount,
        taughtCefrLevels: demo.taughtCefrLevels,
        examTrackFocus: demo.examTrackFocus,
        schoolName: demo.schoolName ?? null,
        ...(demo.accentColor && { accentColor: demo.accentColor }),
      },
      create: {
        userId: user.id,
        bio: demo.bio,
        publicSlug: demo.publicSlug,
        headline: demo.headline,
        fullName: demo.fullName,
        rating: demo.rating,
        studentsCount: demo.studentsCount,
        taughtCefrLevels: demo.taughtCefrLevels,
        examTrackFocus: demo.examTrackFocus,
        schoolName: demo.schoolName ?? null,
        ...(demo.accentColor && { accentColor: demo.accentColor }),
        onboardingCompletedAt: new Date(),
      },
    });

    let course = await prisma.course.findFirst({
      where: { teacherId: user.id, title: demo.course.title },
    });
    if (!course) {
      course = await prisma.course.create({
        data: {
          teacherId: user.id,
          title: demo.course.title,
          description: demo.course.description,
          cefrLevel: demo.course.cefrLevel,
          examTrack: demo.course.examTrack,
          fromPriceUzs: demo.course.fromPriceUzs,
          isPublished: true,
          isDiscoverable: true,
        },
      });
    }

    const existingGroup = await prisma.group.findFirst({
      where: { courseId: course.id },
    });
    if (!existingGroup) {
      await prisma.group.create({
        data: {
          courseId: course.id,
          name: demo.course.group.name,
          cefrLevel: demo.course.cefrLevel,
          priceUzs: demo.course.group.priceUzs,
          capacity: demo.course.group.capacity,
          status: 'OPEN',
          isDiscoverable: true,
        },
      });
    }

    console.log(`  ✓ Demo teacher: ${demo.fullName} (${demo.publicSlug})`);
  }

  // ============ Gamification ============
  await seedGamification(prisma);

  console.log('\n✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
