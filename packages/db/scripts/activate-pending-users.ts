
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const usersToActivate = await prisma.user.findMany({
    where: {
      status: 'PENDING_VERIFY',
    },
  });

  if (usersToActivate.length === 0) {
    console.log('Faollashtirish uchun kutilayotgan foydalanuvchilar topilmadi.');
    return;
  }

  console.log(`Faollashtirish uchun topilgan foydalanuvchilar soni: ${usersToActivate.length}`);

  for (const user of usersToActivate) {
    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        status: 'ACTIVE',
      },
    });
    console.log(`Foydalanuvchi ${user.email} faollashtirildi.`);
  }

  console.log('Barcha kutilayotgan foydalanuvchilar muvaffaqiyatli faollashtirildi.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
