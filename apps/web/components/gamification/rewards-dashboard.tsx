'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import {
  ShoppingBag,
  Star,
  Snowflake,
  ShieldCheck,
  Lock,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { gamificationApi, type RewardItem } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import { tokens } from '../../lib/design/tokens';
import { Card, StatCard } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { LoadingState, ErrorState, EmptyState } from '../states';
import { toast } from '../ui/toast';

// ═════════════════════════════════════════════════════════════════
// RewardsDashboard — XP-funded rewards shop. Restyled to the design
// system (semantic tokens, Card/Badge/Button + state primitives) and
// localized in Uzbek. XP is spent to purchase reward items; the profile
// balance is invalidated on success so the header stays in sync.
// (Requirements 12.3, 12.5)
// ═════════════════════════════════════════════════════════════════

interface RewardsDashboardProps {
  locale: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Reward item-type → icon + accent tint (design-system palette).
const ITEM_VISUALS: Record<
  string,
  { Icon: typeof Star; surface: string; text: string }
> = {
  streak_freeze: { Icon: Snowflake, surface: 'bg-blue-tint', text: 'text-blue' },
  profile_frame: { Icon: ShieldCheck, surface: 'bg-orange-tint', text: 'text-orange' },
};

function getItemVisual(itemType: string) {
  return ITEM_VISUALS[itemType] ?? { Icon: Star, surface: 'bg-blue-tint', text: 'text-blue' };
}

export function RewardsDashboard({ locale: _locale }: RewardsDashboardProps) {
  const queryClient = useQueryClient();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const {
    data: profile,
    isLoading: isProfileLoading,
  } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
  });

  const {
    data: rewards = [],
    isLoading: isRewardsLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['gamification', 'rewards'],
    queryFn: () => gamificationApi.getRewards(),
  });

  const purchaseMutation = useMutation({
    mutationFn: (itemId: string) => gamificationApi.purchaseReward(itemId),
    onMutate: (itemId) => setPurchasingId(itemId),
    onSuccess: () => {
      if (!prefersReducedMotion()) {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: [tokens.brand.primary, tokens.semantic.success, tokens.semantic.warn],
        });
      }
      toast.success('Mukofot muvaffaqiyatli sotib olindi!');
      queryClient.invalidateQueries({ queryKey: ['gamification', 'profile'] });
    },
    onError: () => {
      toast.error("Sotib olishda xatolik yuz berdi. Qayta urinib ko'ring.");
    },
    onSettled: () => setPurchasingId(null),
  });

  const currentXp = profile?.totalXp ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-extrabold tracking-tight text-ink-strong sm:text-3xl">
            <ShoppingBag className="h-7 w-7 text-blue" aria-hidden="true" />
            Mukofotlar do'koni
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            To'plagan XP laringiz evaziga eksklyuziv mukofotlarni sotib oling.
          </p>
        </div>

        <StatCard
          className="md:w-56"
          label="Balansingiz"
          value={`${currentXp} XP`}
          icon={<Star className="h-5 w-5" />}
          accent="blue"
        />
      </div>

      {/* Content states */}
      {isProfileLoading || isRewardsLoading ? (
        <LoadingState variant="card" count={6} label="Mukofotlar yuklanmoqda…" />
      ) : isError ? (
        <ErrorState
          icon={<AlertCircle className="h-10 w-10" />}
          title="Mukofotlarni yuklab bo'lmadi"
          message="Internet aloqasini tekshiring va qayta urinib ko'ring."
          retryLabel="Qayta urinish"
          onRetry={() => void refetch()}
        />
      ) : rewards.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-10 w-10" />}
          title="Do'kon hozircha bo'sh"
          description="Tez orada yangi mukofotlar qo'shiladi. XP to'plashda davom eting!"
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {rewards.map((item: RewardItem) => {
              const isAffordable = currentXp >= item.xpCost;
              const isPurchasing = purchasingId === item.id;
              const { Icon, surface, text } = getItemVisual(item.itemType);

              return (
                <motion.div layout key={item.id} className="h-full">
                  <Card
                    padding="md"
                    className="flex h-full flex-col justify-between transition-all hover:border-blue/20 hover:shadow-medium"
                  >
                    <div>
                      <div className="mb-4 flex items-start justify-between">
                        <span
                          className={cn(
                            'flex h-14 w-14 items-center justify-center rounded-2xl',
                            surface,
                          )}
                          aria-hidden="true"
                        >
                          <Icon className={cn('h-7 w-7', text)} />
                        </span>
                        <Badge variant="neutral" size="lg" className="font-bold">
                          {item.xpCost} XP
                        </Badge>
                      </div>

                      <h3 className="mb-2 font-display text-lg font-bold text-ink-strong">
                        {item.nameUz}
                      </h3>
                      <p className="min-h-[40px] text-sm text-ink-soft">{item.description}</p>
                    </div>

                    <div className="mt-8">
                      <Button
                        fullWidth
                        variant={isAffordable ? 'primary' : 'secondary'}
                        disabled={!isAffordable || isPurchasing}
                        loading={isPurchasing}
                        onClick={() => purchaseMutation.mutate(item.id)}
                        {...(!isAffordable && !isPurchasing
                          ? { leftIcon: <Lock className="h-4 w-4" /> }
                          : {})}
                      >
                        {isPurchasing
                          ? undefined
                          : isAffordable
                            ? 'Sotib olish'
                            : `Yana ${item.xpCost - currentXp} XP kerak`}
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
