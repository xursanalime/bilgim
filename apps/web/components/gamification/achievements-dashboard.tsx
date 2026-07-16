'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useMemo } from 'react';
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
  AlertCircle,
} from 'lucide-react';
import { gamificationApi, type Badge as BadgeType } from '../../lib/api/gamification';
import { getLevelProgress } from '../../lib/gamification-constants';
import { cn } from '../../lib/utils';
import {
  getRarityStyle,
  getRarityLabel,
  getCategoryLabel,
  getXpReasonLabel,
  formatDateUz,
  CATEGORY_LABEL_UZ,
} from './gamification-labels';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { ProgressBar } from '../ui/progress-bar';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { LoadingState, ErrorState, EmptyState } from '../states';

// ═════════════════════════════════════════════════════════════════
// AchievementsDashboard — XP/level, streak, activity history, and the
// badge gallery (earned vs locked, with rarity). Restyled to the design
// system (semantic tokens, Card/Badge/Select/ProgressBar/Dialog + state
// primitives) and localized in Uzbek via the shared gamification labels.
// (Requirements 12.3, 12.5)
// ═════════════════════════════════════════════════════════════════

interface AchievementsDashboardProps {
  locale: string;
  role: 'STUDENT' | 'TEACHER';
}

// Badge icon with graceful fallback to a generic award glyph.
function BadgeIcon({
  iconUrl,
  name,
  isEarned,
  className,
}: {
  iconUrl?: string | null;
  name: string;
  isEarned: boolean;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (imgError || !iconUrl) {
    return (
      <span
        className={cn(
          'flex items-center justify-center transition-all duration-300',
          className,
          !isEarned && 'opacity-40 grayscale',
        )}
        aria-hidden="true"
      >
        <Award className="h-6 w-6" />
      </span>
    );
  }

  return (
    <img
      src={iconUrl}
      alt={name}
      className={cn(
        'object-cover transition-all duration-300',
        className,
        !isEarned && 'opacity-40 grayscale',
      )}
      onError={() => setImgError(true)}
    />
  );
}

export function AchievementsDashboard({ locale: _locale, role }: AchievementsDashboardProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [selectedBadge, setSelectedBadge] = useState<BadgeType | null>(null);

  const {
    data: profile,
    isLoading: isProfileLoading,
    isError: isProfileError,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
  });

  const { data: allBadges = [], isLoading: isBadgesLoading } = useQuery({
    queryKey: ['gamification', 'badges', 'all'],
    queryFn: () => gamificationApi.getAllBadges(),
  });

  const { data: myBadges = [] } = useQuery({
    queryKey: ['gamification', 'badges', 'me'],
    queryFn: () => gamificationApi.getMyBadges(),
  });

  const progress = profile ? getLevelProgress(profile.totalXp, profile.role) : null;
  const xpHistory = profile?.xpHistory ?? [];

  const earnedBadgeIds = useMemo(
    () => new Set(myBadges.map((b) => b.badgeId)),
    [myBadges],
  );

  const filteredBadges = useMemo(() => {
    return allBadges.filter((b) => {
      if (b.targetRole && b.targetRole !== role) return false;
      if (selectedCategory !== 'ALL' && b.category !== selectedCategory) return false;
      if (selectedRarity !== 'ALL' && b.rarity !== selectedRarity) return false;
      return true;
    });
  }, [allBadges, selectedCategory, selectedRarity, role]);

  if (isProfileLoading || isBadgesLoading) {
    return <LoadingState variant="page" label="Yutuqlar yuklanmoqda…" />;
  }

  if (isProfileError) {
    return (
      <ErrorState
        icon={<AlertCircle className="h-10 w-10" />}
        title="Ma'lumotni yuklab bo'lmadi"
        message="Internet aloqasini tekshiring va qayta urinib ko'ring."
        retryLabel="Qayta urinish"
        onRetry={() => void refetchProfile()}
      />
    );
  }

  if (!profile || !progress) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-10 w-10" />}
        title="Ma'lumot topilmadi"
        description="Gamifikatsiya profili hali shakllanmagan. Darslarni ko'rishni boshlang!"
      />
    );
  }

  // Last 7 days of streak activity (derived from the current streak count).
  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const isToday = i === 6;
    const isActive = profile.currentStreak > 6 - i;
    return { date: d, isActive, isToday };
  });

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
          Yutuqlar va statistika
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          O'z faolligingizni kuzating va yangi marralarni zabt eting.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* ── Row 1: Level Card (Left) & Badge Gallery (Right) ── */}
        <div className="lg:col-span-5">
          <Card padding="lg" className="relative h-full overflow-hidden">
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-40 blur-[80px]"
              style={{ backgroundColor: progress.color }}
              aria-hidden="true"
            />

            <div className="relative z-10 flex h-full flex-col items-center justify-center text-center">
              <div
                className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full sm:mb-6 sm:h-24 sm:w-24"
                style={{
                  backgroundColor: progress.color,
                  boxShadow: `0 0 40px ${progress.color}40, inset 0 4px 10px rgba(255,255,255,0.4)`,
                }}
              >
                <div className="absolute inset-0 rounded-full border-2 border-white/20" />
                <span className="font-display text-3xl font-black text-white drop-shadow-md sm:text-4xl">
                  {progress.currentLevel}
                </span>
              </div>

              <h2 className="font-display text-xl font-extrabold text-ink-strong sm:text-2xl">
                {progress.levelName}
              </h2>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-ink-soft sm:text-sm">
                {progress.totalXp} jami XP
              </p>

              <div className="mt-6 w-full space-y-2 sm:mt-8">
                <div className="flex items-center justify-between text-[10px] font-bold text-ink-strong sm:text-xs">
                  <span>Daraja progressi</span>
                  <span>{progress.progressPercent.toFixed(1)}%</span>
                </div>
                <ProgressBar
                  value={progress.progressPercent}
                  color="blue"
                  label="Daraja progressi"
                />
                <p className="text-left text-[9px] text-ink-faint sm:text-[10px]">
                  {progress.isMaxLevel
                    ? 'Siz eng yuqori darajadasiz!'
                    : `Keyingisi uchun: ${progress.xpNeededForNext - progress.xpInCurrentLevel} XP`}
                </p>
              </div>

              <div className="mt-6 flex w-full items-center justify-between rounded-2xl bg-tint p-3 sm:mt-8 sm:p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-tint text-blue sm:h-10 sm:w-10">
                    <Zap className="h-4 w-4 fill-current sm:h-5 sm:w-5" />
                  </span>
                  <div className="text-left">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-ink-faint sm:text-[10px]">
                      Joriy hafta
                    </p>
                    <p className="text-xs font-bold text-ink-strong sm:text-sm">
                      +{profile.weeklyXp} XP
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <Card padding="lg" className="flex h-full flex-col">
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink-strong sm:text-lg">
                  <Award className="h-5 w-5 text-blue" aria-hidden="true" />
                  Nishonlar
                </h3>
                <p className="mt-0.5 text-[10px] text-ink-soft sm:text-xs">
                  {earnedBadgeIds.size} / {allBadges.length} qo'lga kiritildi
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  selectSize="sm"
                  className="w-auto"
                  aria-label="Kategoriya bo'yicha filtrlash"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="ALL">Kategoriyalar</option>
                  {Object.entries(CATEGORY_LABEL_UZ).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
                <Select
                  selectSize="sm"
                  className="w-auto"
                  aria-label="Daraja bo'yicha filtrlash"
                  value={selectedRarity}
                  onChange={(e) => setSelectedRarity(e.target.value)}
                >
                  <option value="ALL">Darajalar</option>
                  <option value="COMMON">{getRarityLabel('COMMON')}</option>
                  <option value="RARE">{getRarityLabel('RARE')}</option>
                  <option value="EPIC">{getRarityLabel('EPIC')}</option>
                  <option value="LEGENDARY">{getRarityLabel('LEGENDARY')}</option>
                </Select>
              </div>
            </div>

            <div className="-mr-1 min-h-[150px] flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
                <AnimatePresence>
                  {filteredBadges.map((badge) => {
                    const isEarned = earnedBadgeIds.has(badge.id);
                    const rarity = getRarityStyle(badge.rarity);

                    return (
                      <motion.button
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        key={badge.id}
                        type="button"
                        onClick={() => setSelectedBadge(badge)}
                        className={cn(
                          'group relative flex flex-col items-center rounded-2xl border p-3 text-center outline-none transition-all hover:scale-105 focus-visible:ring-2 focus-visible:ring-blue sm:p-4',
                          isEarned
                            ? 'border-rim bg-canvas shadow-soft hover:shadow-medium'
                            : 'border-dashed border-rim bg-tint opacity-70 hover:opacity-100',
                        )}
                      >
                        <div
                          className={cn(
                            'relative mb-2 flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 sm:mb-3 sm:h-16 sm:w-16',
                            isEarned ? cn(rarity.surface, rarity.text) : 'bg-soft text-ink-faint',
                            isEarned && cn('ring-2 ring-offset-2 ring-offset-canvas', rarity.ring),
                          )}
                        >
                          <BadgeIcon
                            iconUrl={badge.iconUrl}
                            name={badge.nameUz}
                            isEarned={isEarned}
                            className="h-7 w-7 rounded-full sm:h-10 sm:w-10"
                          />
                          {!isEarned && (
                            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-rim bg-canvas shadow-soft sm:h-6 sm:w-6">
                              <Lock className="h-2.5 w-2.5 text-ink-faint sm:h-3 sm:w-3" />
                            </span>
                          )}
                        </div>
                        <p
                          className={cn(
                            'text-[10px] font-bold leading-tight sm:text-xs',
                            isEarned ? 'text-ink-strong' : 'text-ink-soft',
                          )}
                        >
                          {badge.nameUz}
                        </p>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>

              {filteredBadges.length === 0 && (
                <div className="py-8 text-center text-sm text-ink-soft">
                  Hech narsa topilmadi.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Row 2: Streak Card (Left) & XP History (Right) ── */}
        <div className="lg:col-span-5">
          <Card padding="lg" className="flex h-full flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink-strong sm:text-lg">
                  Faollik seriyasi
                </h3>
                <p className="mt-0.5 text-[10px] text-ink-soft sm:text-xs">
                  Har kuni tizimga kiring
                </p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-tint text-orange sm:h-12 sm:w-12">
                <Flame className="h-5 w-5 fill-orange/20 sm:h-6 sm:w-6" />
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2 sm:mt-6">
              <span className="font-display text-3xl font-black text-ink-strong sm:text-4xl">
                {profile.currentStreak}
              </span>
              <span className="text-xs font-bold text-ink-soft sm:text-sm">kun</span>
            </div>

            <div className="mt-4 flex justify-between gap-1 sm:mt-6 sm:gap-2">
              {last7Days.map((day, i) => {
                const { isActive, isToday } = day;
                return (
                  <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <motion.div
                      initial={isActive ? { scale: 0.8, opacity: 0 } : false}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.05, type: 'spring', stiffness: 300 }}
                      className={cn(
                        'relative flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 sm:h-10 sm:w-10',
                        isToday
                          ? 'bg-orange-tint text-orange ring-2 ring-orange ring-offset-2 ring-offset-canvas'
                          : isActive
                            ? 'bg-green text-white shadow-soft'
                            : 'border border-dashed border-rim bg-tint text-ink-faint',
                      )}
                    >
                      {isToday ? (
                        <Flame className="h-5 w-5 fill-orange/20" />
                      ) : isActive ? (
                        <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      ) : (
                        <span className="text-xl leading-none">·</span>
                      )}
                    </motion.div>
                    <span
                      className={cn(
                        'w-full truncate text-center text-[8px] font-black uppercase sm:text-[9px]',
                        isToday ? 'text-orange' : isActive ? 'text-green' : 'text-ink-faint',
                      )}
                    >
                      {day.date.toLocaleDateString('uz-UZ', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-rim pt-6 sm:mt-8">
              <div>
                <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-ink-faint sm:text-[10px]">
                  Eng uzun seriya
                </p>
                <p className="text-xs font-bold text-ink-strong sm:text-sm">
                  {profile.longestStreak} kun
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-ink-faint sm:text-[10px]">
                    Muzlatish
                  </p>
                  <span className="group relative inline-flex">
                    <button
                      type="button"
                      aria-label="Muzlatish haqida ma'lumot"
                      className="inline-flex cursor-help rounded-full text-ink-soft outline-none focus-visible:ring-2 focus-visible:ring-blue"
                    >
                      <Info className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-40 -translate-x-1/2 rounded-lg bg-ink-strong p-2 text-[9px] text-white group-hover:block group-focus-within:block sm:w-48 sm:text-[10px]"
                    >
                      Muzlatish sizga 1 kun faol bo'lmasangiz ham seriyani saqlab qolish
                      imkonini beradi.
                    </span>
                  </span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Snowflake
                      key={i}
                      className={cn(
                        'h-3 w-3 sm:h-4 sm:w-4',
                        i < profile.freezesLeft ? 'fill-blue/20 text-blue' : 'text-rim',
                      )}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <Card padding="lg" className="flex h-full flex-col">
            <h3 className="mb-6 flex items-center gap-2 font-display text-base font-bold text-ink-strong sm:text-lg">
              <Clock className="h-5 w-5 text-ink-soft" aria-hidden="true" />
              Faollik tarixi
            </h3>

            <div className="-mr-1 min-h-[150px] flex-1 space-y-4 overflow-y-auto pr-1">
              {xpHistory.length > 0 ? (
                xpHistory.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between rounded-2xl border border-rim bg-tint p-4 transition-colors hover:bg-canvas"
                  >
                    <div className="flex items-center gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue">
                        <Star className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-bold text-ink-strong">
                          {getXpReasonLabel(event.reason)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-soft">
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
                  Hali faollik yo'q. Darslarni ko'rishni va vazifalarni bajarishni boshlang!
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Badge detail modal ── */}
      <Dialog
        open={selectedBadge !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedBadge(null);
        }}
      >
        <DialogContent size="sm">
          {selectedBadge &&
            (() => {
              const isEarned = earnedBadgeIds.has(selectedBadge.id);
              const rarity = getRarityStyle(selectedBadge.rarity);
              const userBadge = myBadges.find((b) => b.badgeId === selectedBadge.id);

              return (
                <div className="flex flex-col items-center text-center">
                  <div
                    className={cn(
                      'mb-6 flex h-24 w-24 items-center justify-center rounded-full',
                      isEarned ? cn(rarity.surface, rarity.text) : 'bg-soft text-ink-faint',
                    )}
                  >
                    <BadgeIcon
                      iconUrl={selectedBadge.iconUrl}
                      name={selectedBadge.nameUz}
                      isEarned={isEarned}
                      className="h-16 w-16 rounded-full sm:h-20 sm:w-20"
                    />
                  </div>

                  <DialogTitle className="font-display text-2xl font-bold text-ink-strong">
                    {selectedBadge.nameUz}
                  </DialogTitle>

                  <div className="mt-3 flex items-center justify-center gap-2">
                    <Badge variant={isEarned ? rarity.badgeVariant : 'neutral'} size="md">
                      {getRarityLabel(selectedBadge.rarity)}
                    </Badge>
                    <Badge variant="neutral" size="md">
                      {getCategoryLabel(selectedBadge.category)}
                    </Badge>
                    {selectedBadge.xpReward > 0 && (
                      <Badge variant="blue" size="md">
                        +{selectedBadge.xpReward} XP
                      </Badge>
                    )}
                  </div>

                  <DialogDescription className="mt-4 text-sm leading-relaxed text-ink-soft">
                    {selectedBadge.descriptionUz}
                  </DialogDescription>

                  <div className="mt-8 w-full border-t border-rim pt-6">
                    {isEarned && userBadge ? (
                      <div className="flex items-center justify-center gap-2 text-sm font-bold text-green">
                        <CheckCircle2 className="h-5 w-5" />
                        {formatDateUz(userBadge.earnedAt)} da olingan
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-sm font-bold text-ink-soft">
                        <Lock className="h-4 w-4" />
                        Hali ochilmagan
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
