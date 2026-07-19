'use client';

import {
  useParticipants,
  useLocalParticipant,
  useConnectionQualityIndicator,
  useRoomContext,
} from '@livekit/components-react';
import { Participant, ConnectionQuality } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Hand, Signal, UserX, VolumeX, MicVocal } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface ParticipantsTabProps {
  raisedHands: Set<string>;
  micGranted: Set<string>;
  isTeacher: boolean;
  onGrantMic: (identity: string, grant: boolean) => void;
}

export function LiveParticipantsTab({ raisedHands, micGranted, isTeacher, onGrantMic }: ParticipantsTabProps) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  const handleKick = (identity: string) => {
    const msg = JSON.stringify({ topic: 'admin', action: 'kick', target: identity });
    room?.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });
  };

  const handleMute = (participant: Participant) => {
    const msg = JSON.stringify({ topic: 'admin', action: 'mute', target: participant.identity });
    room?.localParticipant.publishData(new TextEncoder().encode(msg), { reliable: true });
  };

  const sorted = [...participants].sort((a, b) => {
    const aHand = raisedHands.has(a.identity) ? 1 : 0;
    const bHand = raisedHands.has(b.identity) ? 1 : 0;
    if (bHand !== aHand) return bHand - aHand;
    const aTeach = (a.permissions?.canPublish ?? false) ? 1 : 0;
    const bTeach = (b.permissions?.canPublish ?? false) ? 1 : 0;
    return bTeach - aTeach;
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {raisedHands.size > 0 && (
          <div className="flex items-center gap-2 mb-3 px-2">
            <Hand className="h-3.5 w-3.5 text-yellow-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400">
              {raisedHands.size} qo&apos;l ko&apos;tarilgan
            </span>
          </div>
        )}
        {sorted.map(p => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            isLocal={p.identity === localParticipant?.identity}
            hasHandRaised={raisedHands.has(p.identity)}
            isMicGranted={micGranted.has(p.identity)}
            showActions={isTeacher && p.identity !== localParticipant?.identity}
            onKick={() => handleKick(p.identity)}
            onMute={() => handleMute(p)}
            onGrantMic={() => onGrantMic(p.identity, true)}
            onRevokeMic={() => onGrantMic(p.identity, false)}
          />
        ))}
      </div>
      <div className="p-4 border-t border-white/10 bg-black/20 shrink-0">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 text-center">
          Jami: {participants.length} ishtirokchi
        </p>
      </div>
    </div>
  );
}

function ParticipantRow({
  participant, isLocal, hasHandRaised, isMicGranted, showActions, onKick, onMute, onGrantMic, onRevokeMic,
}: {
  participant: Participant;
  isLocal: boolean;
  hasHandRaised: boolean;
  isMicGranted: boolean;
  showActions: boolean;
  onKick: () => void;
  onMute: () => void;
  onGrantMic: () => void;
  onRevokeMic: () => void;
}) {
  const { quality } = useConnectionQualityIndicator({ participant });
  const isMicOn = participant.isMicrophoneEnabled;
  const isCamOn = participant.isCameraEnabled;
  const isParticipantTeacher = participant.permissions?.canPublish ?? false;

  return (
    <div className={cn(
      'group flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all',
      hasHandRaised
        ? 'bg-yellow-500/10 border-yellow-500/20'
        : 'bg-white/5 border-white/5 hover:bg-white/10'
    )}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black',
          isParticipantTeacher ? 'bg-blue/20 text-blue' : 'bg-white/10 text-white/70',
        )}>
          {participant.name?.charAt(0).toUpperCase() || '?'}
          {participant.isSpeaking && (
            <div className="absolute inset-0 rounded-xl border-2 border-green animate-pulse" />
          )}
          {hasHandRaised && (
            <span className="absolute -top-1.5 -right-1.5 text-xs">✋</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13px] font-bold text-white/90">
              {participant.name || participant.identity}
            </p>
            {isLocal && (
              <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full text-white/40 font-bold">Siz</span>
            )}
          </div>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/30">
            {isParticipantTeacher ? "O'qituvchi" : 'Talaba'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <QualityDot quality={quality} />
        <StatusIcon on={isMicOn} OnIcon={Mic} OffIcon={MicOff} />
        <StatusIcon on={isCamOn} OnIcon={Video} OffIcon={VideoOff} />
        {showActions && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            {/* Mic ruxsat: teacher students uchun mic grant beradi */}
            {!isParticipantTeacher && (
              isMicGranted
                ? <ActionBtn onClick={onRevokeMic} icon={MicVocal} label="Mikrofon ruxsatini olish" color="yellow" active />
                : <ActionBtn onClick={onGrantMic} icon={MicVocal} label="Mikrofon ruxsat berish" color="green" />
            )}
            <ActionBtn onClick={onMute} icon={VolumeX} label="Mikrofonni o'chirish" color="yellow" />
            <ActionBtn onClick={onKick} icon={UserX} label="Chiqarish" color="red" />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ on, OnIcon, OffIcon }: { on: boolean; OnIcon: any; OffIcon: any }) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <div className={cn('p-1.5 rounded-lg', on ? 'text-green/80 bg-green/10' : 'text-red/70 bg-red/10')}>
      <Icon className="h-3 w-3" />
    </div>
  );
}

function QualityDot({ quality }: { quality: ConnectionQuality }) {
  return (
    <div title={`Signal: ${quality}`} className="p-1.5 rounded-lg bg-white/5">
      <Signal className={cn(
        'h-3 w-3',
        quality === ConnectionQuality.Excellent ? 'text-green'
        : quality === ConnectionQuality.Good ? 'text-yellow-400'
        : quality === ConnectionQuality.Poor ? 'text-red'
        : 'text-white/20'
      )} />
    </div>
  );
}

function ActionBtn({ onClick, icon: Icon, label, color, active }: {
  onClick: () => void; icon: any; label: string; color: string; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'p-1.5 rounded-lg transition-all active:scale-90',
        color === 'red'
          ? 'text-red/60 hover:text-red hover:bg-red/10'
          : color === 'green'
            ? 'text-green/60 hover:text-green hover:bg-green/10'
            : active
              ? 'text-yellow-400 bg-yellow-400/10'
              : 'text-yellow-400/60 hover:text-yellow-400 hover:bg-yellow-400/10'
      )}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
