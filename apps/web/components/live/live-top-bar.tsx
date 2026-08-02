'use client';

import { useState, useEffect } from 'react';
import { Users, MoreHorizontal, Info, Hand, Signal } from 'lucide-react';
import { motion } from 'framer-motion';
import { useConnectionQualityIndicator, useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality } from 'livekit-client';
import { cn } from '../../lib/utils';

interface LiveTopBarProps {
  title: string;
  teacherName: string;
  viewerCount: number;
  isRecording: boolean;
  startedAt?: string | null;
  /** True while the session is `SCHEDULED` — teacher hasn't started yet, students are waiting. */
  isWaiting?: boolean;
  raisedHandCount?: number;
  onShowInfo?: () => void;
}

export function LiveTopBar({
  title, teacherName, viewerCount, isRecording,
  startedAt, isWaiting = false, raisedHandCount = 0, onShowInfo,
}: LiveTopBarProps) {
  const [elapsedTime, setElapsedTime] = useState('00:00');
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });

  useEffect(() => {
    if (!startedAt) return;
    const startMs = new Date(startedAt).getTime();
    const update = () => {
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
  }, [startedAt]);

  const qualityLabel =
    quality === ConnectionQuality.Excellent ? "A'lo"
    : quality === ConnectionQuality.Good ? 'Yaxshi'
    : quality === ConnectionQuality.Poor ? "Zaif"
    : '...';

  const qualityColor =
    quality === ConnectionQuality.Excellent ? 'text-teal'
    : quality === ConnectionQuality.Good ? 'text-orange'
    : quality === ConnectionQuality.Poor ? 'text-red'
    : 'text-ink-faint';

  return (
    <div className="absolute top-0 left-0 right-0 z-50 px-2 sm:px-3 py-2 pointer-events-none">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:h-[56px] sm:flex-nowrap">

        {/* Left: title */}
        <div className="pointer-events-auto order-1 flex min-w-0 max-w-[55vw] items-center gap-2 rounded-2xl border border-rim bg-white px-3 py-2 shadow-soft sm:max-w-xs sm:gap-3 sm:rounded-3xl sm:px-5 sm:py-3">
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)] sm:flex">
            <Info className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-black text-ink-strong leading-none mb-0.5 truncate sm:text-sm">{title}</h1>
            <p className="hidden truncate text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft sm:block">{teacherName}</p>
          </div>
        </div>

        {/* Center: LIVE/waiting badge + timer */}
        <div className="pointer-events-auto order-3 w-full sm:absolute sm:left-1/2 sm:order-none sm:w-auto sm:-translate-x-1/2">
          <div className="flex w-fit items-center gap-2 rounded-full border border-rim bg-white px-3 py-1.5 shadow-soft mx-auto sm:mx-0 sm:gap-3 sm:px-4 sm:py-2">
            {isWaiting ? (
              <>
                <span className="h-2 w-2 rounded-full bg-orange" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange">Kutilmoqda</span>
              </>
            ) : (
              <>
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red shadow-[0_0_8px_rgba(255,59,48,0.6)]" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-strong">Jonli</span>
                <div className="h-3 w-px bg-rim" />
                <span className="text-[11px] font-mono font-bold text-ink-strong tabular-nums">{elapsedTime}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: stats */}
        <div className="pointer-events-auto order-2 flex flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap sm:gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-rim bg-white px-2.5 py-2 shadow-soft sm:gap-4 sm:rounded-3xl sm:px-4 sm:py-3">
            {/* Participants */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="p-1 sm:p-1.5 bg-tint rounded-lg">
                <Users className="h-3.5 w-3.5 text-ink-soft" />
              </div>
              <span className="text-xs font-black text-ink-strong">{viewerCount}</span>
            </div>

            {/* Raised hands */}
            {raisedHandCount > 0 && (
              <>
                <div className="h-4 w-px bg-rim" />
                <motion.div
                  className="flex items-center gap-1.5 sm:gap-2"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <div className="p-1 sm:p-1.5 bg-orange-tint rounded-lg">
                    <Hand className="h-3.5 w-3.5 text-orange" />
                  </div>
                  <span className="text-xs font-black text-orange">{raisedHandCount}</span>
                </motion.div>
              </>
            )}

            <div className="h-4 w-px bg-rim" />

            {/* Network quality */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className={cn('p-1 sm:p-1.5 rounded-lg', quality === ConnectionQuality.Poor ? 'bg-red-tint' : 'bg-tint')}>
                <Signal className={cn('h-3.5 w-3.5', qualityColor)} />
              </div>
              <span className={cn('hidden text-[10px] font-bold uppercase tracking-widest sm:inline', qualityColor)}>
                {qualityLabel}
              </span>
            </div>
          </div>

          {isRecording && (
            <div className="flex items-center gap-1.5 rounded-2xl border border-red/20 bg-red-tint px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
              <div className="h-2 w-2 rounded-full bg-red animate-pulse" />
              <span className="hidden text-[10px] font-black uppercase tracking-wider text-red sm:inline">REC</span>
            </div>
          )}

          <button className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-[1.25rem] border border-rim bg-white text-ink-soft shadow-soft transition-all hover:bg-tint hover:text-ink-strong sm:flex">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
