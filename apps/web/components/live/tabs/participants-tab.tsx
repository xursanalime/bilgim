'use client';

import { Mic, MicOff, Video, VideoOff, Hand, MoreVertical, X } from 'lucide-react';
import { type Participant } from '../../../hooks/use-classroom';
import { cn } from '../../../lib/utils';

interface ParticipantsTabProps {
  participants: Participant[];
  onKick: (socketId: string) => void;
  isTeacher: boolean;
}

export function ParticipantsTab({ participants, onKick, isTeacher }: ParticipantsTabProps) {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {participants.map((p) => (
          <div key={p.socketId} className="group flex items-center justify-between gap-3 p-3 rounded-2xl bg-tint/50 border border-rim hover:bg-tint transition-all">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue/10 text-blue text-sm font-black shadow-sm">
                {p.name.charAt(0).toUpperCase()}
                {p.isHandRaised && (
                  <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white shadow-sm animate-bounce">
                    <Hand className="h-2.5 w-2.5 fill-current" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-ink-strong">{p.name}</p>
                <p className="truncate text-[9px] font-black uppercase tracking-widest text-ink-faint">
                  {p.role === 'TEACHER' ? "O'qituvchi" : 'Talaba'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <div className={cn("p-1.5 rounded-lg", p.isMicOn ? "text-green" : "text-red bg-red/5")}>
                {p.isMicOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              </div>
              <div className={cn("p-1.5 rounded-lg", p.isCamOn ? "text-green" : "text-red bg-red/5")}>
                {p.isCamOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
              </div>
              
              {isTeacher && p.role !== 'TEACHER' && (
                <button
                  onClick={() => onKick(p.socketId)}
                  className="p-1.5 rounded-lg text-ink-faint hover:bg-red/10 hover:text-red transition-all opacity-0 group-hover:opacity-100"
                  title="Darsdan chetlatish"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      
      <div className="p-4 border-t border-rim bg-tint/20">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-faint text-center">
          Jami: {participants.length} ishtirokchi
        </p>
      </div>
    </div>
  );
}
