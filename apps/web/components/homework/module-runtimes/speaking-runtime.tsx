'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic, MicOff, Play, Pause, Square, RotateCcw,
  Volume2, CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface SpeakingTask {
  id: string;
  prompt: string;
  targetText: string;
  teacherAudioUrl?: string;
  hint?: string;
}

export interface SpeakingRuntimeConfig {
  tasks: SpeakingTask[];
  showTargetText?: boolean;
}

export interface SpeakingAttempt {
  taskId: string;
  transcript: string;
  score: number;
  recordingUrl?: string;
  completedAt: string;
}

export interface SpeakingRuntimeAnswer {
  attempts: SpeakingAttempt[];
}

interface Props {
  config: SpeakingRuntimeConfig;
  initialAnswer: SpeakingRuntimeAnswer | null;
  editable: boolean;
  onChange: (answer: SpeakingRuntimeAnswer) => void;
}

type RecordState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

function SpeakingTaskCard({
  task,
  editable,
  showTarget,
  onAttempt,
  existingAttempt,
}: {
  task: SpeakingTask;
  editable: boolean;
  showTarget: boolean;
  onAttempt: (attempt: SpeakingAttempt) => void;
  existingAttempt?: SpeakingAttempt | undefined;
}) {
  const [state, setState] = useState<RecordState>(existingAttempt ? 'done' : 'idle');
  const [transcript, setTranscript] = useState(existingAttempt?.transcript ?? '');
  const [score, setScore] = useState(existingAttempt?.score ?? 0);
  const [teacherPlaying, setTeacherPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const teacherAudioRef = useRef<HTMLAudioElement>(null);
  const recognitionRef = useRef<unknown>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const speakTarget = useCallback(() => {
    if (!window.speechSynthesis) return;
    const utt = new SpeechSynthesisUtterance(task.targetText);
    utt.lang = 'en-US';
    utt.rate = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
  }, [task.targetText]);

  const calcScore = (recognized: string, target: string): number => {
    const rWords = recognized.toLowerCase().trim().split(/\s+/);
    const tWords = target.toLowerCase().trim().split(/\s+/);
    let matches = 0;
    rWords.forEach((w) => { if (tWords.includes(w)) matches++; });
    return Math.round((matches / Math.max(tWords.length, 1)) * 100);
  };

  const startRecording = async () => {
    setErrorMsg('');
    type SpeechRecognitionCtor = new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start: () => void;
      stop: () => void;
      onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
    };

    // Check for Web Speech API support
    const SpeechRecognitionAPI = (
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    ) as SpeechRecognitionCtor | undefined;

    if (!SpeechRecognitionAPI) {
      setErrorMsg('Brauzeringiz mikrofon yozishni qo\'llamaydi. Chrome yoki Edge ishlatib ko\'ring.');
      setState('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { chunksRef.current.push(e.data); };
      mediaRecorder.start();

      // Speech recognition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition = new (SpeechRecognitionAPI as any)();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognitionRef.current = recognition;

      recognition.onresult = (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => {
        const text = e.results[0]?.[0]?.transcript ?? '';
        const s = calcScore(text, task.targetText);
        setTranscript(text);
        setScore(s);
        setState('done');
        mediaRecorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        onAttempt({
          taskId: task.id,
          transcript: text,
          score: s,
          completedAt: new Date().toISOString(),
        });
      };

      recognition.onerror = () => {
        setErrorMsg('Mikrofon tanilmadi. Qayta urinib ko\'ring.');
        setState('error');
        mediaRecorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      };

      recognition.onend = () => {
        if (state === 'recording') setState('processing');
      };

      recognition.start();
      setState('recording');
    } catch {
      setErrorMsg('Mikrofonga ruxsat berilmadi.');
      setState('error');
    }
  };

  const stopRecording = () => {
    (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
    mediaRecorderRef.current?.stop();
    setState('processing');
  };

  const reset = () => {
    setState('idle');
    setTranscript('');
    setScore(0);
    setErrorMsg('');
  };

  const scoreColor =
    score >= 80 ? 'text-green' : score >= 50 ? 'text-orange' : 'text-red';
  const scoreLabel =
    score >= 80 ? "A'lo!" : score >= 50 ? "Yaxshi, lekin davom eting" : "Ko'proq mashq qiling";

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-5">
      <p className="text-sm font-semibold text-white">{task.prompt}</p>

      {/* Teacher audio */}
      {task.teacherAudioUrl && (
        <div className="flex items-center gap-3">
          <audio
            ref={teacherAudioRef}
            src={task.teacherAudioUrl}
            onPlay={() => setTeacherPlaying(true)}
            onPause={() => setTeacherPlaying(false)}
            onEnded={() => setTeacherPlaying(false)}
          />
          <button
            onClick={() => {
              if (teacherPlaying) teacherAudioRef.current?.pause();
              else teacherAudioRef.current?.play();
            }}
            className="flex items-center gap-2 rounded-xl border border-blue/20 bg-blue/10 px-4 py-2 text-sm font-bold text-blue hover:bg-blue/20 transition-all"
          >
            {teacherPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            O'qituvchi namunasi
          </button>
        </div>
      )}

      {/* Target text */}
      {(showTarget || showText) && (
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Aytish kerak</p>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-white leading-relaxed">{task.targetText}</p>
            <button onClick={speakTarget} className="text-white/30 hover:text-white/60 transition-colors shrink-0">
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {task.hint && !showText && !showTarget && (
        <button
          onClick={() => setShowText(true)}
          className="text-xs font-bold text-white/30 hover:text-white/50 transition-colors"
        >
          Matnni ko'rsatish
        </button>
      )}

      {/* Recording controls */}
      {editable && (
        <div className="flex items-center gap-3">
          {state === 'idle' && (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 rounded-2xl bg-red/10 border border-red/20 px-5 py-2.5 text-sm font-black text-red hover:bg-red/20 transition-all active:scale-95"
            >
              <Mic className="h-4 w-4" /> Yozishni boshlash
            </button>
          )}

          {state === 'recording' && (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-2xl bg-red px-5 py-2.5 text-sm font-black text-white hover:bg-red/90 transition-all active:scale-95 animate-pulse"
            >
              <Square className="h-4 w-4" /> To'xtatish
            </button>
          )}

          {state === 'processing' && (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Tahlil qilinmoqda...
            </div>
          )}

          {(state === 'done' || state === 'error') && (
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2 text-sm font-bold text-white/50 hover:text-white hover:border-white/[0.15] transition-all"
            >
              <RotateCcw className="h-4 w-4" /> Qayta yozish
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {state === 'error' && errorMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-red/10 border border-red/20 px-4 py-3 text-sm text-red">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {errorMsg}
        </div>
      )}

      {/* Result */}
      {state === 'done' && transcript && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Siz aytdingiz</p>
            <p className="text-sm text-white/80 italic">"{transcript}"</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500',
                  score >= 80 ? 'bg-green' : score >= 50 ? 'bg-orange' : 'bg-red'
                )}
                style={{ width: `${score}%` }}
              />
            </div>
            <div className="text-right">
              <p className={cn('text-2xl font-black', scoreColor)}>{score}%</p>
              <p className="text-[10px] font-bold text-white/30">{scoreLabel}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SpeakingRuntime({ config, initialAnswer, editable, onChange }: Props) {
  const [attempts, setAttempts] = useState<SpeakingAttempt[]>(initialAnswer?.attempts ?? []);

  useEffect(() => {
    onChange({ attempts });
  }, [attempts]); // eslint-disable-line

  const handleAttempt = (attempt: SpeakingAttempt) => {
    setAttempts((p) => {
      const filtered = p.filter((a) => a.taskId !== attempt.taskId);
      return [...filtered, attempt];
    });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue/20 bg-blue/5 px-4 py-3 text-xs text-white/60">
        <strong className="text-blue">Eslatma:</strong> Mikrofon ruxsati kerak bo'ladi. Chrome yoki Edge brauzerida yaxshi ishlaydi.
      </div>

      {config.tasks.map((task) => (
        <SpeakingTaskCard
          key={task.id}
          task={task}
          editable={editable}
          showTarget={config.showTargetText ?? false}
          onAttempt={handleAttempt}
          existingAttempt={attempts.find((a) => a.taskId === task.id)}
        />
      ))}
    </div>
  );
}
