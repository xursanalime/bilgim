'use client';

import { useState, useEffect } from 'react';
import { Users, MoreHorizontal, Info, Hand, Signal } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useConnectionQualityIndicator, useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality } from 'livekit-client';
import { cn } from '../../lib/utils';

interface LiveTopBarProps {
  title: string;
  teacherName: string;
  viewerCount: number;
  isRecording: boolean;
  startedAt?: string | null;
  raisedHandCount?: number;
  onShowInfo?: () => void;
}

export function LiveTopBar({
  title, teacherName, viewerCount, isRecording,
  startedAt, raisedHandCount = 0, onShowInfo,
}: LiveTopBarProps) {
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const reduceMotion = useReducedMotion();

  // Only treat the timer as running when we have a valid, parseable
  // start time. A null/invalid `startedAt` renders a static "00:00"
  // instead of a misleading elapsed value.
  const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const hasStarted = Number.isFinite(startMs);
  const timerLabel = hasStarted ? elapsedTime : '00:00';

  useEffect(() => {
    if (!hasStarted) {
      setElapsedTime('00:00');
      return;
    }
    const update = () => {
      // Clamp negatives so clock skew / a future `startedAt` reads 00:00.
      const diff = Math.max(0, Date.now() - startMs);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsedTime(
        h > 0
          ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [hasStarted, startMs]);

  const qualityLabel =
    quality === ConnectionQuality.Excellent ? "A'lo"
    : quality === ConnectionQuality.Good ? 'Yaxshi'
    : quality === ConnectionQuality.Poor ? "Zaif"
    : '...';

  const qualityColor =
    quality === ConnectionQuality.Excellent ? 'text-green'
    : quality === ConnectionQuality.Good ? 'text-blue'
    : quality === ConnectionQuality.Poor ? 'text-red'
    : 'text-ink-faint';

  return (
    <div className="absolute top-0 left-0 right-0 z-50 px-3 py-2 pointer-events-none">
      <div className="flex items-center justify-between gap-3 h-[56px]">

        {/* Left: title */}
        <div className="pointer-events-auto flex items-center gap-3 bg-canvas border border-rim px-5 py-3 rounded-3xl shadow-medium max-w-xs">
          <div className="h-9 w-9 shrink-0 rounded-2xl bg-gradient-to-br from-blue to-indigo-600 flex items-center justify-center shadow-lg shadow-blue/20">
            <Info className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black text-ink-strong leading-none mb-0.5 truncate">{title}</h1>
            <p className="text-[10px] text-ink-soft font-bold uppercase tracking-[0.12em] truncate">{teacherName}</p>
          </div>
        </div>

        {/* Center: LIVE badge + timer */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
          <div
            role="status"
            aria-label={`Jonli efir, dars davomiyligi ${timerLabel}`}
            className="flex items-center gap-3 bg-canvas border border-rim px-4 py-2 rounded-full shadow-medium"
          >
            <div className="relative flex h-2 w-2" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green shadow-[0_0_8px_rgba(52,199,89,1)]" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-strong">Jonli</span>
            <div className="h-3 w-px bg-rim" />
            <span
              className="text-[11px] font-mono font-bold text-ink-strong tabular-nums"
              aria-label="dars davomiyligi"
            >
              {timerLabel}
            </span>
          </div>
        </div>

        {/* Right: stats */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-4 bg-canvas border border-rim px-4 py-3 rounded-3xl shadow-medium">
            {/* Participants */}
            <div className="flex items-center gap-2" aria-label={`${viewerCount} ishtirokchi`}>
              <div className="p-1.5 bg-tint rounded-lg" aria-hidden="true">
                <Users className="h-3.5 w-3.5 text-ink-soft" />
              </div>
              <span className="text-xs font-black text-ink-strong">{viewerCount}</span>
            </div>

            {/* Raised hands */}
            {raisedHandCount > 0 && (
              <>
                <div className="h-4 w-px bg-rim" aria-hidden="true" />
                <motion.div
                  className="flex items-center gap-2"
                  aria-label={`${raisedHandCount} qo'l ko'tarilgan`}
                  initial={reduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <div className="p-1.5 bg-orange/10 rounded-lg" aria-hidden="true">
                    <Hand className="h-3.5 w-3.5 text-orange" />
                  </div>
                  <span className="text-xs font-black text-orange">{raisedHandCount}</span>
                </motion.div>
              </>
            )}

            <div className="h-4 w-px bg-rim" aria-hidden="true" />

            {/* Network quality */}
            <div className="flex items-center gap-2" role="status" aria-label={`Aloqa sifati: ${qualityLabel}`}>
              <div className={cn('p-1.5 rounded-lg', quality === ConnectionQuality.Poor ? 'bg-red/10' : 'bg-tint')} aria-hidden="true">
                <Signal className={cn('h-3.5 w-3.5', qualityColor)} />
              </div>
              <span className={cn('text-[10px] font-bold uppercase tracking-widest', qualityColor)}>
                {qualityLabel}
              </span>
            </div>
          </div>

          {isRecording && (
            <div
              role="status"
              aria-label="Dars yozib olinmoqda"
              className="flex items-center gap-2 bg-red/10 border border-red/20 px-3 py-2 rounded-2xl"
            >
              <div className="h-2 w-2 rounded-full bg-red animate-pulse" aria-hidden="true" />
              <span className="text-[10px] font-black text-red uppercase tracking-wider">REC</span>
            </div>
          )}

          <button
            type="button"
            aria-label="Qo'shimcha"
            onClick={onShowInfo}
            className="h-11 w-11 bg-canvas border border-rim rounded-[1.25rem] flex items-center justify-center text-ink-soft outline-none hover:text-ink-strong hover:bg-tint focus-visible:ring-2 focus-visible:ring-blue transition-all shadow-medium"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
