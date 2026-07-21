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
    quality === ConnectionQuality.Excellent ? 'text-green'
    : quality === ConnectionQuality.Good ? 'text-orange'
    : quality === ConnectionQuality.Poor ? 'text-red'
    : 'text-ink-faint';

  return (
    <div className="absolute top-0 left-0 right-0 z-50 px-3 py-2 pointer-events-none">
      <div className="flex items-center justify-between gap-3 h-[56px]">

        {/* Left: title */}
        <div className="pointer-events-auto flex items-center gap-3 bg-white border border-rim px-5 py-3 rounded-3xl shadow-soft max-w-xs">
          <div className="h-9 w-9 shrink-0 rounded-2xl bg-blue flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(0,113,227,0.4)]">
            <Info className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black text-ink-strong leading-none mb-0.5 truncate">{title}</h1>
            <p className="text-[10px] text-ink-soft font-bold uppercase tracking-[0.12em] truncate">{teacherName}</p>
          </div>
        </div>

        {/* Center: LIVE/waiting badge + timer */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
          <div className="flex items-center gap-3 bg-white border border-rim px-4 py-2 rounded-full shadow-soft">
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
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-4 bg-white border border-rim px-4 py-3 rounded-3xl shadow-soft">
            {/* Participants */}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-tint rounded-lg">
                <Users className="h-3.5 w-3.5 text-ink-soft" />
              </div>
              <span className="text-xs font-black text-ink-strong">{viewerCount}</span>
            </div>

            {/* Raised hands */}
            {raisedHandCount > 0 && (
              <>
                <div className="h-4 w-px bg-rim" />
                <motion.div
                  className="flex items-center gap-2"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <div className="p-1.5 bg-orange-tint rounded-lg">
                    <Hand className="h-3.5 w-3.5 text-orange" />
                  </div>
                  <span className="text-xs font-black text-orange">{raisedHandCount}</span>
                </motion.div>
              </>
            )}

            <div className="h-4 w-px bg-rim" />

            {/* Network quality */}
            <div className="flex items-center gap-2">
              <div className={cn('p-1.5 rounded-lg', quality === ConnectionQuality.Poor ? 'bg-red-tint' : 'bg-tint')}>
                <Signal className={cn('h-3.5 w-3.5', qualityColor)} />
              </div>
              <span className={cn('text-[10px] font-bold uppercase tracking-widest', qualityColor)}>
                {qualityLabel}
              </span>
            </div>
          </div>

          {isRecording && (
            <div className="flex items-center gap-2 bg-red-tint border border-red/20 px-3 py-2 rounded-2xl">
              <div className="h-2 w-2 rounded-full bg-red animate-pulse" />
              <span className="text-[10px] font-black text-red uppercase tracking-wider">REC</span>
            </div>
          )}

          <button className="h-11 w-11 bg-white border border-rim rounded-[1.25rem] flex items-center justify-center text-ink-soft hover:text-ink-strong hover:bg-tint transition-all shadow-soft">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
