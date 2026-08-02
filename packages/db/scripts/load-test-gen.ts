import { PrismaClient, UserRole, UserStatus, LessonType, LessonStatus, EnrollmentStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Load Test Data Generation ---');

  const passwordHash = await argon2.hash('Student123!');

  // 1. Ensure a Specialty exists
  const specialty = await prisma.specialty.upsert({
    where: { slug: 'test-specialty' },
    update: {},
    create: {
      slug: 'test-specialty',
      nameUz: 'Test Mutaxassislik',
      nameRu: 'Тестовая специальность',
      nameEn: 'Test Specialty',
      dashboardKey: 'test',
    },
  });
  console.log('✓ Specialty created');

  // 2. Create/Get Teacher
  const teacherEmail = 'loadtest-teacher@bilgim.ai';
  const teacher = await prisma.user.upsert({
    where: { email: teacherEmail },
    update: {},
    create: {
      email: teacherEmail,
      passwordHash: await argon2.hash('Teacher123!'),
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      fullName: 'Load Test Teacher',
    },
  });
  
  await prisma.teacherProfile.upsert({
    where: { userId: teacher.id },
    update: { specialtyId: specialty.id },
    create: { userId: teacher.id, specialtyId: specialty.id },
  });
  console.log('✓ Teacher created');

  // 3. Create a Course and Group
  const course = await prisma.course.create({
    data: {
      teacherId: teacher.id,
      title: 'Load Test Course',
      isPublished: true,
    },
  });

  const group = await prisma.group.create({
    data: {
      courseId: course.id,
      name: 'Load Test Group',
      status: 'OPEN',
    },
  });
  console.log('✓ Course and Group created');

  // 4. Create a LIVE Lesson
  const lesson = await prisma.lesson.create({
    data: {
      groupId: group.id,
      title: 'Load Test Live Lesson',
      type: LessonType.LIVE,
      status: LessonStatus.READY,
    },
  });
  console.log('✓ LIVE Lesson created. ID:', lesson.id);

  // 5. Create 50 Students and Enroll them
  console.log('Creating 50 students...');
  for (let i = 1; i <= 50; i++) {
    const studentEmail = `student${i}@test.com`;
    const user = await prisma.user.upsert({
      where: { email: studentEmail },
      update: {},
      create: {
        email: studentEmail,
        passwordHash,
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        fullName: `Test Student ${i}`,
      },
    });

    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    await prisma.enrollment.upsert({
      where: {
        groupId_studentId: {
          groupId: group.id,
          studentId: user.id,
        },
      },
      update: { status: EnrollmentStatus.APPROVED },
      create: {
        groupId: group.id,
        studentId: user.id,
        status: EnrollmentStatus.APPROVED,
      },
    });
    
    if (i % 5 === 0) console.log(`  Created ${i} students...`);
  }

  console.log('\n--- Load Test Data Generation Complete ---');
  console.log('Lesson ID to test:', lesson.id);
  console.log('Student credentials: student[1-20]@test.com / Student123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
