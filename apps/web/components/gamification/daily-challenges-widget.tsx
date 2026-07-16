'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import {
  Target,
  CheckCircle2,
  Trophy,
  ChevronDown,
  ChevronUp,
  PartyPopper,
} from 'lucide-react';
import { gamificationApi } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';
import { tokens } from '../../lib/design/tokens';

// ═════════════════════════════════════════════════════════════════
// DailyChallengesWidget — compact daily-challenge tracker for the
// dashboard. Restyled to the design system (semantic tokens) and
// localized in Uzbek. Reduced-motion users get no confetti burst.
// (Requirements 12.4, 12.5)
// ═════════════════════════════════════════════════════════════════

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DailyChallengesWidget() {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ['gamification', 'challenges', 'today'],
    queryFn: () => gamificationApi.getTodayChallenges(),
  });

  const completedCount = challenges.filter((c) => c.progress.completed).length;
  const allCompleted = challenges.length > 0 && completedCount === challenges.length;

  useEffect(() => {
    if (allCompleted && !prefersReducedMotion()) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: [tokens.semantic.success, tokens.brand.primary, tokens.semantic.warn],
      });
    }
  }, [allCompleted]);

  if (isLoading) {
    return (
      <div className="h-full min-h-[160px] w-full animate-pulse rounded-3xl border border-rim bg-canvas" />
    );
  }

  if (challenges.length === 0) return null;

  const visibleChallenges = isExpanded ? challenges : challenges.slice(0, 3);

  return (
    <section
      aria-label="Bugungi maqsadlar"
      className="h-full overflow-hidden rounded-3xl border border-rim bg-canvas shadow-soft transition-all duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl',
              allCompleted ? 'bg-green-tint text-green' : 'bg-blue-tint text-blue',
            )}
            aria-hidden="true"
          >
            {allCompleted ? <Trophy className="h-4 w-4" /> : <Target className="h-4 w-4" />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ink-strong">
              {allCompleted ? 'Kunlik maqsadlar bajarildi!' : 'Bugungi maqsadlar'}
            </span>
            {allCompleted ? (
              <PartyPopper className="h-3.5 w-3.5 text-green" aria-hidden="true" />
            ) : (
              <span className="text-[11px] font-semibold text-ink-faint">
                {completedCount}/{challenges.length}
              </span>
            )}
          </div>
        </div>

        {challenges.length > 3 && (
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-blue outline-none transition-colors hover:bg-blue-tint focus-visible:ring-2 focus-visible:ring-blue"
          >
            {isExpanded ? "Yig'ish" : "Barchasini ko'rish"}
            {isExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="border-t border-rim px-5 py-4">
        <ul
          className={cn(
            'grid gap-3 transition-all',
            isExpanded ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
          )}
        >
          {visibleChallenges.map((challenge) => {
            const { currentCount, completed } = challenge.progress;
            const percent = Math.min(
              100,
              challenge.targetCount > 0 ? (currentCount / challenge.targetCount) * 100 : 0,
            );

            return (
              <li
                key={challenge.id}
                className={cn(
                  'flex items-center gap-3 rounded-2xl border p-2.5 transition-all duration-300',
                  completed
                    ? 'border-green/20 bg-green-tint/50'
                    : 'border-rim bg-tint hover:border-blue/30',
                )}
              >
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                  <svg className="h-full w-full rotate-[-90deg]" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="text-soft"
                    />
                    <motion.circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray="100, 100"
                      initial={{ strokeDashoffset: 100 }}
                      animate={{ strokeDashoffset: 100 - percent }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                      strokeLinecap="round"
                      className={completed ? 'text-green' : 'text-blue'}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {completed ? (
                      <CheckCircle2 className="h-4 w-4 text-green" aria-hidden="true" />
                    ) : (
                      <span className="text-[9px] font-black text-blue">{currentCount}</span>
                    )}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4
                      className={cn(
                        'truncate text-xs font-bold',
                        completed ? 'text-green' : 'text-ink-strong',
                      )}
                    >
                      {challenge.nameUz}
                    </h4>
                    <span className="shrink-0 text-[10px] font-black text-blue">
                      +{challenge.xpReward} XP
                    </span>
                  </div>
                  {!isExpanded ? null : (
                    <p className="mt-0.5 truncate text-[10px] text-ink-soft">
                      {challenge.description}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
