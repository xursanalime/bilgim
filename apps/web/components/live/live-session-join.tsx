'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { liveApi, JoinSessionResult } from '../../lib/api/live';
import { Loader2, Play, ArrowLeft, RefreshCw } from 'lucide-react';
import { getUserRole } from '../../lib/auth';

const LiveRoom = dynamic(
  () => import('../live-room/LiveRoom').then(m => m.LiveRoom),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-blue" />
      </div>
    ),
  }
);

interface LiveSessionJoinProps {
  locale: string;
  lessonId: string;
}

export function LiveSessionJoin({ locale, lessonId }: LiveSessionJoinProps) {
  const [data, setData] = useState<JoinSessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const tryJoin = async (): Promise<boolean> => {
    try {
      const response = await liveApi.join(lessonId);
      setData(response);
      setError(null);
      return true;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.status === 404) {
        setError('LIVE_NOT_STARTED');
      } else {
        setError('Live efirga ulanishda xatolik yuz berdi.');
      }
      return false;
    }
  };

  useEffect(() => {
    const role = getUserRole();
    setIsTeacher(role === 'TEACHER');

    tryJoin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // Student: auto-poll every 5s when session not started yet
  useEffect(() => {
    if (error !== 'LIVE_NOT_STARTED' || isTeacher) return;

    pollRef.current = setInterval(async () => {
      setPollCount(c => c + 1);
      const joined = await tryJoin();
      if (joined && pollRef.current) clearInterval(pollRef.current);
    }, 5000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, isTeacher]);

  const handleStart = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await liveApi.start(lessonId);
      await tryJoin();
    } catch {
      setError("Efirni boshlashda xatolik yuz berdi.");
    } finally {
      setIsStarting(false);
    }
  };

  // Session not started
  if (error === 'LIVE_NOT_STARTED') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-blue/10 text-blue">
            <Play className="h-10 w-10 fill-current" />
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold tracking-tight">Efir hali boshlanmagan</h2>
            <p className="text-slate-400 leading-relaxed text-sm">
              {isTeacher
                ? "Darsni boshlash uchun quyidagi tugmani bosing."
                : "O'qituvchi efirni boshlaguncha avtomatik ulanasiz..."}
            </p>
            {!isTeacher && (
              <div className="flex items-center justify-center gap-2 text-white/30 text-xs mt-2">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>Tekshirilyapti... ({pollCount})</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-4">
            {isTeacher ? (
              <button
                disabled={isStarting}
                onClick={handleStart}
                className="w-full py-4 bg-blue hover:bg-blue-600 disabled:opacity-50 text-white rounded-2xl font-bold shadow-xl shadow-blue/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {isStarting ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Play className="h-5 w-5 fill-current" /> Efirni boshlash</>}
              </button>
            ) : (
              <button
                onClick={() => tryJoin()}
                className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" /> Qo'lda yangilash
              </button>
            )}

            <button
              onClick={() => router.push(`/${locale}/dashboard`)}
              className="w-full py-3 text-slate-500 hover:text-white transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
              <ArrowLeft className="h-4 w-4" /> Dashboardga qaytish
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Generic error
  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white gap-6">
        <p className="text-lg text-red-400 max-w-md text-center">{error}</p>
        <div className="flex gap-3">
          <button
            onClick={() => router.push(`/${locale}/dashboard`)}
            className="px-6 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all font-medium"
          >
            Dashboardga qaytish
          </button>
          <button
            onClick={() => tryJoin()}
            className="px-6 py-2.5 bg-blue text-white rounded-xl hover:bg-blue-600 transition-all font-medium"
          >
            Qayta urinish
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (!data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-blue" />
        <p className="text-slate-400 text-sm">Efirga ulanmoqda...</p>
      </div>
    );
  }

  return (
    <LiveRoom
      token={data.token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880'}
      lessonId={lessonId}
      role={data.role}
      onLeave={() => router.push(`/${locale}/dashboard`)}
    />
  );
}
