'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

import { cn } from '../../lib/utils';

// ═════════════════════════════════════════════════════════════════
// TrialCountdown — live "time left in trial" indicator (Req 13.1).
//
// Recomputes once a minute on the client. Renders nothing meaningful
// past the deadline (shows 0). Pure presentational + a timer; the
// parent decides whether a trial is active before mounting this.
// ═════════════════════════════════════════════════════════════════

interface Remaining {
  total: number;
  days: number;
  hours: number;
  minutes: number;
}

function computeRemaining(endsAt: string): Remaining {
  const total = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const days = Math.floor(total / (24 * 60 * 60 * 1000));
  const hours = Math.floor((total % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((total % (60 * 60 * 1000)) / (60 * 1000));
  return { total, days, hours, minutes };
}

export interface TrialCountdownProps {
  /** ISO timestamp the trial ends at. */
  endsAt: string;
  className?: string;
}

export function TrialCountdown({ endsAt, className }: TrialCountdownProps) {
  // Seed null so SSR and the first client render match; fill in on mount.
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    setRemaining(computeRemaining(endsAt));
    const id = setInterval(() => {
      setRemaining(computeRemaining(endsAt));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const expired = remaining !== null && remaining.total <= 0;

  const segments: Array<{ value: number; label: string }> = remaining
    ? [
        { value: remaining.days, label: 'kun' },
        { value: remaining.hours, label: 'soat' },
        { value: remaining.minutes, label: 'daqiqa' },
      ]
    : [];

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-blue/15 bg-blue/5 p-4',
        className,
      )}
      role="timer"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue">
        <Clock className="h-4 w-4" aria-hidden="true" />
        <span>
          {expired ? 'Sinov muddati tugadi' : 'Sinov muddati tugashiga'}
        </span>
      </div>

      {remaining === null ? (
        <div className="h-9 w-40 animate-pulse rounded-lg bg-blue/10" aria-hidden="true" />
      ) : expired ? (
        <p className="text-sm font-semibold text-ink-soft">
          Davom etish uchun tarifni tanlang.
        </p>
      ) : (
        <div className="flex items-end gap-3">
          {segments.map((seg) => (
            <div key={seg.label} className="flex flex-col items-center">
              <span className="font-display text-2xl font-extrabold tabular-nums text-ink-strong sm:text-3xl">
                {seg.value}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                {seg.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
