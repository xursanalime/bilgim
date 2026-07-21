'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Target, CheckCircle2, Trophy, ChevronDown, ChevronUp, X, PartyPopper } from 'lucide-react';
import { gamificationApi } from '../../lib/api/gamification';
import { cn } from '../../lib/utils';
import confetti from 'canvas-confetti';

export function DailyChallengesWidget() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ['gamification', 'challenges', 'today'],
    queryFn: () => gamificationApi.getTodayChallenges(),
  });

  const allCompleted = challenges.length > 0 && challenges.every(c => c.progress.completed);

  useEffect(() => {
    if (allCompleted) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#34C759', '#0071E3', '#FF9F0A']
      });
    }
  }, [allCompleted]);

  if (isLoading || !isVisible || challenges.length === 0) {
    return isLoading ? (
      <div className="h-12 w-full animate-pulse rounded-3xl border border-rim bg-canvas shadow-soft" />
    ) : null;
  }

  return (
    <div className="rounded-3xl border border-rim bg-canvas shadow-soft transition-all duration-300">
      {/* Compact Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl",
            allCompleted ? "bg-green-tint text-green" : "bg-blue-tint text-blue"
          )}>
            {allCompleted ? <Trophy className="h-4 w-4" /> : <Target className="h-4 w-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-strong">
                {allCompleted ? "Kunlik maqsadlar bajarildi!" : "Bugungi maqsadlar"}
              </span>
              {allCompleted && <PartyPopper className="h-3.5 w-3.5 text-green" />}
              {!allCompleted && (
                <span className="text-[11px] font-medium text-ink-soft">
                  {challenges.filter(c => c.progress.completed).length}/{challenges.length}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-blue transition-colors hover:bg-blue-tint"
          >
            {isExpanded ? "Yig'ish" : "Barchasini ko'rish"}
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-tint hover:text-ink-soft"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="border-t border-rim px-5 py-3">
        <div className={cn(
          "grid gap-3 transition-all",
          isExpanded ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
        )}>
          {/* If collapsed, show only first 2 incomplete or just first 2 */}
          {(isExpanded ? challenges : challenges.slice(0, 2)).map((challenge) => {
            const { currentCount, completed } = challenge.progress;
            const percent = Math.min(100, (currentCount / challenge.targetCount) * 100);

            return (
              <div
                key={challenge.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5 transition-all duration-300",
                  completed
                    ? "border-green/15 bg-green-tint/50"
                    : "border-rim bg-tint hover:border-blue/15"
                )}
              >
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                  <svg className="h-full w-full rotate-[-90deg]" viewBox="0 0 36 36">
                    <circle
                      cx="18" cy="18" r="16" fill="none"
                      stroke="currentColor" strokeWidth="3"
                      className="text-soft"
                    />
                    <motion.circle
                      cx="18" cy="18" r="16" fill="none"
                      stroke="currentColor" strokeWidth="3"
                      strokeDasharray="100, 100"
                      initial={{ strokeDashoffset: 100 }}
                      animate={{ strokeDashoffset: 100 - percent }}
                      transition={{ duration: 1, ease: "easeOut" }}
                      strokeLinecap="round"
                      className={completed ? "text-green" : "text-blue"}
                      style={{ pathLength: percent / 100 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    {completed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green" />
                    ) : (
                      <span className="text-[9px] font-black text-blue">{currentCount}</span>
                    )}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className={cn(
                      "truncate text-xs font-bold",
                      completed ? "text-green opacity-80" : "text-ink"
                    )}>
                      {challenge.nameUz}
                    </h4>
                    <span className="shrink-0 text-[10px] font-black text-blue">
                      +{challenge.xpReward} XP
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
