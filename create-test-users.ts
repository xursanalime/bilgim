import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Creating test users...');

  // Teacher
  const teacherPassword = await argon2.hash('Admin123!@#');
  const teacher = await prisma.user.upsert({
    where: { email: 'xursanalime@gmail.com' },
    update: {
      passwordHash: teacherPassword,
    },
    create: {
      email: 'xursanalime@gmail.com',
      passwordHash: teacherPassword,
      role: UserRole.TEACHER,
      status: UserStatus.ACTIVE,
      fullName: 'Xursanali Sirojiddinov',
      locale: 'uz',
    },
  });
  console.log('✓ Teacher created:', teacher.email);

  // Create teacher profile
  await prisma.teacherProfile.upsert({
    where: { userId: teacher.id },
    update: {},
    create: {
      userId: teacher.id,
    },
  });

  // Student
  const studentPassword = await argon2.hash('Admin123!@#');
  const student = await prisma.user.upsert({
    where: { email: 'safar@gmail.com' },
    update: {
      passwordHash: studentPassword,
    },
    create: {
      email: 'safar@gmail.com',
      passwordHash: studentPassword,
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      fullName: 'Safar Testoev',
      locale: 'uz',
    },
  });
  console.log('✓ Student created:', student.email);

  // Create student profile
  await prisma.studentProfile.upsert({
    where: { userId: student.id },
    update: {},
    create: {
      userId: student.id,
    },
  });

  console.log('\n✅ Test users created successfully!');
  console.log('Teacher:', teacher.email, '- Password: Admin123!@#');
  console.log('Student:', student.email, '- Password: Admin123!@#');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
