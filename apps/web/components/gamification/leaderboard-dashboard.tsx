'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Trophy, Crown, Medal, AlertCircle, Sparkles, TrendingUp } from 'lucide-react';
import { gamificationApi, type LeaderboardEntry } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { LoadingState } from '../states/loading-state';
import { ErrorState } from '../states/error-state';
import { EmptyState } from '../states/empty-state';

// ═════════════════════════════════════════════════════════════════
// LeaderboardDashboard — global / weekly leaderboard.
//
// Visual redesign aligned with the student/teacher dashboards: a
// canvas header with aurora blur blobs + mono eyebrow, an elevated
// gold/silver/bronze podium for the top 3, and a clean ranked list
// for ranks 4+ that highlights the current user (via the `userId`
// prop). Semantic tokens only, so light/dark mode flip automatically.
// All data fetching, the all-time/weekly toggle and the current-user
// rank logic are preserved. (Requirements 12.3, 12.5)
// ═════════════════════════════════════════════════════════════════

interface LeaderboardDashboardProps {
  locale: string;
  userId: string;
}

type Timeframe = 'GLOBAL' | 'WEEKLY';

type Place = 1 | 2 | 3;

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function formatXp(xp: number): string {
  return xp.toLocaleString('en-US').replace(/,/g, ' ');
}

// Podium accents mapped onto the design-system palette so they flip in
// dark mode: gold → orange, silver → neutral ink, bronze → amber.
const PODIUM: Record<
  Place,
  {
    label: string;
    icon: typeof Crown;
    ring: string;
    halo: string;
    badge: string;
    chip: string;
    accentText: string;
    pedestal: string;
    avatar: 'lg' | 'xl';
    lift: string;
  }
> = {
  1: {
    label: 'Oltin',
    icon: Crown,
    ring: 'ring-orange/70',
    halo: 'bg-orange/20',
    badge: 'bg-orange text-white shadow-soft',
    chip: 'bg-orange-tint text-orange',
    accentText: 'text-orange',
    pedestal:
      'h-36 bg-gradient-to-t from-orange-tint via-orange/5 to-transparent border-orange/30',
    avatar: 'xl',
    lift: '-mt-6',
  },
  2: {
    label: 'Kumush',
    icon: Medal,
    ring: 'ring-ink-ghost',
    halo: 'bg-ink-soft/10',
    badge: 'bg-soft text-ink-strong shadow-soft',
    chip: 'bg-soft text-ink-soft',
    accentText: 'text-ink-soft',
    pedestal: 'h-28 bg-gradient-to-t from-soft via-tint to-transparent border-rim',
    avatar: 'lg',
    lift: 'mt-0',
  },
  3: {
    label: 'Bronza',
    icon: Medal,
    ring: 'ring-amber-500/60',
    halo: 'bg-amber-500/15',
    badge: 'bg-amber-500 text-white shadow-soft',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    accentText: 'text-amber-600 dark:text-amber-400',
    pedestal:
      'h-24 bg-gradient-to-t from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/25',
    avatar: 'lg',
    lift: 'mt-2',
  },
};

