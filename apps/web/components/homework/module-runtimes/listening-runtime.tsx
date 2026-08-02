'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, ChevronDown, ChevronUp, Headphones } from 'lucide-react';
import { cn } from '../../../lib/utils';

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

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
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [responses, setResponses] = useState<Record<string, { value: string | string[] }>>(
    initialAnswer?.responses ?? {}
  );

  const maxPlays = config.listenCount ?? 999;
  const canPlay = editable ? playCount < maxPlays : true;

  useEffect(() => {
    onChange({ responses, playCount });
  }, [responses, playCount]); // eslint-disable-line

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

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
      <div className="rounded-[2rem] border border-rim bg-white p-6 shadow-soft">
        <audio
          ref={audioRef}
          src={config.audioUrl}
          onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
          onDurationChange={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-purple-tint text-purple-600">
            <Headphones className="h-5 w-5" />
          </div>
          <p className="font-display text-sm font-extrabold text-ink-strong">Audio</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              disabled={!canPlay && !playing}
              className={cn(
                'h-12 w-12 rounded-2xl flex items-center justify-center transition-all',
                canPlay || playing
                  ? 'bg-blue text-white hover:bg-blue-400 shadow-[0_8px_20px_-6px_rgba(0,113,227,0.5)]'
                  : 'bg-tint text-ink-faint cursor-not-allowed'
              )}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </button>
            <button
              onClick={restart}
              disabled={!canPlay}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-ink-soft hover:text-ink-strong hover:bg-tint transition-all disabled:cursor-not-allowed disabled:opacity-30"
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
            <div className="flex justify-between text-[10px] font-mono text-ink-faint">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>
        </div>

        {/* Volume + playback speed */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-rim pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMuted((m) => !m)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-tint hover:text-ink-strong transition-colors"
            >
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
              className="w-20 h-1.5 accent-blue cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-faint">Tezlik</span>
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={cn(
                  'rounded-lg px-2 py-1 text-[11px] font-bold transition-colors',
                  speed === s ? 'bg-blue text-white' : 'bg-tint text-ink-soft hover:bg-soft',
                )}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Play count indicator */}
        {config.listenCount && editable && (
          <p className="mt-3 text-[11px] text-ink-faint text-center">
            {playCount}/{maxPlays} marta tingladingiz
          </p>
        )}

        {/* Transcript toggle */}
        {config.transcript && config.allowTranscript && (
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="mt-4 w-full flex items-center justify-center gap-2 text-xs font-bold text-ink-soft hover:text-blue transition-colors"
          >
            {showTranscript ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showTranscript ? "Transkripsiyani yashirish" : "Transkripsiyani ko'rish"}
          </button>
        )}

        {showTranscript && config.transcript && (
          <div className="mt-3 rounded-xl bg-tint border border-rim p-4 text-sm text-ink-strong/90 leading-relaxed whitespace-pre-wrap">
            {config.transcript}
          </div>
        )}
      </div>

      {/* Questions */}
      {config.questions.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-ink-faint">Savollar</p>
          {config.questions.map((q, idx) => {
            const response = responses[q.id];
            const value = response?.value;
            const isMulti = q.kind === 'mcq' && Array.isArray(q.answer);

            return (
              <div key={q.id} className="rounded-2xl border border-rim bg-tint p-4">
                <p className="text-sm font-semibold text-ink-strong mb-3">
                  <span className="font-mono text-[11px] text-ink-soft mr-2">{idx + 1}.</span>
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
                          ? 'border-blue/40 bg-blue/10 text-ink-strong'
                          : 'border-rim bg-tint text-ink-soft hover:border-blue/30 hover:text-ink-strong',
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
                      value === c ? 'border-blue/40 bg-blue/10 text-ink-strong' : 'border-rim bg-tint text-ink-soft hover:border-blue/30 hover:text-ink-strong',
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
                      className="w-full rounded-xl border border-rim bg-tint px-4 py-2.5 text-sm text-ink-strong placeholder-ink-faint outline-none focus:border-blue/40"
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
