import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'admin@bilgim.uz' } });
  if (!user) return;
  
  // Ensure profile exists first
  await prisma.gamificationProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, role: user.role, totalXp: 50 },
    update: { totalXp: { increment: 50 } }
  });

  await prisma.xpEvent.create({
    data: {
      userId: user.id,
      amount: 50,
      reason: 'homework_submitted',
    }
  });
  console.log('Added 50 XP and history to admin');
}
main().catch(console.error);
