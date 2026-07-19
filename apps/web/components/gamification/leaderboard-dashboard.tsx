'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Trophy, Medal, Star, ArrowUp, Crown } from 'lucide-react';
import { gamificationApi } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import { usersApi } from '../../lib/api/users'; // Assuming this exists or we mock user names for now

interface LeaderboardDashboardProps {
  locale: string;
  userId: string;
}

export function LeaderboardDashboard({ locale, userId }: LeaderboardDashboardProps) {
  const [timeframe, setTimeframe] = useState<'GLOBAL' | 'WEEKLY'>('GLOBAL');

  const { data: leaderboard, isLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', timeframe],
    queryFn: () => gamificationApi.getGlobalLeaderboard(50, timeframe),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue border-t-transparent" />
      </div>
    );
  }

  const topUsers = leaderboard?.top || [];
  const myRank = leaderboard?.myRank;

  // Podium logic
  const first = topUsers.find(u => u.rank === 1);
  const second = topUsers.find(u => u.rank === 2);
  const third = topUsers.find(u => u.rank === 3);
  const rest = topUsers.filter(u => u.rank > 3);

  // Check if current user is in the rendered list
  const isCurrentUserInTop = topUsers.some(u => u.userId === userId);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-strong sm:text-4xl flex items-center justify-center gap-3">
          <Trophy className="h-8 w-8 text-orange" />
          Global Reyting
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-md mx-auto">
          Boshqa foydalanuvchilar bilan bellashing va yetakchilar qatoriga qo'shiling.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center">
        <div className="flex items-center gap-1 rounded-full border border-rim bg-white p-1 shadow-sm">
          <button
            onClick={() => setTimeframe('GLOBAL')}
            className={cn(
              "rounded-full px-6 py-2 text-xs font-bold transition-all",
              timeframe === 'GLOBAL' ? "bg-ink-strong text-white shadow-md" : "text-ink-soft hover:bg-tint"
            )}
          >
            Barcha vaqt
          </button>
          <button
            onClick={() => setTimeframe('WEEKLY')}
            className={cn(
              "rounded-full px-6 py-2 text-xs font-bold transition-all",
              timeframe === 'WEEKLY' ? "bg-ink-strong text-white shadow-md" : "text-ink-soft hover:bg-tint"
            )}
          >
            Bu hafta
          </button>
        </div>
      </div>

      {/* Podium */}
      <div className="flex items-end justify-center gap-2 sm:gap-6 mt-12 mb-16 h-64">
        {/* Second Place */}
        {second && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex w-24 sm:w-32 flex-col items-center"
          >
            <div className="relative mb-4 flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-slate-200 border-4 border-slate-300 shadow-lg">
              <span className="text-xl font-bold text-slate-600">
                {second.avatarUrl ? (
                  <img src={second.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  second.fullName.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="absolute -bottom-3 flex h-6 w-6 items-center justify-center rounded-full bg-slate-400 border-2 border-white shadow-sm">
                <span className="text-[10px] font-black text-white">2</span>
              </div>
            </div>
            <div className="flex h-32 w-full flex-col items-center justify-start rounded-t-3xl bg-gradient-to-t from-slate-100 to-slate-200 border-x border-t border-slate-300 pt-4 shadow-inner">
              <p className="font-bold text-slate-700 text-sm truncate w-full px-2 text-center">{second.fullName}</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-black text-blue">
                {second.xp} XP
              </p>
            </div>
          </motion.div>
        )}

        {/* First Place */}
        {first && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-28 sm:w-36 flex-col items-center z-10"
          >
            <div className="relative mb-4 flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full bg-orange/20 border-4 border-orange shadow-[0_0_30px_rgba(245,158,11,0.3)]">
              <Crown className="absolute -top-6 h-8 w-8 text-orange drop-shadow-md" />
              <span className="text-2xl font-bold text-orange">
                {first.avatarUrl ? (
                  <img src={first.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  first.fullName.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="absolute -bottom-3 flex h-7 w-7 items-center justify-center rounded-full bg-orange border-2 border-white shadow-sm">
                <span className="text-xs font-black text-white">1</span>
              </div>
            </div>
            <div className="flex h-40 w-full flex-col items-center justify-start rounded-t-3xl bg-gradient-to-t from-orange/10 to-orange/20 border-x border-t border-orange/30 pt-4 shadow-inner">
              <p className="font-bold text-orange-700 text-base truncate w-full px-2 text-center">{first.fullName}</p>
              <p className="mt-1 flex items-center gap-1 text-sm font-black text-orange">
                {first.xp} XP
              </p>
            </div>
          </motion.div>
        )}

        {/* Third Place */}
        {third && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex w-24 sm:w-32 flex-col items-center"
          >
            <div className="relative mb-4 flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-amber-100 border-4 border-amber-300 shadow-lg">
              <span className="text-xl font-bold text-amber-700">
                {third.avatarUrl ? (
                  <img src={third.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  third.fullName.slice(0, 2).toUpperCase()
                )}
              </span>
              <div className="absolute -bottom-3 flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 border-2 border-white shadow-sm">
                <span className="text-[10px] font-black text-white">3</span>
              </div>
            </div>
            <div className="flex h-28 w-full flex-col items-center justify-start rounded-t-3xl bg-gradient-to-t from-amber-50 to-amber-100 border-x border-t border-amber-200 pt-4 shadow-inner">
              <p className="font-bold text-amber-800 text-sm truncate w-full px-2 text-center">{third.fullName}</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-black text-blue">
                {third.xp} XP
              </p>
            </div>
          </motion.div>
        )}
      </div>

      {/* List */}
      <div className="rounded-[2rem] border border-rim bg-white p-2 shadow-soft">
        {rest.map((user) => {
          const isMe = user.userId === userId;
          return (
            <div 
              key={user.userId}
              className={cn(
                "flex items-center gap-4 rounded-2xl p-4 transition-colors",
                isMe ? "bg-blue/5 border border-blue/20" : "hover:bg-tint"
              )}
            >
              <div className="flex w-8 justify-center font-display text-lg font-bold text-ink-soft">
                #{user.rank}
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tint font-bold text-ink-strong">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                ) : (
                  user.fullName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("truncate font-bold", isMe ? "text-blue" : "text-ink-strong")}>
                  {isMe ? "Siz" : user.fullName}
                </p>
              </div>
              <div className="font-display font-black text-blue">
                {user.xp} XP
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky Bottom Bar for Current User if not in top list */}
      {!isCurrentUserInTop && myRank && myRank.rank !== null && (
        <div className="sticky bottom-4 mx-auto max-w-2xl rounded-2xl border border-blue/20 bg-blue/5 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="flex w-8 justify-center font-display text-lg font-bold text-blue">
              #{myRank.rank}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue text-white font-bold">
              SZ
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-blue">
                Sizning natijangiz
              </p>
              <p className="text-xs text-ink-soft">
                Yana biroz harakat qiling!
              </p>
            </div>
            <div className="font-display font-black text-blue">
              {myRank.score} XP
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