// ──────────────────────────────────────────────────────────────────
// Podium slot — a single top-3 competitor on a pedestal.
// ──────────────────────────────────────────────────────────────────
function PodiumSlot({
  entry,
  place,
  isMe,
  delay,
}: {
  entry: LeaderboardEntry;
  place: Place;
  isMe: boolean;
  delay: number;
}) {
  const style = PODIUM[place];
  const Icon = style.icon;
  const isFirst = place === 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 120, damping: 16 }}
      className={cn(
        'flex flex-col items-center',
        isFirst ? 'z-10 w-28 sm:w-36' : 'w-24 sm:w-32',
        style.lift,
      )}
    >
      {/* Avatar + rank badge */}
      <div className="relative mb-3">
        <Icon
          className={cn(
            'absolute left-1/2 h-7 w-7 -translate-x-1/2 drop-shadow-sm',
            isFirst ? '-top-7 sm:h-8 sm:w-8' : '-top-6',
            style.accentText,
          )}
          aria-hidden="true"
        />
        {/* Soft glow halo behind the avatar */}
        <span
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full blur-xl',
            style.halo,
          )}
        />
        <Avatar
          size={style.avatar}
          className={cn(
            'ring-4 ring-offset-2 ring-offset-canvas',
            isMe ? 'ring-blue' : style.ring,
          )}
        >
          {entry.avatarUrl ? <AvatarImage src={entry.avatarUrl} alt={entry.fullName} /> : null}
          <AvatarFallback className={cn(style.chip, 'font-black')}>
            {initials(entry.fullName)}
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            'absolute -bottom-2 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-canvas text-xs font-black',
            style.badge,
          )}
        >
          {place}
        </span>
      </div>

      {/* Name + XP */}
      <p
        className={cn(
          'w-full truncate px-1 text-center text-sm font-bold',
          isMe ? 'text-blue' : 'text-ink-strong',
        )}
      >
        {isMe ? 'Siz' : entry.fullName}
      </p>
      <span
        className={cn(
          'mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black',
          style.chip,
        )}
      >
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        {formatXp(entry.xp)} XP
      </span>

      {/* Pedestal */}
      <div
        className={cn(
          'mt-3 flex w-full items-start justify-center rounded-t-2xl border-x border-t pt-2 font-display text-[11px] font-black uppercase tracking-widest',
          style.pedestal,
          style.accentText,
        )}
      >
        {style.label}
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Ranked row — a single competitor in the ranks 4+ list.
// ──────────────────────────────────────────────────────────────────
function RankRow({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-2xl p-3 transition-all sm:gap-4 sm:p-4',
        isMe
          ? 'bg-blue-tint ring-1 ring-blue/40'
          : 'hover:bg-tint',
      )}
    >
      <span
        className={cn(
          'flex w-9 shrink-0 justify-center font-display text-base font-black tabular-nums sm:text-lg',
          isMe ? 'text-blue' : 'text-ink-faint',
        )}
      >
        {entry.rank}
      </span>
      <Avatar size="md" className={cn(isMe && 'ring-2 ring-blue ring-offset-2 ring-offset-canvas')}>
        {entry.avatarUrl ? <AvatarImage src={entry.avatarUrl} alt={entry.fullName} /> : null}
        <AvatarFallback>{initials(entry.fullName)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className={cn('truncate font-bold', isMe ? 'text-blue' : 'text-ink-strong')}>
          {isMe ? 'Siz' : entry.fullName}
        </p>
        {isMe && (
          <span className="rounded-full bg-blue px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
            Siz
          </span>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 font-display text-sm font-black tabular-nums sm:text-base',
          isMe ? 'text-blue' : 'text-ink-strong',
        )}
      >
        {formatXp(entry.xp)} XP
      </span>
    </li>
  );
}

