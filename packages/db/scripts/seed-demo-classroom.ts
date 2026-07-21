/**
 * Demo classroom seed: 1 teacher + 16 students, 4 groups of 4 students
 * each, a mix of lesson types per group, teacher<->student DMs, and
 * group live-chat conversations between classmates.
 *
 * Note on student-to-student messaging: the DM feature deliberately
 * forbids STUDENT+STUDENT threads (see dm.service.ts assertMutuallyVisible
 * — "Students cannot message other students directly", Req 15.3). The
 * channel where classmates actually talk to each other in this app is
 * the live-lesson group chat (ChatRoom scope=LIVE_SESSION, scoped to a
 * lesson, all enrolled group members can post) — that's what this
 * script seeds for cross-student conversation.
 *
 * Idempotent: re-running is a no-op if the demo course already exists.
 */
import { PrismaClient, LessonType, HomeworkModuleType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PASSWORD = 'Bilgim2026!';
const COURSE_TITLE = 'Umumiy Ingliz tili kursi (Demo)';

const GROUP_DEFS = [
  { name: 'A1 - Boshlang\'ich', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0' },
  { name: 'A2 - Elementar', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=11;BYMINUTE=0' },
  { name: 'B1 - O\'rta', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=15;BYMINUTE=0' },
  { name: 'B2 - Yuqori o\'rta', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH,SA;BYHOUR=18;BYMINUTE=0' },
];

const LESSON_DEFS: Array<{ type: LessonType; title: string; description: string }> = [
  {
    type: LessonType.RECORDED,
    title: "1-dars: Present Simple — video dars",
    description: 'Oldindan yozib qo\'yilgan video dars, istalgan vaqtda tomosha qilinadi.',
  },
  {
    type: LessonType.LIVE,
    title: '2-dars: Speaking Club — jonli efir',
    description: "Real vaqtda o'qituvchi bilan gaplashish mashqi.",
  },
  {
    type: LessonType.HYBRID,
    title: '3-dars: Grammar + Amaliyot — aralash dars',
    description: 'Video material + jonli Q&A qismi.',
  },
  {
    type: LessonType.TEXT_ONLY,
    title: '4-dars: Vocabulary — matnli dars',
    description: "Faqat matn va rasm asosidagi o'quv materiali.",
  },
];

const STUDENT_NAMES = [
  'Aziz Karimov', 'Dilnoza Yusupova', 'Sardor Rashidov', 'Malika Tosheva',
  'Jasur Nazarov', 'Nilufar Ergasheva', 'Bobur Alimov', 'Sevinch Qodirova',
  'Otabek Yoldashev', 'Gulnoza Saidova', 'Farrux Mirzayev', 'Zarina Abdullayeva',
  'Diyorbek Xolmatov', 'Madina Turg\'unova', 'Shohruh Islomov', 'Kamola Ne\'matova',
];

const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_CHARS.charAt(Math.floor(Math.random() * JOIN_CODE_CHARS.length));
  }
  return code;
}

function buildDmScopeRef(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

async function allocateUniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateJoinCode();
    const existing = await prisma.group.findUnique({ where: { joinCode: code } });
    if (!existing) return code;
  }
  throw new Error('Failed to allocate a unique join code');
}

async function main() {
  const already = await prisma.course.findFirst({ where: { title: COURSE_TITLE } });
  if (already) {
    console.log('Demo classroom already seeded (course exists) — skipping.');
    console.log(`Course id: ${already.id}`);
    return;
  }

  const english = await prisma.specialty.findUnique({ where: { slug: 'english' } });
  if (!english) throw new Error('Specialty "english" not found — run prisma:seed first');

  const plan = await prisma.plan.findUnique({ where: { slug: 'teacher-monthly' } });

  const passwordHash = await argon2.hash(PASSWORD);

  // ---- Teacher ----
  const teacherEmail = 'teacher@bilgim.uz';
  const teacherUser = await prisma.user.upsert({
    where: { email: teacherEmail },
    update: { passwordHash },
    create: {
      email: teacherEmail,
      passwordHash,
      role: 'TEACHER',
      status: 'ACTIVE',
      fullName: 'Dilfuza Rahimova',
      locale: 'uz',
    },
  });
  await prisma.teacherProfile.upsert({
    where: { userId: teacherUser.id },
    update: { specialtyId: english.id, onboardingCompletedAt: new Date() },
    create: {
      userId: teacherUser.id,
      specialtyId: english.id,
      bio: "10 yillik tajribaga ega ingliz tili o'qituvchisi.",
      yearsOfExperience: 10,
      onboardingCompletedAt: new Date(),
    },
  });
  if (plan) {
    const existingSub = await prisma.subscription.findFirst({
      where: { teacherId: teacherUser.id, status: { in: ['TRIAL', 'ACTIVE'] } },
    });
    if (!existingSub) {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await prisma.subscription.create({
        data: {
          teacherId: teacherUser.id,
          planId: plan.id,
          status: 'TRIAL',
          trialEndsAt: periodEnd,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
    }
  }
  console.log(`Teacher: ${teacherUser.email} / ${PASSWORD}`);

  // ---- Students ----
  const students: { id: string; email: string; fullName: string }[] = [];
  for (let i = 0; i < STUDENT_NAMES.length; i++) {
    const email = `student${i + 1}@bilgim.uz`;
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash },
      create: {
        email,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        fullName: STUDENT_NAMES[i]!,
        locale: 'uz',
      },
    });
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, primaryLocale: 'uz' },
    });
    students.push({ id: user.id, email, fullName: STUDENT_NAMES[i]! });
  }
  console.log(`Students: ${students.length} accounts / ${PASSWORD}`);

  // ---- Course ----
  const course = await prisma.course.create({
    data: {
      teacherId: teacherUser.id,
      title: COURSE_TITLE,
      description: "Boshlang'ichdan yuqori o'rtagacha darajadagi ingliz tili guruhlari.",
      level: 'A1-B2',
      isPublished: true,
      isDiscoverable: true,
      fromPriceUzs: 300_000,
    },
  });
  console.log(`Course created: ${course.title}`);

  const specialtyModules = await prisma.specialtyModule.findMany({
    where: { specialtyId: english.id, isActive: true },
  });

  // ---- Groups, enrollments, lessons, DMs, group chat ----
  for (let g = 0; g < GROUP_DEFS.length; g++) {
    const def = GROUP_DEFS[g]!;
    const groupStudents = students.slice(g * 4, g * 4 + 4);
    const joinCode = await allocateUniqueJoinCode();

    const group = await prisma.group.create({
      data: {
        courseId: course.id,
        name: def.name,
        priceUzs: 300_000,
        capacity: 4,
        startsOn: new Date(),
        status: 'OPEN',
        isDiscoverable: true,
        joinCode,
      },
    });

    if (specialtyModules.length > 0) {
      await prisma.groupModule.createMany({
        data: specialtyModules.map((m) => ({
          groupId: group.id,
          moduleType: m.moduleType as HomeworkModuleType,
          isEnabled: m.defaultEnabled,
          enabledAt: m.defaultEnabled ? new Date() : null,
        })),
      });
    }

    await prisma.schedule.create({
      data: {
        groupId: group.id,
        rrule: def.rrule,
        timezone: 'Asia/Tashkent',
        durationMin: 60,
      },
    });

    for (const s of groupStudents) {
      await prisma.enrollment.create({
        data: { groupId: group.id, studentId: s.id, status: 'APPROVED' },
      });
    }

    console.log(`  Group "${group.name}" (join code ${joinCode}): ${groupStudents.map((s) => s.fullName).join(', ')}`);

    // Lessons — one of each type
    let liveLessonId: string | null = null;
    for (let l = 0; l < LESSON_DEFS.length; l++) {
      const ldef = LESSON_DEFS[l]!;
      const scheduledAt =
        ldef.type === LessonType.LIVE || ldef.type === LessonType.HYBRID
          ? new Date(Date.now() - (LESSON_DEFS.length - l) * 24 * 60 * 60 * 1000)
          : null;
      const lesson = await prisma.lesson.create({
        data: {
          groupId: group.id,
          title: ldef.title,
          description: ldef.description,
          type: ldef.type,
          status: 'READY',
          position: l,
          scheduledAt,
          publishedAt: new Date(),
        },
      });
      if (ldef.type === LessonType.LIVE) {
        liveLessonId = lesson.id;
        const startedAt = scheduledAt ?? new Date();
        await prisma.liveSession.create({
          data: {
            lessonId: lesson.id,
            status: 'ENDED',
            startedAt,
            endedAt: new Date(startedAt.getTime() + 55 * 60 * 1000),
            roomId: `demo-live-${lesson.id}`,
          },
        });
      }
    }
    console.log(`    ${LESSON_DEFS.length} lessons created (RECORDED, LIVE, HYBRID, TEXT_ONLY)`);

    // ---- Teacher <-> each student DM ----
    for (const s of groupStudents) {
      const scopeRef = buildDmScopeRef(teacherUser.id, s.id);
      const room = await prisma.chatRoom.upsert({
        where: { scope_scopeRef: { scope: 'DM', scopeRef } },
        update: {},
        create: { scope: 'DM', scopeRef },
      });
      const firstName = s.fullName.split(' ')[0];
      await prisma.chatMessage.createMany({
        data: [
          {
            roomId: room.id,
            authorId: s.id,
            body: `Assalomu alaykum! Men ${firstName}, "${group.name}" guruhidanman. Darsga qachon qo'shilsam bo'ladi?`,
          },
          {
            roomId: room.id,
            authorId: teacherUser.id,
            body: `Vaalaykum assalom, ${firstName}! Xush kelibsiz. Guruh jadvali ilovada ko'rsatilgan, birinchi darsni video shaklida topasiz.`,
          },
          {
            roomId: room.id,
            authorId: s.id,
            body: 'Rahmat, ko\'rib chiqaman!',
          },
        ],
      });
    }
    console.log(`    DM threads: ${groupStudents.length} student<->teacher conversations`);

    // ---- Group live-class chat: classmates messaging each other ----
    if (liveLessonId) {
      const chatRoom = await prisma.chatRoom.upsert({
        where: { scope_scopeRef: { scope: 'LIVE_SESSION', scopeRef: liveLessonId } },
        update: {},
        create: { scope: 'LIVE_SESSION', scopeRef: liveLessonId },
      });
      const chatLines = [
        (n: string) => `Salom hammaga! ${n} men ham shu darsdaman 🙂`,
        () => 'Ovoz yaxshi eshitilyaptimi sizlarga?',
        () => 'Ha, hammasi aniq eshitilyapti.',
        () => "Bugungi mavzu present simple ekan, uyga vazifa bormi?",
        () => "Ha, darslik 12-bet, 3-mashq qilishimiz kerak.",
        () => 'Rahmat, birga qilamizmi kechqurun?',
        () => "Bo'ladi, guruh chatida yozamiz!",
      ];
      for (let i = 0; i < chatLines.length; i++) {
        const author = groupStudents[i % groupStudents.length]!;
        const line = chatLines[i]!;
        await prisma.chatMessage.create({
          data: {
            roomId: chatRoom.id,
            authorId: author.id,
            body: line(author.fullName.split(' ')[0]!),
          },
        });
      }
      console.log(`    Group live-chat: ${chatLines.length} messages between classmates`);
    }
  }

  console.log('\nDemo classroom seeded successfully.');
  console.log(`Teacher login: ${teacherUser.email} / ${PASSWORD}`);
  console.log(`Student logins: student1@bilgim.uz .. student16@bilgim.uz / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
