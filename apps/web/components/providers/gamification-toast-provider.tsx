'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Flame } from 'lucide-react';
import { gamificationApi } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';

interface ToastMessage {
  id: string;
  amount: number;
  reason: string;
  type?: 'xp' | 'streak';
}

export function GamificationToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const previousXpRef = useRef<number | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
    refetchInterval: 15000, // Poll every 15s to catch backend changes
  });

  useEffect(() => {
    if (!profile) return;

    // First load
    if (previousXpRef.current === null) {
      previousXpRef.current = profile.totalXp;
      
      // Check for first login streak message (Phase 6 requirement)
      const hasSeenStreak = sessionStorage.getItem('hasSeenStreakToday');
      if (!hasSeenStreak && profile.currentStreak > 0) {
        setToasts(prev => [...prev, {
          id: `streak-${Date.now()}`,
          amount: 0,
          reason: `${profile.currentStreak} kunlik streak davom etmoqda!`,
          type: 'streak'
        }]);
        sessionStorage.setItem('hasSeenStreakToday', 'true');
      }
      return;
    }


    // XP increased
    if (profile.totalXp > previousXpRef.current) {
      const diff = profile.totalXp - previousXpRef.current;
      
      // Get the latest history event to show reason
      const latestEvent = profile.xpHistory?.[0];
      const reasonText = latestEvent ? (REASON_MAP[latestEvent.reason] || latestEvent.reason) : 'Ajoyib natija';

      setToasts(prev => [...prev, {
        id: `xp-${Date.now()}`,
        amount: diff,
        reason: `${reasonText}`
      }]);

      previousXpRef.current = profile.totalXp;
    } else if (profile.totalXp < previousXpRef.current) {
       // XP decreased (e.g., spent in shop), just update ref, don't show toast
       previousXpRef.current = profile.totalXp;
    }
  }, [profile?.totalXp, profile?.currentStreak]);

  // Remove toasts after 4 seconds
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(1));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  return (
    <>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className="flex items-center gap-4 rounded-2xl bg-tint-strong px-5 py-3.5 text-white shadow-xl pointer-events-auto"
            >
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-inner",
                toast.type === 'streak' ? "bg-orange" : "bg-blue"
              )}>
                {toast.type === 'streak' ? (
                  <Flame className="h-5 w-5 fill-white/20" />
                ) : (
                  <Star className="h-5 w-5 fill-white/20" />
                )}
              </div>
              <div className="flex flex-col">
                <p className="text-sm font-bold leading-tight">
                  {toast.reason}
                </p>
                {toast.amount > 0 && (
                  <p className="font-display text-base font-black text-blue mt-0.5">
                    +{toast.amount} XP
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

const REASON_MAP: Record<string, string> = {
  'homework_submitted': 'Uy vazifasi topshirildi',
  'live_attended': 'Jonli darsda qatnashildi',
  'badge_earned': 'Yangi yutuq!',
  'challenge_completed': 'Vazifa bajarildi',
  'first_login': 'Tizimga kirish',
  'ai_tutor_used': 'AI yordamchi ishlatildi',
  'lesson_viewed': 'Dars ko\'rildi',
  'homework_graded': 'Uy vazifasi baholandi',
  'streak_milestone': 'Ketma-ketlik marrasi',
};
