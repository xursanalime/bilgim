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
    : quality === ConnectionQuality.Good ? 'text-yellow-400'
    : quality === ConnectionQuality.Poor ? 'text-red'
    : 'text-white/30';

  return (
    <div className="absolute top-0 left-0 right-0 z-50 px-3 py-2 pointer-events-none">
      <div className="flex items-center justify-between gap-3 h-[56px]">

        {/* Left: title */}
        <div className="pointer-events-auto flex items-center gap-3 bg-black/30 backdrop-blur-2xl border border-white/5 px-5 py-3 rounded-3xl shadow-2xl max-w-xs">
          <div className="h-9 w-9 shrink-0 rounded-2xl bg-gradient-to-br from-blue to-indigo-600 flex items-center justify-center shadow-lg shadow-blue/20">
            <Info className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-black text-white leading-none mb-0.5 truncate">{title}</h1>
            <p className="text-[10px] text-white/40 font-bold uppercase tracking-[0.12em] truncate">{teacherName}</p>
          </div>
        </div>

        {/* Center: LIVE badge + timer */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-auto">
          <div className="flex items-center gap-3 bg-black/30 backdrop-blur-2xl border border-white/5 px-4 py-2 rounded-full shadow-2xl">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red shadow-[0_0_8px_rgba(255,59,48,1)]" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Jonli</span>
            <div className="h-3 w-px bg-white/10" />
            <span className="text-[11px] font-mono font-bold text-white/90 tabular-nums">{elapsedTime}</span>
          </div>
        </div>

        {/* Right: stats */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="flex items-center gap-4 bg-black/30 backdrop-blur-2xl border border-white/5 px-4 py-3 rounded-3xl shadow-2xl">
            {/* Participants */}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-white/5 rounded-lg">
                <Users className="h-3.5 w-3.5 text-white/60" />
              </div>
              <span className="text-xs font-black text-white">{viewerCount}</span>
            </div>

            {/* Raised hands */}
            {raisedHandCount > 0 && (
              <>
                <div className="h-4 w-px bg-white/5" />
                <motion.div
                  className="flex items-center gap-2"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <div className="p-1.5 bg-yellow-400/10 rounded-lg">
                    <Hand className="h-3.5 w-3.5 text-yellow-400" />
                  </div>
                  <span className="text-xs font-black text-yellow-400">{raisedHandCount}</span>
                </motion.div>
              </>
            )}

            <div className="h-4 w-px bg-white/5" />

            {/* Network quality */}
            <div className="flex items-center gap-2">
              <div className={cn('p-1.5 rounded-lg', quality === ConnectionQuality.Poor ? 'bg-red/10' : 'bg-white/5')}>
                <Signal className={cn('h-3.5 w-3.5', qualityColor)} />
              </div>
              <span className={cn('text-[10px] font-bold uppercase tracking-widest', qualityColor)}>
                {qualityLabel}
              </span>
            </div>
          </div>

          {isRecording && (
            <div className="flex items-center gap-2 bg-red/10 border border-red/20 px-3 py-2 rounded-2xl">
              <div className="h-2 w-2 rounded-full bg-red animate-pulse" />
              <span className="text-[10px] font-black text-red uppercase tracking-wider">REC</span>
            </div>
          )}

          <button className="h-11 w-11 bg-black/30 backdrop-blur-2xl border border-white/5 rounded-[1.25rem] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all shadow-2xl">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
