'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Volume2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface ListeningQuestion {
  id: string;
  prompt: string;
  kind: 'mcq' | 'short' | 'true_false';
  choices?: string[];
  answer?: string | string[];
}

export interface ListeningRuntimeConfig {
  audioUrl: string;
  transcript?: string;
  questions: ListeningQuestion[];
  allowTranscript?: boolean;
  listenCount?: number; // max times student can play
}

export interface ListeningRuntimeAnswer {
  responses: Record<string, { value: string | string[] }>;
  playCount: number;
}

interface Props {
  config: ListeningRuntimeConfig;
  initialAnswer: ListeningRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: ListeningRuntimeAnswer) => void;
}

export function ListeningRuntime({ config, initialAnswer, editable, onChange }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playCount, setPlayCount] = useState(initialAnswer?.playCount ?? 0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [responses, setResponses] = useState<Record<string, { value: string | string[] }>>(
    initialAnswer?.responses ?? {}
  );

  const maxPlays = config.listenCount ?? 999;
  const canPlay = editable ? playCount < maxPlays : true;

  useEffect(() => {
    onChange({ responses, playCount });
  }, [responses, playCount]); // eslint-disable-line

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      if (!canPlay) return;
      audio.play();
      if (!playing) {
        setPlayCount((p) => {
          const next = p + 1;
          return next;
        });
      }
    }
  };

  const restart = () => {
    const audio = audioRef.current;
    if (!audio || !canPlay) return;
    audio.currentTime = 0;
    audio.play();
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const setSingle = (qid: string, value: string) =>
    setResponses((p) => ({ ...p, [qid]: { value } }));

  const toggleMulti = (qid: string, choice: string) =>
    setResponses((p) => {
      const existing = p[qid]?.value;
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      const next = list.includes(choice) ? list.filter((c) => c !== choice) : [...list, choice];
      return { ...p, [qid]: { value: next } };
    });

  return (
    <div className="space-y-6">
      {/* Audio player */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#13131f] p-6">
        <audio
          ref={audioRef}
          src={config.audioUrl}
          onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
          onDurationChange={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              disabled={!canPlay && !playing}
              className={cn(
                'h-12 w-12 rounded-2xl flex items-center justify-center transition-all',
                canPlay || playing
                  ? 'bg-blue text-white hover:bg-blue/90 shadow-lg shadow-blue/25'
                  : 'bg-white/[0.05] text-white/20 cursor-not-allowed'
              )}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </button>
            <button
              onClick={restart}
              disabled={!canPlay}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.05] transition-all disabled:cursor-not-allowed disabled:opacity-30"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-1.5">
            <input
              type="range"
              min={0}
              max={duration || 1}
              value={currentTime}
              onChange={(e) => {
                const t = Number(e.target.value);
                if (audioRef.current) audioRef.current.currentTime = t;
                setCurrentTime(t);
              }}
              className="w-full h-1.5 accent-blue cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-white/30">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <Volume2 className="h-4 w-4 text-white/30 shrink-0" />
        </div>

        {/* Play count indicator */}
        {config.listenCount && editable && (
          <p className="mt-3 text-[11px] text-white/30 text-center">
            {playCount}/{maxPlays} marta tingladingiz
          </p>
        )}

        {/* Transcript toggle */}
        {config.transcript && config.allowTranscript && (
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="mt-4 w-full flex items-center justify-center gap-2 text-xs font-bold text-white/40 hover:text-white/60 transition-colors"
          >
            {showTranscript ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showTranscript ? "Transkripsiyani yashirish" : "Transkripsiyani ko'rish"}
          </button>
        )}

        {showTranscript && config.transcript && (
          <div className="mt-3 rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
            {config.transcript}
          </div>
        )}
      </div>

      {/* Questions */}
      {config.questions.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-white/30">Savollar</p>
          {config.questions.map((q, idx) => {
            const response = responses[q.id];
            const value = response?.value;
            const isMulti = q.kind === 'mcq' && Array.isArray(q.answer);

            return (
              <div key={q.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-sm font-semibold text-cream mb-3">
                  <span className="font-mono text-[11px] text-cream-dim mr-2">{idx + 1}.</span>
                  {q.prompt}
                </p>

                <div className="space-y-2">
                  {q.kind === 'mcq' && q.choices?.map((choice) => {
                    const checked = isMulti
                      ? Array.isArray(value) && value.includes(choice)
                      : value === choice;
                    return (
                      <label key={choice} className={cn(
                        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm cursor-pointer transition-colors',
                        checked
                          ? 'border-blue/40 bg-blue/10 text-white'
                          : 'border-white/[0.05] bg-white/[0.02] text-white/60 hover:border-white/[0.12] hover:text-white',
                        !editable && 'cursor-not-allowed opacity-70'
                      )}>
                        <input
                          type={isMulti ? 'checkbox' : 'radio'}
                          checked={checked}
                          disabled={!editable}
                          onChange={() => isMulti ? toggleMulti(q.id, choice) : setSingle(q.id, choice)}
                          className="h-4 w-4 accent-blue"
                        />
                        {choice}
                      </label>
                    );
                  })}

                  {q.kind === 'true_false' && ['true', 'false'].map((c) => (
                    <label key={c} className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold cursor-pointer transition-colors',
                      value === c ? 'border-blue/40 bg-blue/10 text-white' : 'border-white/[0.05] text-white/60 hover:border-white/[0.12]',
                      !editable && 'cursor-not-allowed opacity-70'
                    )}>
                      <input type="radio" checked={value === c} disabled={!editable}
                        onChange={() => setSingle(q.id, c)} className="sr-only" />
                      {c === 'true' ? "To'g'ri" : "Noto'g'ri"}
                    </label>
                  ))}

                  {q.kind === 'short' && (
                    <input
                      type="text"
                      value={typeof value === 'string' ? value : ''}
                      disabled={!editable}
                      onChange={(e) => setSingle(q.id, e.target.value)}
                      placeholder="Javobingizni yozing..."
                      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue/40"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