export function LeaderboardDashboard({ userId }: LeaderboardDashboardProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('GLOBAL');

  const {
    data: leaderboard,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['gamification', 'leaderboard', timeframe],
    queryFn: () => gamificationApi.getGlobalLeaderboard(50, timeframe),
    refetchInterval: 30000,
  });

  const topUsers = leaderboard?.top ?? [];
  const myRank = leaderboard?.myRank;

  const first = topUsers.find((u) => u.rank === 1);
  const second = topUsers.find((u) => u.rank === 2);
  const third = topUsers.find((u) => u.rank === 3);
  const rest = topUsers.filter((u) => u.rank > 3);
  const isCurrentUserInTop = topUsers.some((u) => u.userId === userId);

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      {/* ── Header ── */}
      <header className="group relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-orange/10 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-purple/5 blur-[80px]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-orange">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-orange" />
              </span>
              Reyting
            </div>
            <h1 className="flex items-center gap-2.5 font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-tint text-orange">
                <Trophy className="h-5 w-5" aria-hidden="true" />
              </span>
              Global Reyting
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft">
              Boshqa oʻquvchilar bilan bellashing, XP toʻplang va yetakchilar qatoriga koʻtariling.
            </p>
          </div>

          {/* Timeframe toggle */}
          <Tabs
            value={timeframe}
            onValueChange={(v) => setTimeframe(v as Timeframe)}
            variant="pill"
            className="lg:shrink-0"
          >
            <TabsList>
              <TabsTrigger value="GLOBAL">Barcha vaqt</TabsTrigger>
              <TabsTrigger value="WEEKLY">Bu hafta</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {isLoading ? (
        <LoadingState variant="list" count={6} label="Reyting yuklanmoqda…" />
      ) : isError ? (
        <ErrorState
          icon={<AlertCircle className="h-10 w-10" />}
          title="Reytingni yuklab boʻlmadi"
          message="Internet aloqasini tekshiring va qayta urinib koʻring."
          retryLabel="Qayta urinish"
          onRetry={() => void refetch()}
        />
      ) : topUsers.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-10 w-10" />}
          title="Reyting hali boʻsh"
          description="XP toʻplang va birinchi boʻlib yetakchilar qatorini boshlang!"
        />
      ) : (
        <>
          {/* ── Podium (top 3) ── */}
          <section className="relative overflow-hidden rounded-3xl border border-rim bg-canvas p-6 shadow-soft sm:p-8">
            <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-48 -translate-x-1/2 rounded-full bg-orange/10 blur-[70px]" />
            <div className="relative z-10 mb-6 flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-widest text-ink-faint">
              <Crown className="h-4 w-4 text-orange" aria-hidden="true" />
              Eng kuchli uchlik
            </div>
            <div className="relative z-10 flex items-end justify-center gap-3 sm:gap-8">
              {second && (
                <PodiumSlot
                  entry={second}
                  place={2}
                  isMe={second.userId === userId}
                  delay={0.1}
                />
              )}
              {first && (
                <PodiumSlot entry={first} place={1} isMe={first.userId === userId} delay={0} />
              )}
              {third && (
                <PodiumSlot entry={third} place={3} isMe={third.userId === userId} delay={0.2} />
              )}
            </div>
          </section>

          {/* ── Ranked list (4+) ── */}
          {rest.length > 0 && (
            <section className="overflow-hidden rounded-3xl border border-rim bg-canvas shadow-soft">
              <div className="flex items-center gap-2 border-b border-rim px-5 py-4 font-display text-sm font-extrabold uppercase tracking-widest text-ink-faint">
                <TrendingUp className="h-4 w-4 text-blue" aria-hidden="true" />
                Boshqa ishtirokchilar
              </div>
              <ul className="space-y-1 p-2 sm:p-3">
                {rest.map((user) => (
                  <RankRow key={user.userId} entry={user} isMe={user.userId === userId} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Sticky bar for the current user when they're outside the visible list */}
      {!isLoading && !isError && !isCurrentUserInTop && myRank && myRank.rank !== null && (
        <div className="sticky bottom-4 z-20 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-blue/30 bg-blue-tint/90 p-4 shadow-medium backdrop-blur-md">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-blue/10 blur-2xl" />
          <div className="relative z-10 flex items-center gap-4">
            <span className="flex w-9 shrink-0 justify-center font-display text-lg font-black tabular-nums text-blue">
              {myRank.rank}
            </span>
            <Avatar size="md" className="ring-2 ring-blue ring-offset-2 ring-offset-canvas">
              <AvatarFallback className="bg-blue text-white">SZ</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold text-blue">Sizning natijangiz</p>
                <span className="rounded-full bg-blue px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                  Siz
                </span>
              </div>
              <p className="text-xs text-ink-soft">Yana biroz harakat qiling — yuqoriga koʻtarilasiz!</p>
            </div>
            <span className="shrink-0 font-display font-black tabular-nums text-blue">
              {formatXp(myRank.score)} XP
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
