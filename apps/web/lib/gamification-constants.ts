export interface LevelDef {
  level: number;
  nameUz: string;
  minXp: number;
  color?: string;
}

export const STUDENT_LEVELS: LevelDef[] = [
  { level: 1, nameUz: 'Yangi Talaba', minXp: 0, color: '#6B7280' },
  { level: 2, nameUz: 'Qiziquvchan', minXp: 300, color: '#3B82F6' },
  { level: 3, nameUz: 'Izlovchi', minXp: 800, color: '#8B5CF6' },
  { level: 4, nameUz: 'Bilimdon', minXp: 1800, color: '#10B981' },
  { level: 5, nameUz: 'Mohir', minXp: 3500, color: '#F59E0B' },
  { level: 6, nameUz: 'Ustoz Shogirdi', minXp: 6000, color: '#EF4444' },
  { level: 7, nameUz: 'Ilm Fidoyisi', minXp: 10000, color: '#EC4899' },
  { level: 8, nameUz: 'Bilim Chempioni', minXp: 15000, color: '#F97316' },
  { level: 9, nameUz: 'Elita', minXp: 22000, color: '#06B6D4' },
  { level: 10, nameUz: 'Bilim Ustasi', minXp: 30000, color: '#7C3AED' },
];

export const TEACHER_LEVELS: LevelDef[] = [
  { level: 1, nameUz: "Yangi O'qituvchi", minXp: 0, color: '#6B7280' },
  { level: 2, nameUz: "Faol O'qituvchi", minXp: 500, color: '#3B82F6' },
  { level: 3, nameUz: "Tajribali O'qituvchi", minXp: 1500, color: '#8B5CF6' },
  { level: 4, nameUz: 'Mentor', minXp: 4000, color: '#10B981' },
  { level: 5, nameUz: 'Expert O\'qituvchi', minXp: 10000, color: '#F59E0B' },
  { level: 6, nameUz: 'Ustoz', minXp: 20000, color: '#EF4444' },
  { level: 7, nameUz: 'Grand Ustoz', minXp: 35000, color: '#EC4899' },
];

export function getLevelProgress(xp: number, role: 'STUDENT' | 'TEACHER') {
  const levels = role === 'TEACHER' ? TEACHER_LEVELS : STUDENT_LEVELS;
  let currentLevelDef = levels[0]!;
  let nextLevelDef = levels[1] || levels[0]!;

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level && xp >= level.minXp) {
      currentLevelDef = level;
      nextLevelDef = levels[i + 1] || level; // Cap at max level
    } else {
      break;
    }
  }

  const isMaxLevel = currentLevelDef === nextLevelDef;
  const xpInCurrentLevel = isMaxLevel ? 0 : xp - currentLevelDef.minXp;
  const xpNeededForNext = isMaxLevel ? 1 : nextLevelDef.minXp - currentLevelDef.minXp;
  const progressPercent = isMaxLevel ? 100 : Math.min(100, Math.max(0, (xpInCurrentLevel / xpNeededForNext) * 100));

  return {
    currentLevel: currentLevelDef.level,
    levelName: currentLevelDef.nameUz,
    color: currentLevelDef.color || '#3B82F6',
    totalXp: xp,
    xpInCurrentLevel,
    xpNeededForNext,
    progressPercent,
    isMaxLevel,
    nextLevelMinXp: nextLevelDef.minXp
  };
}
