'use client';

// ═════════════════════════════════════════════════════════════════
// LevelUpToast — celebratory, non-disruptive affirmation shown when a
// Learner crosses into a new gamification level (Requirement 12.2).
//
// It piggybacks on the shared ['gamification','profile'] query (already
// polled by the XP indicator + XpGain toast provider), so it adds no
// extra network traffic. When `profile.currentLevel` increases beyond
// the baseline captured on mount, a single affirmation is enqueued.
//
// Accessibility / motion:
//   - The banner is a polite `role="status"` live region so screen
//     readers announce the level-up without stealing focus.
//   - All entrance/exit/sparkle motion is gated behind
//     `prefers-reduced-motion`. Under reduced motion the banner simply
//     appears and disappears with no transform/scale/opacity animation.
//   - The dismiss button is a real <button> with an accessible label.
// ═════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { PartyPopper, Sparkles, X } from 'lucide-react';

import { gamificationApi } from '../../lib/api/gamification';
import { getLevelProgress } from '../../lib/gamification-constants';
import { cn } from '../../lib/utils';

const AUTO_DISMISS_MS = 6000;

interface LevelUpToastProps {
  /** Only Learners (students) accrue the gamification profile we watch. */
  role?: string;
  /** Locale for the "view achievements" deep link. */
  locale?: string;
}

interface LevelUpState {
  id: string;
  level: number;
  levelName: string;
  color: string;
}

/** Reactively track the reduced-motion preference (SSR-safe). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Safari < 14 fallback.
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);
  return reduced;
}

export function LevelUpToast({ role, locale }: LevelUpToastProps) {
  const isLearner = role === 'STUDENT';
  const reducedMotion = usePrefersReducedMotion();
  const [celebration, setCelebration] = useState<LevelUpState | null>(null);
  const previousLevelRef = useRef<number | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['gamification', 'profile'],
    queryFn: () => gamificationApi.getProfile(),
    refetchInterval: 15000,
    enabled: isLearner,
  });

  // Detect level transitions. The first observed value is treated as the
  // baseline so we never fire on initial load / page refresh.
  useEffect(() => {
    if (!profile) return;

    const progress = getLevelProgress(profile.totalXp, profile.role);
    const level = progress.currentLevel;

    if (previousLevelRef.current === null) {
      previousLevelRef.current = level;
      return;
    }

    if (level > previousLevelRef.current) {
      setCelebration({
        id: `levelup-${level}-${Date.now()}`,
        level,
        levelName: progress.levelName,
        color: progress.color,
      });
    }

    previousLevelRef.current = level;
  }, [profile?.totalXp, profile?.role]);

  // Auto-dismiss the affirmation.
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [celebration]);

  if (!isLearner || !celebration) return null;

  const card = (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-[min(92vw,26rem)] items-center gap-4 rounded-2xl border border-rim bg-canvas px-5 py-4 shadow-large"
    >
      <div
        className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black text-white shadow-inner"
        style={{ backgroundColor: celebration.color }}
      >
        {celebration.level}
        {!reducedMotion && (
          <motion.span
            aria-hidden
            data-testid="levelup-sparkle"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 0], scale: [0.6, 1.1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -right-1 -top-1 text-yellow-300"
          >
            <Sparkles className="h-4 w-4" />
          </motion.span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-soft">
          <PartyPopper className="h-3.5 w-3.5 text-blue" aria-hidden />
          Yangi daraja!
        </p>
        <p className="truncate font-display text-base font-black text-ink-strong">
          {celebration.levelName}
        </p>
        <p className="text-xs font-medium text-ink-soft">
          {locale ? (
            <a
              href={`/${locale}/achievements`}
              className="font-bold text-blue underline-offset-2 hover:underline"
            >
              Yutuqlarni ko&apos;rish
            </a>
          ) : (
            <span>Tabriklaymiz!</span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCelebration(null)}
        aria-label="Yopish"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-tint hover:text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div
      className={cn(
        'fixed inset-x-0 top-4 z-[60] flex justify-center px-4',
        'sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:px-0',
      )}
    >
      {reducedMotion ? (
        // Reduced motion: appear/disappear with no transform or fade.
        card
      ) : (
        <AnimatePresence>
          <motion.div
            key={celebration.id}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            {card}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
