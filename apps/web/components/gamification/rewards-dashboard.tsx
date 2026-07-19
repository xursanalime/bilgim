'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ShoppingBag, Star, Info, Snowflake, CheckCircle2, ShieldCheck, Loader2, Lock } from 'lucide-react';
import { gamificationApi, type RewardItem } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

interface RewardsDashboardProps {
  locale: string;
}

export function RewardsDashboard({ locale }: RewardsDashboardProps) {
  const queryClient = useQueryClient();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
  });

  const { data: rewards = [], isLoading: isRewardsLoading } = useQuery({
    queryKey: ['gamification', 'rewards'],
    queryFn: () => gamificationApi.getRewards(),
  });

  const purchaseMutation = useMutation({
    mutationFn: (itemId: string) => gamificationApi.purchaseReward(itemId),
    onMutate: (itemId) => setPurchasingId(itemId),
    onSuccess: () => {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#3B82F6', '#10B981', '#F59E0B']
      });
      // Invalidate profile to update XP balance
      queryClient.invalidateQueries({ queryKey: ['gamification', 'profile'] });
    },
    onSettled: () => setPurchasingId(null),
  });

  if (isProfileLoading || isRewardsLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue border-t-transparent" />
      </div>
    );
  }

  const currentXp = profile?.totalXp || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl flex items-center gap-3">
            <ShoppingBag className="h-7 w-7 text-blue" />
            Mukofotlar Do'koni
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            To'plagan XP laringiz evaziga eksklyuziv mukofotlarni sotib oling.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-blue/20 bg-blue/5 p-4 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue/10">
            <Star className="h-5 w-5 text-blue" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Balansingiz</p>
            <p className="font-display text-xl font-black text-blue">{currentXp} XP</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {rewards.map((item) => {
            const isAffordable = currentXp >= item.xpCost;
            const isPurchasing = purchasingId === item.id;

            let Icon = Star;
            let bgColor = "bg-blue/10";
            let iconColor = "text-blue";

            if (item.itemType === 'streak_freeze') {
              Icon = Snowflake;
              bgColor = "bg-blue/10";
              iconColor = "text-blue";
            } else if (item.itemType === 'profile_frame') {
              Icon = ShieldCheck;
              bgColor = "bg-orange/10";
              iconColor = "text-orange";
            }

            return (
              <motion.div
                layout
                key={item.id}
                className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-rim bg-white p-6 shadow-soft transition-all hover:shadow-medium hover:border-blue/20"
              >
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl", bgColor)}>
                      <Icon className={cn("h-7 w-7", iconColor)} />
                    </div>
                    <div className="rounded-full bg-tint px-3 py-1 font-bold text-ink-strong">
                      {item.xpCost} XP
                    </div>
                  </div>

                  <h3 className="font-display text-lg font-bold text-ink-strong mb-2">
                    {item.nameUz}
                  </h3>
                  <p className="text-sm text-ink-soft min-h-[40px]">
                    {item.description}
                  </p>
                </div>

                <div className="mt-8">
                  <button
                    onClick={() => purchaseMutation.mutate(item.id)}
                    disabled={!isAffordable || isPurchasing}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold transition-all",
                      !isAffordable
                        ? "bg-tint text-ink-soft cursor-not-allowed"
                        : isPurchasing
                          ? "bg-blue/80 text-white cursor-wait"
                          : "bg-blue text-white hover:bg-blue-600 active:scale-[0.98] shadow-blue-soft"
                    )}
                  >
                    {isPurchasing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : !isAffordable ? (
                      <span className="flex items-center gap-1">
                        <Lock className="h-4 w-4" /> Yana {item.xpCost - currentXp} XP kerak
                      </span>
                    ) : (
                      "Sotib olish"
                    )}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {rewards.length === 0 && (
        <div className="py-12 text-center text-ink-soft">
          Hozircha do'konda mahsulotlar yo'q.
        </div>
      )}
    </div>
  );
}
