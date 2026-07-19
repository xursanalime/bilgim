import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis('redis://localhost:6380');

async function syncLeaderboard() {
  console.log('🔄 Syncing gamification leaderboard...');
  const profiles = await prisma.gamificationProfile.findMany();
  
  const now = new Date();
  const weekKey = `lb:weekly:${now.getFullYear()}:${getWeekNumber(now)}`;

  for (const profile of profiles) {
    await redis.zadd('lb:global', profile.totalXp, profile.userId);
    await redis.zadd(weekKey, profile.weeklyXp, profile.userId);
    console.log(`  ✓ Added user ${profile.userId} (Total: ${profile.totalXp} XP, Weekly: ${profile.weeklyXp} XP)`);
  }
  
  console.log('✅ Leaderboard sync complete!');
  process.exit(0);
}

function getWeekNumber(d: Date): number {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
}

syncLeaderboard().catch(err => {
  console.error(err);
  process.exit(1);
});
