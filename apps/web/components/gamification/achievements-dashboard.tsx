'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useMemo, useEffect } from 'react';
import { 
  Star, 
  Flame, 
  Zap, 
  Lock, 
  Award, 
  Info,
  Clock,
  CheckCircle2,
  Snowflake,
  AlertCircle
} from 'lucide-react';
import { gamificationApi, type Badge } from '../../lib/api/gamification';
import { getLevelProgress } from '../../lib/gamification-constants';
import { cn } from '../../lib/utils';

// Helper for date formatting
function formatDateUz(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('uz-UZ', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface AchievementsDashboardProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER';
}

const REASON_MAP: Record<string, string> = {
  'homework_submitted': 'Uy vazifasi topshirildi',
  'live_attended': 'Jonli darsda qatnashildi',
  'badge_earned': 'Yangi yutuq',
  'challenge_completed': 'Vazifa bajarildi',
  'first_login': 'Tizimga kirish',
  'ai_tutor_used': 'AI yordamchi ishlatildi',
  'lesson_viewed': 'Dars ko\'rildi',
  'homework_graded': 'Uy vazifasi baholandi',
  'streak_milestone': 'Ketma-ketlik marrasi',
};

const RARITY_COLORS: Record<string, { bg: string; text: string; border: string; shadow: string }> = {
  COMMON: { bg: 'bg-blue/10', text: 'text-blue', border: 'border-blue/20', shadow: 'shadow-blue/20' },
  RARE: { bg: 'bg-green/10', text: 'text-green', border: 'border-green/20', shadow: 'shadow-green/20' },
  EPIC: { bg: 'bg-purple/10', text: 'text-purple', border: 'border-purple/20', shadow: 'shadow-purple/20' },
  LEGENDARY: { bg: 'bg-orange/10', text: 'text-orange', border: 'border-orange/20', shadow: 'shadow-orange/20' },
};

function getRarityStyle(rarity: string) {
  return RARITY_COLORS[rarity] || RARITY_COLORS.COMMON!;
}

const CATEGORY_MAP: Record<string, string> = {
  LEARNING: "O'rganish",
  TEACHING: "O'qitish",
  SOCIAL: "Ijtimoiy",
  SPECIAL: "Maxsus",
};

// Badge icon uchun fallback komponent
function BadgeIcon({ 
  iconUrl, 
  name, 
  rarity,
  isEarned,
  className
}: { 
  iconUrl?: string | null; 
  name: string; 
  rarity: string;
  isEarned: boolean;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  const rarityColors: Record<string, string> = {
    COMMON: 'bg-gray-100 text-gray-600',
    RARE: 'bg-blue-100 text-blue-600',
    EPIC: 'bg-purple-100 text-purple-600',
    LEGENDARY: 'bg-yellow-100 text-yellow-600',
  };

  if (imgError || !iconUrl) {
    return (
      <div className={cn(
        "flex items-center justify-center text-2xl transition-all duration-300",
        className,
        isEarned ? (rarityColors[rarity] || rarityColors.COMMON) : "bg-rim/20 grayscale opacity-40"
      )}>
        <Award className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      src={iconUrl}
      alt={name}
      className={cn("object-cover transition-all duration-300", className, !isEarned && "grayscale opacity-40")}
      onError={() => setImgError(true)}
    />
  );
}

export function AchievementsDashboard({ locale, role }: AchievementsDashboardProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);

  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
  });

  const { data: allBadges = [], isLoading: isBadgesLoading } = useQuery({
    queryKey: ['gamification', 'badges', 'all'],
    queryFn: () => gamificationApi.getAllBadges(),
  });

  const { data: myBadges = [], isLoading: isMyBadgesLoading } = useQuery({
    queryKey: ['gamification', 'badges', 'me'],
    queryFn: () => gamificationApi.getMyBadges(),
  });

  const progress = profile ? getLevelProgress(profile.totalXp, profile.role) : null;
  const xpHistory = profile?.xpHistory || [];

  const earnedBadgeIds = useMemo(() => new Set(myBadges.map(b => b.badgeId)), [myBadges]);

  const filteredBadges = useMemo(() => {
    return allBadges.filter(b => {
      // Filter by role applicability if needed
      if (b.targetRole && b.targetRole !== role) return false;
      
      if (selectedCategory !== 'ALL' && b.category !== selectedCategory) return false;
      if (selectedRarity !== 'ALL' && b.rarity !== selectedRarity) return false;
      return true;
    });
  }, [allBadges, selectedCategory, selectedRarity, role]);

  if (isProfileLoading || isBadgesLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue border-t-transparent" />
      </div>
    );
  }

  if (!profile || !progress) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-3xl border border-rim bg-white p-12 text-center shadow-sm">
        <AlertCircle className="mb-4 h-12 w-12 text-red" />
        <h2 className="font-display text-xl font-bold text-ink-strong">Ma'lumot topilmadi</h2>
        <p className="mt-2 text-sm text-ink-soft">Gamifikatsiya profili shakllanmagan.</p>
      </div>
    );
  }

  // Simulate last 7 days activity
  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const isToday = i === 6;
    // Mock active if it's within the streak
    const isActive = profile.currentStreak > (6 - i);
    return { date: d, isActive, isToday };
  });

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
          Yutuqlar va Statistika
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          O'z faolligingizni kuzating va yangi marralarni zabt eting.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* ── Row 1: Level Card (Left) & Badge Gallery (Right) ── */}
        <div className="lg:col-span-5">
          <div className="relative overflow-hidden rounded-[2rem] border border-rim bg-white p-6 sm:p-8 shadow-soft h-full flex flex-col justify-center">
            <div 
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-[80px] opacity-40"
              style={{ backgroundColor: progress.color }}
            />
            
            <div className="relative z-10 flex flex-col items-center text-center">
              <div 
                className="flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full shadow-inner mb-4 sm:mb-6 relative"
                style={{ backgroundColor: progress.color, boxShadow: `0 0 40px ${progress.color}40, inset 0 4px 10px rgba(255,255,255,0.4)` }}
              >
                <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                <span className="font-display text-3xl sm:text-4xl font-black text-white drop-shadow-md">
                  {progress.currentLevel}
                </span>
              </div>
              
              <h2 className="font-display text-xl sm:text-2xl font-extrabold text-ink-strong">
                {progress.levelName}
              </h2>
              <p className="mt-1 text-xs sm:text-sm font-medium text-ink-soft uppercase tracking-wider">
                {progress.totalXp} jami XP
              </p>

              <div className="mt-6 sm:mt-8 w-full space-y-2">
                <div className="flex items-center justify-between text-[10px] sm:text-xs font-bold text-ink-strong">
                  <span>Level Progressi</span>
                  <span>{progress.progressPercent.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-tint shadow-inner">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress.progressPercent}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: progress.color }}
                  />
                </div>
                <p className="text-[9px] sm:text-[10px] text-ink-faint text-left">
                  {progress.isMaxLevel ? 'Siz eng yuqori darajadasiz!' : `Keyingisi uchun: ${progress.xpNeededForNext - progress.xpInCurrentLevel} XP`}
                </p>
              </div>

              <div className="mt-6 sm:mt-8 flex w-full items-center justify-between rounded-2xl bg-tint p-3 sm:p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-blue/10 text-blue">
                    <Zap className="h-4 w-4 sm:h-5 sm:w-5 fill-blue" />
                  </div>
                  <div className="text-left">
                    <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink-faint">Joriy Hafta</p>
                    <p className="text-xs sm:text-sm font-bold text-ink-strong">+{profile.weeklyXp} XP</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="flex flex-col rounded-[2rem] border border-rim bg-white p-5 sm:p-8 shadow-soft h-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-ink-strong flex items-center gap-2">
                  <Award className="h-5 w-5 text-blue" />
                  Nishonlar
                </h3>
                <p className="mt-0.5 text-[10px] sm:text-xs text-ink-soft">{earnedBadgeIds.size} / {allBadges.length} qo'lga kiritildi</p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <select 
                  className="rounded-xl border border-rim bg-tint px-2 py-1.5 text-[10px] sm:text-xs font-bold text-ink-strong outline-none focus:border-blue/50"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="ALL">Kategoriyalar</option>
                  {Object.entries(CATEGORY_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <select 
                  className="rounded-xl border border-rim bg-tint px-2 py-1.5 text-[10px] sm:text-xs font-bold text-ink-strong outline-none focus:border-blue/50"
                  value={selectedRarity}
                  onChange={(e) => setSelectedRarity(e.target.value)}
                >
                  <option value="ALL">Darajalar</option>
                  <option value="COMMON">Oddiy</option>
                  <option value="RARE">Noyob</option>
                  <option value="EPIC">Epik</option>
                  <option value="LEGENDARY">Afsonaviy</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[150px] pr-1 -mr-1">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4">
                <AnimatePresence>
                  {filteredBadges.map((badge) => {
                    const isEarned = earnedBadgeIds.has(badge.id);
                    const rarityStyle = getRarityStyle(badge.rarity);

                    return (
                      <motion.button
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        key={badge.id}
                        onClick={() => setSelectedBadge(badge)}
                        className={cn(
                          "group relative flex flex-col items-center rounded-2xl border p-3 sm:p-4 text-center transition-all hover:scale-105",
                          isEarned 
                            ? cn("bg-white shadow-sm border-rim hover:shadow-md", `hover:${rarityStyle.border}`)
                            : "bg-tint border-dashed border-rim opacity-70 hover:opacity-100"
                        )}
                      >
                        <div className={cn(
                          "relative mb-2 sm:mb-3 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full transition-all duration-300",
                          isEarned ? rarityStyle.bg : "bg-rim/20 grayscale",
                          isEarned && `shadow-[0_0_15px_rgba(0,0,0,0.1)] group-hover:${rarityStyle.shadow}`
                        )}>
                          <BadgeIcon 
                            iconUrl={badge.iconUrl} 
                            name={badge.nameUz} 
                            rarity={badge.rarity} 
                            isEarned={isEarned}
                            className="h-7 w-7 sm:h-10 sm:w-10 rounded-full"
                          />
                          {!isEarned && (
                            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-white border border-rim shadow-sm">
                              <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-ink-faint" />
                            </div>
                          )}
                        </div>
                        <p className={cn("text-[10px] sm:text-xs font-bold leading-tight", isEarned ? "text-ink-strong" : "text-ink-soft")}>
                          {badge.nameUz}
                        </p>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
                
                {filteredBadges.length === 0 && (
                  <div className="col-span-full py-8 text-center text-sm text-ink-soft">
                    Hech narsa topilmadi.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2: Streak Card (Left) & XP History (Right) ── */}
        <div className="lg:col-span-5">
          <div className="rounded-[2rem] border border-rim bg-white p-6 sm:p-8 shadow-soft h-full flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-ink-strong flex items-center gap-2">
                  Faollik Seriyasi
                </h3>
                <p className="mt-0.5 text-[10px] sm:text-xs text-ink-soft">Har kuni tizimga kiring</p>
              </div>
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-orange/10 text-orange">
                <Flame className="h-5 w-5 sm:h-6 sm:w-6 fill-orange/20" />
              </div>
            </div>

            <div className="mt-4 sm:mt-6 flex items-baseline gap-2">
              <span className="font-display text-3xl sm:text-4xl font-black text-ink-strong">{profile.currentStreak}</span>
              <span className="text-xs sm:text-sm font-bold text-ink-soft">kun</span>
            </div>

            <div className="mt-4 sm:mt-6 flex justify-between gap-1 sm:gap-2">
              {last7Days.map((day, i) => {
                const isActive = day.isActive;
                const isToday = day.isToday;
                
                return (
                  <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-0">
                    <motion.div 
                      initial={isActive ? { scale: 0.8, opacity: 0 } : false}
                      animate={isActive ? { scale: 1, opacity: 1 } : { scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 300 }}
                      className={cn(
                        "relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                        isToday 
                          ? "bg-orange/20 text-orange ring-2 ring-orange ring-offset-2 ring-offset-white" 
                          : isActive
                            ? "bg-green text-white shadow-md shadow-green/20"
                            : "bg-tint text-ink-faint border border-rim border-dashed"
                      )}
                    >
                      {isToday ? (
                        <motion.div 
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                        >
                          <Flame className="h-5 w-5 fill-orange/20" />
                        </motion.div>
                      ) : isActive ? (
                        <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      ) : (
                        <span className="text-xl leading-none">·</span>
                      )}
                      
                      {isActive && !isToday && (
                        <div className="absolute inset-0 rounded-full border-2 border-green animate-pulse opacity-20" />
                      )}
                    </motion.div>
                    <span className={cn(
                      "text-[8px] sm:text-[9px] font-black uppercase truncate w-full text-center",
                      isToday ? "text-orange" : isActive ? "text-green" : "text-ink-faint"
                    )}>
                      {day.date.toLocaleDateString('uz-UZ', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 sm:mt-8 grid grid-cols-2 gap-4 border-t border-rim pt-6">
              <div>
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink-faint mb-1">Eng uzun seriya</p>
                <p className="text-xs sm:text-sm font-bold text-ink-strong">{profile.longestStreak} kun</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink-faint">Muzlatish</p>
                  <div className="group relative">
                    <Info className="h-3 w-3 text-ink-soft cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-40 sm:w-48 rounded-lg bg-ink-strong p-2 text-[9px] sm:text-[10px] text-white group-hover:block z-20">
                      Muzlatish sizga 1 kun faol bo'lmasangiz ham seriyani saqlab qolish imkonini beradi.
                      <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-ink-strong" />
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Snowflake 
                      key={i} 
                      className={cn("h-3 w-3 sm:h-4 sm:w-4", i < profile.freezesLeft ? "text-blue fill-blue/20" : "text-rim")} 
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-[2rem] border border-rim bg-white p-6 sm:p-8 shadow-soft h-full flex flex-col">
            <h3 className="font-display text-base sm:text-lg font-bold text-ink-strong flex items-center gap-2 mb-6">
              <Clock className="h-5 w-5 text-ink-soft" />
              Faollik Tarixi
            </h3>

            <div className="space-y-4 flex-1 overflow-y-auto min-h-[150px] pr-1 -mr-1">
              {xpHistory.length > 0 ? (
                xpHistory.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between rounded-2xl border border-rim bg-tint p-4 transition-colors hover:bg-white"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue/10 text-blue">
                        <Star className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-ink-strong">
                          {REASON_MAP[event.reason] || event.reason}
                        </p>
                        <p className="text-xs text-ink-soft mt-0.5">
                          {formatDateUz(event.earnedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="font-display text-lg font-black text-blue">
                      +{event.amount}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-sm text-ink-soft">
                  Hali faollik yo'q. Darslarni ko'rishni va vazifalarni bajarishni
                  boshlang!
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Badge Detail Modal */}
      <AnimatePresence>
        {selectedBadge && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              onClick={() => setSelectedBadge(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[2rem] bg-white p-8 shadow-2xl"
            >
              {(() => {
                const isEarned = earnedBadgeIds.has(selectedBadge.id);
                const rarityStyle = getRarityStyle(selectedBadge.rarity);
                const userBadge = myBadges.find(b => b.badgeId === selectedBadge.id);

                return (
                  <div className="flex flex-col items-center text-center">
                    <div className={cn(
                      "mb-6 flex h-24 w-24 items-center justify-center rounded-full",
                      isEarned ? rarityStyle.bg : "bg-tint grayscale"
                    )}>
                      <BadgeIcon 
                        iconUrl={selectedBadge.iconUrl} 
                        name={selectedBadge.nameUz} 
                        rarity={selectedBadge.rarity} 
                        isEarned={isEarned}
                        className="h-16 w-16 sm:h-20 sm:w-20 rounded-full"
                      />
                    </div>
                    
                    <h3 className="font-display text-2xl font-bold text-ink-strong">{selectedBadge.nameUz}</h3>
                    
                    <div className="mt-3 flex items-center justify-center gap-2">
                      <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", isEarned ? cn(rarityStyle.bg, rarityStyle.text) : "bg-rim text-ink-soft")}>
                        {selectedBadge.rarity}
                      </span>
                      {selectedBadge.xpReward > 0 && (
                        <span className="rounded-full bg-blue/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue">
                          +{selectedBadge.xpReward} XP
                        </span>
                      )}
                    </div>

                    <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                      {selectedBadge.descriptionUz}
                    </p>

                    <div className="mt-8 w-full border-t border-rim pt-6">
                      {isEarned ? (
                        <div className="flex items-center justify-center gap-2 text-sm font-bold text-green">
                          <CheckCircle2 className="h-5 w-5" />
                          {formatDateUz(userBadge!.earnedAt)} da olingan
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2 text-sm font-bold text-ink-soft">
                          <Lock className="h-4 w-4" />
                          Hali ochilmagan
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedBadge(null)}
                      className="mt-6 w-full rounded-2xl bg-tint px-4 py-3 text-sm font-bold text-ink-strong transition-colors hover:bg-rim/50"
                    >
                      Yopish
                    </button>
                  </div>
                );
              })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
