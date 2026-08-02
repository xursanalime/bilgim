'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Star, ChevronDown, Zap, Flame } from 'lucide-react';
import { gamificationApi } from '../../lib/api/gamification';
import { getLevelProgress } from '../../lib/gamification-constants';
import { cn } from '../../lib/utils';
import { usePathname } from 'next/navigation';

interface XpBadgeProps {
  locale: string;
  variant?: 'badge' | 'card';
}

export function XpBadge({ locale, variant = 'badge' }: XpBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
    refetchInterval: 60000, // refresh every minute
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  if (isLoading || !profile) {
    return variant === 'card' ? (
      <div className="mx-3 mb-2 animate-pulse rounded-xl border border-rim bg-tint p-3 h-20" />
    ) : (
      <div className="flex h-10 items-center gap-2 rounded-full border border-rim bg-tint px-3 shadow-sm animate-pulse">
        <div className="h-6 w-6 shrink-0 rounded-full bg-rim" />
        <div className="h-2 w-12 sm:w-16 rounded-full bg-rim" />
      </div>
    );
  }

  const progress = getLevelProgress(profile.totalXp, profile.role);

  if (variant === 'card') {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] flex-col rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-3 text-left transition-all hover:border-blue-200 focus:outline-none"
        >
          <div className="mb-2 flex items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: progress.color }}
            >
              {progress.currentLevel}
            </div>
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex justify-between text-[10px] font-bold text-ink-soft">
                <span className="truncate">{progress.levelName}</span>
                <span>
                  {profile.totalXp}/
                  {progress.isMaxLevel ? 'MAX' : progress.nextLevelMinXp} XP
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100 shadow-inner">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress.progressPercent}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold text-ink-soft">
            <Flame className="h-3 w-3 text-orange fill-orange/20" />
            <span>{profile.currentStreak} kunlik streak</span>
          </div>
        </button>

        {/* Dropdown Popover (Reuse same dropdown logic) */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-3 right-3 z-50 mb-2 origin-bottom rounded-2xl border border-rim bg-white p-4 shadow-xl"
            >
              <DropdownContent locale={locale} profile={profile} progress={progress} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="relative w-full sm:w-auto" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'group flex h-10 w-full sm:w-auto items-center gap-2 rounded-full border bg-white px-1.5 shadow-sm transition-all hover:bg-tint focus:outline-none',
          isOpen ? 'border-blue/30 ring-2 ring-blue/10' : 'border-rim',
        )}
      >
        {/* Level Circle */}
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white shadow-inner"
          style={{ backgroundColor: progress.color }}
        >
          {progress.currentLevel}
        </div>

        {/* Progress Bar & XP Text */}
        <div className="flex flex-1 flex-col items-start justify-center min-w-0 mr-1">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-ink-strong truncate">
            <span className="text-blue">{profile.totalXp} XP</span>
          </div>

          <div className="mt-1 h-1 w-full sm:w-20 overflow-hidden rounded-full bg-rim/50">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress.progressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ backgroundColor: progress.color }}
            />
          </div>
        </div>

        <ChevronDown
          className={cn(
            'mr-1 h-3 w-3 shrink-0 text-ink-faint transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-rim bg-white p-4 shadow-xl z-50 origin-top-right"
          >
            <DropdownContent locale={locale} profile={profile} progress={progress} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DropdownContent({ 
  locale, 
  profile, 
  progress 
}: { 
  locale: string; 
  profile: any; 
  progress: any 
}) {
  return (
    <>
      <div className="flex items-center gap-4 border-b border-rim pb-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black text-white shadow-inner"
          style={{
            backgroundColor: progress.color,
            boxShadow: `0 0 20px ${progress.color}40`,
          }}
        >
          {progress.currentLevel}
        </div>
        <div>
          <p className="font-display font-extrabold text-ink-strong">
            {progress.levelName}
          </p>
          <p className="text-xs font-medium text-ink-soft">
            Keyingi levelga:{' '}
            <span className="font-bold text-ink-strong">
              {progress.isMaxLevel
                ? 'Maksimal'
                : `${progress.xpNeededForNext - progress.xpInCurrentLevel} XP`}
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 py-4">
        <div className="rounded-xl bg-tint p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 text-orange mb-1">
            <Flame className="h-4 w-4 fill-orange/20" />
          </div>
          <p className="text-xs font-bold text-ink-strong">
            {profile.currentStreak} kun
          </p>
          <p className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
            Streak
          </p>
        </div>
        <div className="rounded-xl bg-tint p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 text-blue mb-1">
            <Zap className="h-4 w-4 fill-blue" />
          </div>
          <p className="text-xs font-bold text-ink-strong">
            {profile.weeklyXp} XP
          </p>
          <p className="text-[9px] font-bold uppercase tracking-wider text-ink-faint">
            Bu hafta
          </p>
        </div>
      </div>

      <Link
        href={`/${locale}/achievements`}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-blue/10 py-2.5 text-xs font-bold text-blue transition-colors hover:bg-blue hover:text-white"
      >
        <Star className="h-3.5 w-3.5" />
        To'liq yutuqlarni ko'rish
      </Link>
    </>
  );
}
